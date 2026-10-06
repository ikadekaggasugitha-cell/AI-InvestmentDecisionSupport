"""
Auth router: registration, login, and everything that ends a session.

The previous version had one endpoint and no user store: it compared the submitted
password against AUTH_PASSWORD with `secrets.compare_digest` and signed a JWT.
Nothing about a person was recorded, so there was nothing to hang a subscription
on, nothing to revoke, and no way for anyone to own a portfolio.

Registration is open in this phase and takes no payment. That is a deliberate
state, not an oversight: charging is Phase 2, and the legal terms are a draft
because nothing here can take money yet (docs/status.md). What signup will not do
is invent data. The phone number is required rather than optional, because it is
the only notification channel the product has.
"""

import logging
import secrets

from fastapi import APIRouter, HTTPException, Request, Response, status
from redis.exceptions import RedisError
from pydantic import BaseModel, Field, field_validator

from api.core.auth import CurrentUser
from api.core.config import get_settings
from api.core.redis_client import get_redis
from api.services import accounts as accounts_service
from api.services import passwords
from api.services import sessions as sessions_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/auth", tags=["auth"])

# Long enough to open a connection, short enough that a leaked query string is
# worthless by the time anyone reads the log it landed in.
WS_TICKET_TTL_SECONDS = 30

MIN_PASSWORD_LENGTH = 8

# SameSite=Lax rather than Strict: the frontend and API are different origins in
# development, and Strict would drop the cookie on the navigation that follows a
# login. Lax still blocks the cross-site POST case, which is the one that matters,
# and no endpoint changes state on GET.
COOKIE_KWARGS = {"httponly": True, "samesite": "lax", "path": "/"}

# A genuine Argon2id hash of a random value nobody holds. Verified against when
# the email is unknown, so both failure paths do comparable work.
_DECOY_HASH = passwords.hash_password(secrets.token_urlsafe(32))


def _clean_name(value: str) -> str:
    """Collapse whitespace and reject a name that is only whitespace.

    `min_length=1` does not catch "   ": Pydantic counts three characters, and
    the column is NOT NULL, so an empty string was accepted and stored. The rule
    lives here once because it was previously written twice and the signup copy
    forgot the second half.
    """
    cleaned = " ".join(value.split())
    if not cleaned:
        raise ValueError("name cannot be blank")
    return cleaned


def _check_phone(value: str) -> str:
    if not accounts_service.is_valid_phone(value):
        raise ValueError("expected an Indonesian mobile number, as 08... or +62...")
    return value.strip()


class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=accounts_service.EMAIL_MAX)
    full_name: str = Field(min_length=1, max_length=150)
    phone_number: str
    password: str = Field(min_length=MIN_PASSWORD_LENGTH)

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: str) -> str:
        normalised = accounts_service.normalise_email(value)
        if "@" not in normalised or normalised.startswith("@") or normalised.endswith("@"):
            raise ValueError("not a valid email address")
        return normalised

    @field_validator("full_name")
    @classmethod
    def _normalise_name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("phone_number")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        return _check_phone(value)


class LoginRequest(BaseModel):
    email: str
    password: str


class UpdateProfileRequest(BaseModel):
    """Only the fields a person may change about themselves.

    Deliberately not email, role or blocked_at. See accounts.update_profile.
    """

    full_name: str = Field(min_length=1, max_length=150)
    phone_number: str

    @field_validator("full_name")
    @classmethod
    def _normalise_name(cls, value: str) -> str:
        return _clean_name(value)

    @field_validator("phone_number")
    @classmethod
    def _validate_phone(cls, value: str) -> str:
        return _check_phone(value)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=MIN_PASSWORD_LENGTH)


class AccountResponse(BaseModel):
    id: str
    email: str
    full_name: str
    phone_number: str
    role: str
    blocked: bool


class SessionResponse(BaseModel):
    account: AccountResponse


def _set_session_cookie(response: Response, token: str, max_age_days: int) -> None:
    response.set_cookie(
        sessions_service.SESSION_COOKIE,
        token,
        max_age=max_age_days * 86_400,
        # Governed by SESSION_COOKIE_SECURE rather than by APP_ENV, because a
        # staging deployment over HTTPS needs it too. Hard-coding it to production
        # silently issued an insecure cookie everywhere else.
        secure=get_settings().session_cookie_secure,
        **COOKIE_KWARGS,
    )


@router.post("/signup", response_model=SessionResponse, summary="Create an account")
async def signup(body: SignupRequest, response: Response) -> SessionResponse:
    account = await accounts_service.create_account(
        email=body.email,
        password_hash=passwords.hash_password(body.password),
        full_name=body.full_name,
        phone_number=body.phone_number,
    )
    if account is None:
        # The uniqueness guarantee is the database index on lower(email); this is
        # the caller-facing translation of it.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="That email address is already registered.",
        )
    return await _start_session(response, account)


@router.post("/login", response_model=SessionResponse, summary="Sign in")
async def login(body: LoginRequest, response: Response) -> SessionResponse:
    found = await accounts_service.get_account_by_email(body.email)
    if found is None:
        # Verify against a real throwaway hash so a missing account costs about
        # as much as a wrong password. Without it the response time answers
        # "is this email registered?" on its own.
        passwords.verify_password(_DECOY_HASH, body.password)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )

    account, stored_hash = found
    if not passwords.verify_password(stored_hash, body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password.",
        )
    if account.blocked_at is not None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is blocked.",
        )
    if passwords.needs_rehash(stored_hash):
        await accounts_service.update_password_hash(
            account.id, passwords.hash_password(body.password)
        )
    return await _start_session(response, account)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT, summary="Sign out one device")
async def logout(request: Request, response: Response) -> None:
    """Delete the session row as well as the cookie.

    Clearing the cookie alone would leave a live token in a copy of it, which is
    the whole thing this design moved away from.
    """
    token = request.cookies.get(sessions_service.SESSION_COOKIE)
    if token:
        await sessions_service.destroy_session(token)
    response.delete_cookie(sessions_service.SESSION_COOKIE, path="/")


@router.post("/ws-ticket", summary="Single-use ticket for the market WebSocket")
async def ws_ticket(user: CurrentUser, response: Response) -> dict:
    """Exchange the session cookie for a very short-lived, single-use ticket.

    Only needed when the cookie will not be sent on the WebSocket handshake,
    a cross-site frontend, where SameSite=Lax withholds it. A browser cannot set
    headers during a WebSocket upgrade, so the value has to travel as a query
    parameter, and a long-lived session token in a query string ends up in proxy
    logs. Thirty seconds and one connection is enough.
    """
    ticket = secrets.token_urlsafe(24)
    try:
        async with get_redis() as r:
            # The value is the account id, not a bare flag. The WebSocket has to
            # resolve this account's entitlement after the handshake, and a flag
            # would prove who they are without saying who.
            await r.set(f"ws-ticket:{ticket}", str(user.user_id), ex=WS_TICKET_TTL_SECONDS)
    except RedisError as exc:
        # Fail closed. The WebSocket is a live price feed, not the app; refusing
        # to issue a ticket costs a reconnect, whereas issuing one that cannot be
        # checked would cost authentication.
        logger.error("ws-ticket: cannot reach redis: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cannot issue a WebSocket ticket right now.",
        ) from exc
    return {"ticket": ticket, "expires_in": WS_TICKET_TTL_SECONDS}


@router.get("/me", response_model=AccountResponse, summary="The signed-in account")
async def me(user: CurrentUser) -> AccountResponse:
    account = await accounts_service.get_account(user.user_id)
    # get_current_user already loaded this row; it cannot have disappeared in
    # between, so a missing one is a bug rather than a state to report.
    return AccountResponse(
        id=str(account.id),
        email=account.email,
        full_name=account.full_name,
        phone_number=account.phone_number,
        role=account.role,
        blocked=account.blocked_at is not None,
    )


@router.put("/me", response_model=AccountResponse, summary="Change name and WhatsApp number")
async def update_profile(
    body: UpdateProfileRequest, user: CurrentUser
) -> AccountResponse:
    try:
        account = await accounts_service.update_profile(
            user.user_id, full_name=body.full_name, phone_number=body.phone_number
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from exc
    return AccountResponse(
        id=str(account.id),
        email=account.email,
        full_name=account.full_name,
        phone_number=account.phone_number,
        role=account.role,
        blocked=account.blocked_at is not None,
    )


@router.post(
    "/change-password",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Change the password and sign out everywhere",
)
async def change_password(
    body: ChangePasswordRequest, user: CurrentUser
) -> Response:
    found = await accounts_service.get_account_by_email(user.email)
    if found is None or not passwords.verify_password(found[1], body.current_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect.",
        )
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must differ from the current one.",
        )

    await accounts_service.update_password_hash(
        user.user_id, passwords.hash_password(body.new_password)
    )
    # Revocation by absence: deleting the rows is the fact, so there is no flag
    # that can disagree with it.
    await accounts_service.revoke_all_sessions(user.user_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


async def _start_session(response: Response, account: accounts_service.Account) -> SessionResponse:
    ttl_days = get_settings().session_ttl_days
    token, _expires_at = await sessions_service.create_session(account.id, ttl_days)
    _set_session_cookie(response, token, ttl_days)
    return SessionResponse(
        account=AccountResponse(
            id=str(account.id),
            email=account.email,
            full_name=account.full_name,
            phone_number=account.phone_number,
            role=account.role,
            blocked=account.blocked_at is not None,
        )
    )
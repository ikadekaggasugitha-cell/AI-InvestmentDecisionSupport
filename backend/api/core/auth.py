"""
Who is making this request.

Replaces the JWT. The old design signed a token containing `sub` and nothing
else, which meant three things had no home: revoking access (a claim already
handed out cannot be un-handed), finding out what a caller was allowed to see
without a database round trip, and telling a blocked account apart from a valid
one. All three now come from the database on every request, which is slower and
correct.

The bearer header is gone. The token lives in an HttpOnly cookie, so a cross-site
script cannot read it — which is the entire reason it moved out of localStorage.

Two properties worth stating because they are easy to undo by accident:

  * AUTH_BYPASS resolves to a real Account row, not a string. `portfolios.user_id`
    is a foreign key, so a synthetic principal that owns nothing would break every
    portfolio-scoped route the moment anyone used the app for real.

  * The paywall fails closed. `require_entitlement` treats an unreachable database
    as "no access". Redis in this repo degrades open on purpose — correct for a
    market cache, catastrophic for a gate — so the gate must not be built on the
    assumption that a helper returning None means "no restriction".
"""

import uuid
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status

from api.core.config import get_settings
from api.services import accounts as accounts_service
from api.services import entitlements
from api.services import sessions as sessions_service


@dataclass(frozen=True)
class Principal:
    """The authenticated caller. Identity and authorisation, nothing about payment."""

    user_id: uuid.UUID
    role: str
    email: str
    # Why the account is closed, when it is. Carried so the entitlement gate can
    # tell a suspension ('subscription_expired' — this person paid once and the
    # clock ran out) apart from a refusal ('admin' — never returns a Principal
    # at all). None means the account is open.
    blocked_reason: str | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    @property
    def is_suspended(self) -> bool:
        """True when the account was closed by the lapsed-subscription beat."""
        return self.blocked_reason == "subscription_expired"


def _unauthenticated() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Not authenticated",
    )


async def _principal_from_request(request: Request) -> Principal | None:
    """Resolve the session cookie to a Principal, or None if there isn't one."""
    settings = get_settings()

    if settings.auth_bypass:
        account = await accounts_service.get_or_create_bypass_account(
            settings.auth_bypass_email
        )
        return Principal(user_id=account.id, role=account.role, email=account.email)

    token = request.cookies.get(sessions_service.SESSION_COOKIE)
    if not token:
        return None

    # One joined query: session lookup, expiry check and the blocked check all
    # happen together, and nothing is cached, so revoking a session or blocking an
    # account takes effect on the very next request.
    account = await accounts_service.authenticate(token)
    if account is None:
        return None
    if account.blocked_at is not None:
        if account.blocked_reason == "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This account is blocked.",
            )
        # 'subscription_expired' is not a refusal of the identity: the person is
        # in, and the entitlement gate decides what they may see. A Principal is
        # returned with the reason attached rather than swallowed here, so auth,
        # pricing and payments keep answering an account suspended by the beat —
        # the whole point of suspending with a reason instead of a 403.
        return Principal(
            user_id=account.id,
            role=account.role,
            email=account.email,
            blocked_reason=account.blocked_reason,
        )
    return Principal(user_id=account.id, role=account.role, email=account.email)


async def get_current_user(request: Request) -> Principal:
    principal = await _principal_from_request(request)
    if principal is None:
        raise _unauthenticated()
    return principal


async def get_optional_user(request: Request) -> Principal | None:
    """For endpoints that serve signed-in callers differently but work signed out."""
    try:
        return await _principal_from_request(request)
    except HTTPException:
        # A blocked account is still "present" but not usable; for an optional
        # dependency that means treated as anonymous.
        return None


async def require_admin(user: Annotated[Principal, Depends(get_current_user)]) -> Principal:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required.",
        )
    return user


async def require_entitlement(
    user: Annotated[Principal, Depends(get_current_user)],
) -> Principal:
    """Gate the paid data.

    Separate from get_current_user on purpose. Role answers "may this person use
    the system"; this answers "may this person use the paid data". Collapsing them
    would mean an administrator silently had to be a paying subscriber, which is
    exactly the trade CONTEXT.md forbids.

    402, not 403. A suspended account is also refused — with 403 and its own
    reason, because "pay first" is not what happened to them: they paid once and
    the period ended. A non-admin on admin routes is refused 403 as well. The
    client needs to tell those apart: telling a suspended person they never had
    a subscription is a lie, so is telling a non-admin their billing is the
    problem. 402 is reserved for "the identity is fine and has simply never
    held the entitlement".
    """
    settings = get_settings()
    # Suspended is account state, checked before the paywall switch: an install
    # running with the paywall off has not made a lapsed account's period live
    # again — only a settled payment can, so a suspended caller sees data here
    # only if a payment already reopened them and the beat is not asked over
    # again. 403, with a sentence of its own, so it never reads as "no
    # subscription" (402) nor as an admin's refusal of the identity.
    if user.is_suspended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "This account's subscription has ended. "
                "Paying again reopens the account."
            ),
        )
    if not settings.paywall_enabled:
        return user
    if await entitlements.has_active_subscription(user.user_id):
        return user
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail="An active subscription is required for this data.",
    )


CurrentUser = Annotated[Principal, Depends(get_current_user)]
OptionalUser = Annotated[Principal | None, Depends(get_optional_user)]
AdminUser = Annotated[Principal, Depends(require_admin)]
EntitledUser = Annotated[Principal, Depends(require_entitlement)]
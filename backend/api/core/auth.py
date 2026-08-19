from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel

from api.core.config import get_settings

security = HTTPBearer(auto_error=False)


class TokenPayload(BaseModel):
    sub: str
    exp: datetime | None = None


def create_access_token(subject: str) -> str:
    settings = get_settings()
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.jwt_access_token_expire_minutes
    )
    payload = {"sub": subject, "exp": expire}
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def verify_token(token: str) -> TokenPayload:
    settings = get_settings()
    try:
        # require_exp rejects a token with no expiry. Without it a token missing
        # the `exp` claim is treated as never-expiring — and create_access_token
        # always sets one, so a token lacking it is either malformed or forged.
        raw = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            options={"require_exp": True},
        )
        return TokenPayload(**raw)
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(security)],
) -> TokenPayload:
    settings = get_settings()

    # Development bypass — no auth required
    if settings.auth_bypass:
        return TokenPayload(sub="dev-user")

    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return verify_token(credentials.credentials)


# Convenience type alias for dependency injection
CurrentUser = Annotated[TokenPayload, Depends(get_current_user)]

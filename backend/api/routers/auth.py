"""
Auth router — token issuance for the single-operator login.

The API guards every data route with get_current_user (see api/main.py). That
dependency needs a bearer token, and this endpoint is where the operator gets
one: POST username + password, receive a signed JWT. There is deliberately no
user store — this is a personal decision-support tool with one operator whose
credentials live in settings (AUTH_USERNAME / AUTH_PASSWORD).
"""

import secrets

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from api.core.auth import create_access_token
from api.core.config import get_settings

router = APIRouter(prefix="/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in_minutes: int


@router.post("/token", response_model=TokenResponse, summary="Exchange credentials for a JWT")
async def login(body: LoginRequest) -> TokenResponse:
    settings = get_settings()

    if not settings.auth_password:
        # No credential configured — login is switched off. Surfacing this as a
        # clear 503 beats a confusing 401 that looks like a wrong password.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Login is not configured. Set AUTH_USERNAME and AUTH_PASSWORD.",
        )

    # Constant-time comparison on both fields so a caller cannot distinguish a
    # wrong username from a wrong password by timing.
    user_ok = secrets.compare_digest(body.username, settings.auth_username)
    pass_ok = secrets.compare_digest(body.password, settings.auth_password)
    if not (user_ok and pass_ok):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return TokenResponse(
        access_token=create_access_token(subject=settings.auth_username),
        expires_in_minutes=settings.jwt_access_token_expire_minutes,
    )

"""
Promote an account to administrator.

Registration is open and every account it creates has role 'user' (api/routers/
auth.py). Nothing in the request path can produce an 'admin', which is correct:
role answers "may this person use the system" and a signup form should not be able
to grant it. But it means the first administrator has to be created deliberately,
by a human, from a machine that already has database access.

That is why this is a script and not an endpoint, and why there is no seeded admin
account anywhere. `db/schema.sql` is applied by the db-init service on every
`docker compose up`, so an admin row written into it would be copied into every
install and could never be rotated. See ADR-0002.

Usage:
    python -m db.promote_admin someone@example.com
    python -m db.promote_admin --list
    python -m db.promote_admin someone@example.com --revoke
    python -m db.promote_admin --create-first someone@example.com --name "Nama" --phone 0812...
    python -m db.promote_admin --create-first --name "Nama" --phone 0812...

The last form takes its email from ADMIN_EMAIL, which is the one thing that
setting is for. It was documented as this script's input while the script never
read it, so the first administrator on a fresh install depended on someone
retyping an address from the deployment notes.

The last form exists because a brand-new install has no account to promote. It
creates one with a random password that is printed once and cannot be recovered,
which is the only safe way to hand out a first credential.

Dependencies are psycopg2 plus the app's own Settings, matching db/migrate.py so
the two cannot point at different databases.
"""

from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path

import psycopg2

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from api.core.config import get_settings  # noqa: E402
from api.services.passwords import hash_password  # noqa: E402

_ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


def _connect():
    """psycopg2 needs a plain postgres:// URL; Settings keeps the asyncpg driver."""
    url = get_settings().database_url.replace("postgresql+asyncpg://", "postgresql://")
    return psycopg2.connect(url)


def _resolve_email(raw: str) -> str:
    return raw.strip().lower()


def _bootstrap_email() -> str | None:
    """ADMIN_EMAIL, or None when it has not been set.

    Read from the environment first and the .env file second, so an operator who
    exports it for one invocation is not silently overruled by the file.
    """
    configured = os.environ.get("ADMIN_EMAIL") or ""
    if not configured and _ENV_FILE.exists():
        for line in _ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("ADMIN_EMAIL="):
                configured = line.partition("=")[2]
                break
    return _resolve_email(configured) if configured.strip() else None


def promote(email: str) -> int:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET role = 'admin' WHERE lower(email) = lower(%s) RETURNING id",
            (email.strip(),),
        )
        row = cur.fetchone()
        if row is None:
            print(f"No account with email {email!r}. Registered accounts:")
            cur.execute("SELECT email, role FROM users ORDER BY created_at LIMIT 20")
            for candidate, role in cur.fetchall():
                print(f"  {candidate:40s} {role}")
            return 1
    print(f"{email} is now an administrator.")
    return 0


def revoke(email: str) -> int:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            "UPDATE users SET role = 'user' WHERE lower(email) = lower(%s) AND role <> 'admin' RETURNING id",
            (email.strip(),),
        )
        if cur.fetchone() is None:
            print(f"{email} is not an administrator, so nothing changed.")
            return 1
    print(f"{email} is back to a normal account.")
    return 0


def create_first(email: str, full_name: str, phone: str) -> int:
    """Create an account that is already an administrator, with a random password."""
    password = secrets.token_urlsafe(18)
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO users (email, password_hash, full_name, phone_number, role)
            VALUES (%s, %s, %s, %s, 'admin')
            ON CONFLICT DO NOTHING
            RETURNING id
            """,
            (_resolve_email(email), hash_password(password), full_name.strip(), phone.strip()),
        )
        if cur.fetchone() is None:
            print(f"{email} already exists. Use 'promote' instead of '--create-first'.")
            return 1
    print("Account created. Sign in with this password; it is shown once and is not recoverable.")
    print(f"  email    {email.strip()}")
    print(f"  password {password}")
    return 0


def list_accounts() -> int:
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT email, role, blocked_at IS NOT NULL AS blocked, created_at
              FROM users
             ORDER BY created_at
            """
        )
        rows = cur.fetchall()
    if not rows:
        print("No accounts yet.")
        return 0
    print(f"{'email':40s} {'role':6s} {'blocked':8s} created")
    for email, role, blocked, created in rows:
        print(f"{email:40s} {role:6s} {'yes' if blocked else 'no':8s} {created:%Y-%m-%d}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m db.promote_admin",
        description="Promote an account to administrator.",
    )
    parser.add_argument("email", nargs="?", help="the account's email address")
    parser.add_argument("--list", action="store_true", help="list every account")
    parser.add_argument("--revoke", action="store_true", help="demote back to 'user'")
    parser.add_argument(
        "--create-first",
        metavar="EMAIL",
        nargs="?",
        # True when the flag is given with no email, which is what makes
        # ADMIN_EMAIL the input. Without a const, bare --create-first would be
        # indistinguishable from the flag being absent.
        const=True,
        help=(
            "create a new account that is already an administrator; "
            "the email defaults to ADMIN_EMAIL"
        ),
    )
    parser.add_argument("--name", help="with --create-first: the person's full name")
    parser.add_argument("--phone", help="with --create-first: their WhatsApp number")
    args = parser.parse_args(argv)

    if args.list:
        return list_accounts()
    if args.create_first is not None:
        if not args.name or not args.phone:
            parser.error("--create-first also needs --name and --phone")
        email = (
            _bootstrap_email() if args.create_first is True else args.create_first
        )
        if not email:
            parser.error(
                "no email given and ADMIN_EMAIL is not set; pass one as an "
                "argument or set ADMIN_EMAIL in .env"
            )
        return create_first(email, args.name, args.phone)
    if not args.email:
        parser.error("give an email address, or use --list")
    if args.revoke:
        return revoke(args.email)
    return promote(args.email)


if __name__ == "__main__":
    raise SystemExit(main())
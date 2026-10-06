"""
The identity layer: password hashing, accounts, and opaque sessions.

These run against in-memory fakes rather than a database, matching the rest of the
suite. The fakes here are hand-written rather than reused from conftest because
the statements are few and the assertions need to inspect exactly what was sent to
the driver — which is the whole point of the session tests below.
"""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from api.services import accounts as accounts_service
from api.services import passwords, sessions


# ── fakes ─────────────────────────────────────────────────────────────────────


class _Row(dict):
    """dict with attribute access, like an asyncpg Record."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError as exc:  # pragma: no cover
            raise AttributeError(name) from exc


class _IdentityPool:
    """Enough asyncpg to exercise accounts and sessions, and to record calls."""

    def __init__(self):
        self.users: dict[str, _Row] = {}          # lower(email) -> row
        self.by_id: dict[str, _Row] = {}
        self.sessions: dict[str, _Row] = {}       # sha256(token) -> row
        self.calls: list[tuple[str, tuple]] = []

    # -- accounts

    async def fetchrow(self, query, *args):
        self.calls.append((query, args))
        if "password_hash" in query and "lower(email)" in query:
            row = self.users.get(args[0].lower())
            if row is None:
                return None
            return _Row({**row, "password_hash": row.get("password_hash", "h")})
        if "INSERT INTO users" in query:
            # Two shapes reach this statement: signup passes all five values as
            # parameters, while the AUTH_BYPASS account has its non-identity
            # columns written as SQL literals and passes only the email.
            email = args[0].lower()
            full_name = args[2] if len(args) > 2 else "Operator Tunggal"
            phone = args[3] if len(args) > 3 else "000000000000"
            role = args[4] if len(args) > 4 else "admin"
            secret = args[1] if len(args) > 1 else "!bypass"
            if email in self.users:
                return None                      # ON CONFLICT DO NOTHING
            row = _Row(
                id=uuid.uuid4(),
                email=email,
                password_hash=secret,
                full_name=full_name,
                phone_number=phone,
                role=role,
                blocked_at=None,
                created_at=datetime.now(timezone.utc),
            )
            self.users[email] = row
            self.by_id[str(row["id"])] = row
            return row
        if "FROM users" in query and "lower(email)" in query:
            return self.users.get(args[0].lower())
        if "FROM users" in query and "WHERE id = $1" in query:
            return self.by_id.get(str(args[0]))
        if "JOIN users" in query and "FROM sessions" in query:
            row = self.sessions.get(args[0])
            if row is None or row["expires_at"] <= datetime.now(timezone.utc):
                return None
            for user in self.users.values():
                if str(user["id"]) == str(row["user_id"]):
                    return {k: user[k] for k in
                            ("id", "email", "full_name", "phone_number", "role",
                             "blocked_at", "created_at")}
            return None
        raise AssertionError(f"unexpected fetchrow: {query!r}")

    # -- sessions

    async def execute(self, query, *args):
        self.calls.append((query, args))
        if "INSERT INTO sessions" in query:
            self.sessions[args[0]] = _Row(
                id=args[0], user_id=uuid.UUID(args[1]), expires_at=args[2]
            )
            return "INSERT 0 1"
        if "DELETE FROM sessions WHERE id = $1" in query:
            existed = self.sessions.pop(args[0], None) is not None
            return "DELETE 1" if existed else "DELETE 0"
        if "DELETE FROM sessions WHERE expires_at" in query:
            now = datetime.now(timezone.utc)
            doomed = [k for k, v in self.sessions.items() if v["expires_at"] < now]
            for k in doomed:
                del self.sessions[k]
            return f"DELETE {len(doomed)}"
        if "DELETE FROM sessions WHERE user_id" in query:
            target = str(args[0])
            doomed = [k for k, v in self.sessions.items() if str(v["user_id"]) == target]
            for k in doomed:
                del self.sessions[k]
            return f"DELETE {len(doomed)}"
        raise AssertionError(f"unexpected execute: {query!r}")


@pytest.fixture
def pool():
    p = _IdentityPool()

    async def _get_pool():
        return p

    with patch("api.services.accounts.get_pool", _get_pool), \
         patch("api.services.sessions.get_pool", _get_pool):
        yield p


# ── passwords ─────────────────────────────────────────────────────────────────


class TestPasswordHashing:
    def test_roundtrip(self):
        stored = passwords.hash_password("rahasia-yang-panjang")
        assert passwords.verify_password(stored, "rahasia-yang-panjang")

    def test_wrong_password_is_rejected(self):
        stored = passwords.hash_password("rahasia-yang-panjang")
        assert not passwords.verify_password(stored, "rahasia-yang-pendek")

    def test_hash_is_not_the_password(self):
        stored = passwords.hash_password("rahasia-yang-panjang")
        assert "rahasia-yang-panjang" not in stored

    def test_same_password_hashes_differently(self):
        """A salt per hash, or one stolen hash identifies every user with that password."""
        assert passwords.hash_password("sama") != passwords.hash_password("sama")

    def test_unparseable_hash_reads_as_wrong_password(self):
        """A corrupt row must not turn the login path into a 500."""
        for junk in ("LOCKED_NO_LOGIN", "", "argon2$broken", "x" * 300):
            assert not passwords.verify_password(junk, "anything")

    def test_empty_inputs_are_rejected(self):
        stored = passwords.hash_password("x")
        assert not passwords.verify_password(stored, "")
        assert not passwords.verify_password("", "x")

    def test_rehash_detection_defaults_to_yes_for_unknown_hash(self):
        assert passwords.needs_rehash("LOCKED_NO_LOGIN")


# ── accounts ──────────────────────────────────────────────────────────────────


class TestAccountValidation:
    def test_email_is_normalised(self):
        for raw in ("  User@Aidss.ID  ", "USER@AIDSS.ID", "user@aidss.id\n"):
            assert accounts_service.normalise_email(raw) == "user@aidss.id"

    @pytest.mark.parametrize(
        "phone,ok",
        [
            ("081234567890", True),
            ("+628123456789", True),
            ("628123456789", True),
            ("0812", False),
            ("+1 555 0100", False),
            ("", False),
            ("08123456789012345", False),
        ],
    )
    def test_phone_validation(self, phone, ok):
        """legal-and-consent.md requires a valid WhatsApp number at registration."""
        assert accounts_service.is_valid_phone(phone) is ok


class TestAccounts:
    async def test_create_and_fetch(self, pool):
        created = await accounts_service.create_account(
            email="  User@Aidss.ID ",
            password_hash="hash",
            full_name="  Nama  ",
            phone_number="081234567890",
        )
        assert created is not None
        assert created.email == "user@aidss.id"
        assert created.role == "user"
        assert created.full_name == "Nama"

        found = await accounts_service.get_account_by_email("USER@AIDSS.ID")
        assert found is not None
        assert found[0].id == created.id
        assert found[1] == "hash"

    async def test_duplicate_email_returns_none_not_an_exception(self, pool):
        args = dict(
            email="dup@aidss.id", password_hash="h", full_name="A", phone_number="0812"
        )
        assert await accounts_service.create_account(**args) is not None
        # Second attempt conflicts; the router turns None into a 409.
        assert await accounts_service.create_account(**args) is None

    async def test_bypass_account_is_created_once(self, pool):
        first = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        second = await accounts_service.get_or_create_bypass_account("DEV@local.invalid")
        assert first.id == second.id
        assert first.role == "admin"
        assert len(pool.users) == 1

    async def test_blocked_account_is_representable(self, pool):
        """blocked_at is a fact an administrator needs; a boolean would discard it."""
        created = await accounts_service.create_account(
            email="b@aidss.id", password_hash="h", full_name="B", phone_number="0812"
        )
        pool.by_id[str(created.id)]["blocked_at"] = datetime.now(timezone.utc)
        fetched = await accounts_service.get_account(created.id)
        assert fetched.blocked_at is not None


# ── sessions ──────────────────────────────────────────────────────────────────


class TestSessionTokens:
    def test_token_is_long_and_random(self):
        tokens = {sessions.generate_token() for _ in range(200)}
        assert len(tokens) == 200, "token generation repeated itself"
        assert all(len(t) == 64 for t in tokens)

    def test_hash_is_shared_with_the_auth_path(self):
        """authenticate() and create_session() must agree, or nothing resolves."""
        assert sessions.hash_session_token("abc") == hashlib.sha256(b"abc").hexdigest()


class TestSessionLifecycle:
    async def test_raw_token_is_never_stored(self, pool):
        """ADR-0004: the table holds the token's hash, so a DB leak is not a session leak."""
        account = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        token, expires_at = await sessions.create_session(account.id, ttl_days=7)

        assert token not in pool.sessions, "the raw token reached the sessions table"
        assert list(pool.sessions) == [hashlib.sha256(token.encode()).hexdigest()]
        assert expires_at > datetime.now(timezone.utc)

    async def test_authenticate_roundtrip(self, pool):
        account = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        token, _ = await sessions.create_session(account.id, ttl_days=7)

        resolved = await accounts_service.authenticate(token)
        assert resolved is not None
        assert resolved.id == account.id

    async def test_unknown_and_empty_tokens_resolve_to_none(self, pool):
        assert await accounts_service.authenticate("") is None
        assert await accounts_service.authenticate("tidak-pernah-dibuat") is None

    async def test_expired_session_is_refused(self, pool):
        account = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        token, _ = await sessions.create_session(account.id, ttl_days=7)
        pool.sessions[hashlib.sha256(token.encode()).hexdigest()]["expires_at"] = (
            datetime.now(timezone.utc) - timedelta(seconds=1)
        )
        assert await accounts_service.authenticate(token) is None

    async def test_authenticate_is_not_cached(self, pool):
        """Revocation has to be immediate, which means no cache on this path.

        This is the regression that motivated dropping the Redis read-through: a
        cached lookup left a revoked session usable until its entry expired, so
        `DELETE FROM sessions` stopped meaning "signed out".
        """
        account = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        token, _ = await sessions.create_session(account.id, ttl_days=7)
        assert await accounts_service.authenticate(token) is not None

        await accounts_service.revoke_all_sessions(account.id)

        assert await accounts_service.authenticate(token) is None, (
            "a revoked session resolved again — something is caching authentication"
        )

    async def test_destroy_removes_the_row(self, pool):
        account = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        token, _ = await sessions.create_session(account.id, ttl_days=7)
        assert await sessions.destroy_session(token) is True
        assert await accounts_service.authenticate(token) is None
        assert await sessions.destroy_session(token) is False

    async def test_password_change_revokes_every_device(self, pool):
        account = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        first, _ = await sessions.create_session(account.id, ttl_days=7)
        second, _ = await sessions.create_session(account.id, ttl_days=7)
        assert len(pool.sessions) == 2

        removed = await accounts_service.revoke_all_sessions(account.id)
        assert removed == 2
        assert await accounts_service.authenticate(first) is None
        assert await accounts_service.authenticate(second) is None

    async def test_blocking_is_seen_immediately(self, pool):
        """blocked_at is read on the same query as the session, so it cannot lag."""
        account = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        token, _ = await sessions.create_session(account.id, ttl_days=7)
        assert await accounts_service.authenticate(token) is not None

        # Account is a frozen dataclass, so the row behind it is what changes —
        # which is also what a real admin UPDATE would do.
        pool.users["dev@local.invalid"]["blocked_at"] = datetime.now(timezone.utc)

        assert (await accounts_service.authenticate(token)).blocked_at is not None

    async def test_purge_removes_only_expired_rows(self, pool):
        account = await accounts_service.get_or_create_bypass_account("dev@local.invalid")
        live, _ = await sessions.create_session(account.id, ttl_days=7)
        dead, _ = await sessions.create_session(account.id, ttl_days=7)
        pool.sessions[hashlib.sha256(dead.encode()).hexdigest()]["expires_at"] = (
            datetime.now(timezone.utc) - timedelta(days=1)
        )

        assert await sessions.purge_expired_sessions() == 1
        assert await accounts_service.authenticate(live) is not None
        assert await accounts_service.authenticate(dead) is None

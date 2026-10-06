"""
Password hashing.

Argon2id via argon2-cffi, and nothing else. passlib was declared in
requirements.txt for years and never installed or imported; its bcrypt backend has
also been broken against bcrypt >= 4.1, and the package is unmaintained. The
legal terms require a slow salted KDF, and this is the one that satisfies it.

Two properties the callers depend on:

- verify_password() never raises. A stored hash that cannot be parsed — a legacy
  row, a truncated column, a seeded placeholder — is a failed login, not a 500.
  A login path that 500s on a corrupt row is an availability problem on top of an
  authentication problem.
- The parameters live here, in one place, so they can be raised without hunting.
  These are the argon2-cffi defaults (m=65536 KiB, t=3, p=4). Raising time_cost
  later invalidates nothing: verification reads the parameters out of the hash.
"""

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError

# Verification is deliberately not parallelised: p=4 uses the extra memory to make
# each guess expensive, which is what raises the cost of an offline attack on a
# stolen hash. Splitting one verification across four cores would undo that.
_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Hash a plaintext password for storage. Never store the input."""
    return _hasher.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    """Return True only for the password that produced this hash."""
    if not stored_hash or not password:
        return False
    try:
        return _hasher.verify(stored_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False
    except Exception:  # noqa: BLE001
        # An unparseable hash must read as a wrong password. Anything else here
        # turns a corrupt row into a server error on the login path.
        return False


def needs_rehash(stored_hash: str) -> bool:
    """True when the stored hash used weaker parameters than the current ones."""
    try:
        return _hasher.check_needs_rehash(stored_hash)
    except (InvalidHashError, Exception):  # noqa: BLE001
        return True
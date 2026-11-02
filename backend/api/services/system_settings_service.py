"""
Reading and writing the price, the payment destinations, and the contact address.

`system_settings` holds these values and nothing else writes them, which is the
point: the values used to exist in a document, so nothing could read them
programmatically and nobody could change them without editing prose. There is one
function that writes and one that reads per key, here, rather than SQL in two
routers — the same rule `accounts.py` follows for `blocked_at`, because two
writers means an update that cannot be reconciled with the other one.

Validation lives here, not in the routers. A router checks the shape of the
request (is this an integer?), and that is a different job from deciding what is
a sane amount of money or a deliverable address. Putting the bounds in both
places guarantees the two disagree eventually.
"""

import json
import logging
import re
from dataclasses import dataclass

from api.core.db import get_pool

logger = logging.getLogger(__name__)

PRICING_KEY = "pricing"
BANK_ACCOUNTS_KEY = "bank_accounts"
CONTACT_SUPPORT_KEY = "contact_support"

# Rupiah. Cheap enough that the ceiling is not a product decision and generous
# enough that a mistyped number cannot put a zero in front of a real subscriber:
# the most expensive plan anyone has proposed is six figures, so anything past
# nine figures is a missing decimal point rather than a price.
MIN_PRICE_IDR = 1_000
MAX_PRICE_IDR = 1_000_000_000

# Rekening tujuan: an operational ceiling well past anything an install would
# publish, so a paste accident fails loudly instead of turning the payment page
# into a list nobody scans. Not part of the blueprint's JSON shape — that shape
# is `[{"bank", "account_number", "holder_name"}]` exactly.
MAX_BANK_ACCOUNTS = 20
BANK_NAME_MAX = 60
HOLDER_NAME_MAX = 100
ACCOUNT_NUMBER_MAX = 30

# The published support address. RFC 5321 caps a reverse-path at 254 characters
# and the local part at 64, so anything longer is a paste accident rather than an
# address somebody can be told to write to.
EMAIL_MAX = 254
EMAIL_LOCAL_MAX = 64


class PriceOutOfRange(ValueError):
    """A price outside what an amount of rupiah can plausibly be."""

    def __init__(self, field: str, value: int) -> None:
        super().__init__(f"{field} is {value}, outside {MIN_PRICE_IDR}..{MAX_PRICE_IDR}")
        self.field = field


class PricingUnavailable(RuntimeError):
    """The `pricing` row is missing or unreadable.

    Not the same as "the price is zero". A missing row means the install is
    broken — the migration that seeds it has not run — and answering that with a
    number would report a price nobody ever set.
    """


@dataclass(frozen=True)
class Pricing:
    weekly: int
    monthly: int
    annual: int
    updated_at: str | None = None


@dataclass(frozen=True)
class BankAccountEntry:
    """One destination a manual transfer can be paid into.

    Stored as a plain object rather than passed around as a dict so the three
    fields' names — and the fact that this answer has exactly three — live here,
    not at every consumer.
    """

    bank: str
    account_number: str
    holder_name: str


class BankAccountInvalid(ValueError):
    """A list of rekening tujuan that is empty or holds an unusable entry.

    An empty list is refused rather than stored because saving an empty list and
    deleting every destination are the same action, and that action is a
    decision an operator makes in one breath, not a by-product of a form whose
    last row was removed by accident. An install that truly wants none simply
    never writes the key.
    """


class BankAccountsUnavailable(RuntimeError):
    """The `bank_accounts` row exists but does not hold a usable list.

    Same reasoning as `PricingUnavailable`: the row is installed state, so noise
    inside it is a broken write, not a new fact about where to send money.
    """


class ContactInvalid(ValueError):
    """An address that could not be delivered to, published as fact.

    Refused on write because the footer turns this value into a `mailto:` link:
    a string that is not an address is a control that sends mail nowhere, and
    `docs/settings-module-spec.md` R-26 already rules that a half-written contact
    row is not rendered at all.
    """


class ContactUnavailable(RuntimeError):
    """The `contact_support` row exists but does not hold a usable address."""


def _json_value(value) -> dict:
    """The JSONB payload as a structure, whichever way the driver handed it over.

    asyncpg decodes jsonb as text when no codec is set — and none is set, because
    a global codec belongs in db.py's pool setup and every existing consumer
    pre-dates it. So the same row arrives here as text from the live database and
    as a dict from the suite's fake pool. Accepting only one of the two is how a
    green suite ships a 503.
    """
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict):
        raise TypeError(f"expected a JSON object, got {type(value).__name__}")
    return value


def _validate(weekly: int, monthly: int, annual: int) -> None:
    for field, value in (("weekly", weekly), ("monthly", monthly), ("annual", annual)):
        # No explicit bool check: bool is an int subclass, so True would pass
        # isinstance(value, int) — but True is 1 and False is 0, and both are
        # below MIN_PRICE_IDR, so the range test below refuses them anyway. A
        # dedicated branch here would be unreachable defence.
        if not isinstance(value, int) or value < MIN_PRICE_IDR or value > MAX_PRICE_IDR:
            raise PriceOutOfRange(field, value)


async def read_pricing() -> Pricing:
    """The current price, or raise. Never a substitute number."""
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT value, updated_at
          FROM system_settings
         WHERE key = $1
        """,
        PRICING_KEY,
    )
    if row is None:
        raise PricingUnavailable(
            f"no '{PRICING_KEY}' row in system_settings — run db.migrate"
        )
    try:
        value = _json_value(row["value"])
        weekly = value["weekly"]
        monthly = value["monthly"]
        annual = value["annual"]
        if isinstance(weekly, bool) or isinstance(monthly, bool) or isinstance(annual, bool):
            raise TypeError("a boolean is not a price")
        # The same check the writer runs. A row can be hand-edited or seeded
        # wrong, and `{"monthly": 0}` served as a 200 is exactly the "quote them
        # for free" failure this endpoint exists to avoid — validating only on
        # write would make the guarantee hold for exactly as long as nobody edits
        # the table by hand.
        _validate(weekly, monthly, annual)
    except (KeyError, TypeError, ValueError, PriceOutOfRange) as exc:
        raise PricingUnavailable(
            f"'{PRICING_KEY}' does not hold three usable prices: {exc}"
        ) from exc

    # No rounding on the way out. `int(15000.7)` would answer 15000 for a row that
    # says 15000.7 — quoting a number the server does not hold.
    if weekly != int(weekly) or monthly != int(monthly) or annual != int(annual):
        raise PricingUnavailable(f"'{PRICING_KEY}' holds a fractional price")

    updated = row["updated_at"]
    return Pricing(
        weekly=int(weekly),
        monthly=int(monthly),
        annual=int(annual),
        updated_at=updated.isoformat() if updated else None,
    )


async def write_pricing(weekly: int, monthly: int, annual: int) -> Pricing:
    """Replace all three prices and return what the server now holds.

    Written as one statement so the three cannot be half-applied: a reader
    between them would otherwise see a new weekly price against old monthly and
    annual ones, which is a combination that never existed.
    """
    _validate(weekly, monthly, annual)
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ($1, jsonb_build_object('weekly', $2::int, 'monthly', $3::int,
                                        'annual', $4::int), NOW())
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = EXCLUDED.updated_at
        RETURNING updated_at
        """,
        PRICING_KEY,
        weekly,
        monthly,
        annual,
    )
    logger.info(
        "settings: pricing set to weekly=%s monthly=%s annual=%s",
        weekly,
        monthly,
        annual,
    )
    updated = row["updated_at"] if row else None
    return Pricing(weekly=weekly, monthly=monthly, annual=annual,
                   updated_at=updated.isoformat() if updated else None)


# ── Rekening tujuan ──────────────────────────────────────────────────────────

_ACCOUNT_NUMBER_RE = re.compile(r"[0-9]{1,%d}" % ACCOUNT_NUMBER_MAX)


def _clean_entry(entry) -> BankAccountEntry:
    """Validate one destination, or say exactly what is wrong with it.

    The field names come from the blueprint, so a typo'd key here is the caller's
    mistake, not a different but compatible shape: anything missing or empty is
    refused rather than stored as an empty string.
    """
    if not isinstance(entry, dict):
        raise BankAccountInvalid(
            "each account must be an object with bank, account_number and "
            f"holder_name; got {type(entry).__name__}"
        )
    bank = _bounded_text(entry.get("bank"), "bank", BANK_NAME_MAX)
    number = entry.get("account_number")
    if not isinstance(number, str) or not _ACCOUNT_NUMBER_RE.fullmatch(number.strip()):
        raise BankAccountInvalid(
            "account_number must be digits only (%d at most, got %r)"
            % (ACCOUNT_NUMBER_MAX, number)
        )
    holder = _bounded_text(entry.get("holder_name"), "holder_name", HOLDER_NAME_MAX)
    return BankAccountEntry(bank=bank, account_number=number.strip(), holder_name=holder)


def _bounded_text(raw, field: str, max_len: int) -> str:
    if not isinstance(raw, str):
        raise BankAccountInvalid(f"{field} must be a string")
    text = " ".join(raw.split())
    if not text:
        raise BankAccountInvalid(f"{field} cannot be empty")
    if len(text) > max_len:
        raise BankAccountInvalid(f"{field} is longer than {max_len} characters")
    return text


def _clean_entries(entries) -> list[BankAccountEntry]:
    if not isinstance(entries, list):
        raise BankAccountInvalid("the payload must be a list of accounts")
    if not entries:
        raise BankAccountInvalid(
            "an empty list is refused: saving it would delete every destination"
        )
    if len(entries) > MAX_BANK_ACCOUNTS:
        raise BankAccountInvalid(
            f"at most {MAX_BANK_ACCOUNTS} destinations; got {len(entries)}"
        )
    return [_clean_entry(e) for e in entries]


async def read_bank_accounts() -> tuple[list[BankAccountEntry], str | None]:
    """The destinations as installed, or an empty list when none were ever set.

    A missing row is a state, not an error: an install the operator has not
    configured yet must answer "belum ada" rather than 503, because the payment
    page reads this endpoint to decide how to tell a visitor what to do.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT value, updated_at
          FROM system_settings
         WHERE key = $1
        """,
        BANK_ACCOUNTS_KEY,
    )
    if row is None:
        return [], None
    try:
        value = _json_value(row["value"])
        entries = _clean_entries(value["accounts"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise BankAccountsUnavailable(
            f"'{BANK_ACCOUNTS_KEY}' does not hold a usable account list: {exc}"
        ) from exc

    updated = row["updated_at"]
    return entries, updated.isoformat() if updated else None


async def write_bank_accounts(entries) -> list[BankAccountEntry]:
    """Replace the destination list, after validating it. Refuses an empty one.

    Written through the same upsert as the price so a reader cannot catch the
    setting half-applied, and the whole validated list is one statement's truth.
    """
    cleaned = _clean_entries(entries)
    pool = await get_pool()
    await pool.fetchrow(
        """
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ($1, jsonb_build_object('accounts', $2::jsonb), NOW())
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = EXCLUDED.updated_at
        """,
        BANK_ACCOUNTS_KEY,
        json.dumps(
            [
                {
                    "bank": e.bank,
                    "account_number": e.account_number,
                    "holder_name": e.holder_name,
                }
                for e in cleaned
            ]
        ),
    )
    logger.info("settings: bank_accounts set (%d destinations)", len(cleaned))
    return cleaned


# ── Kontak bantuan ───────────────────────────────────────────────────────────

# Local part: what RFC 5321 lets through unquoted. Domain: letters, digits, dot
# and hyphen, with the label structure checked separately below rather than
# crammed into one pattern that nobody can read.
_EMAIL_RE = re.compile(
    rf"^(?P<local>[A-Za-z0-9._%+\-]{{1,{EMAIL_LOCAL_MAX}}})"
    rf"@(?P<domain>[A-Za-z0-9.\-]{{1,253}})$"
)


def _clean_email(raw) -> str:
    """The published address, cleaned, or a refusal saying what is wrong.

    Empty in, empty out: clearing the address is a state the operator chooses, and
    the form names it rather than letting the field look untouched. Everything
    else has to survive being pasted into a mail client.
    """
    if not isinstance(raw, str):
        raise ContactInvalid("email must be a string")
    text = " ".join(raw.split())
    if not text:
        return ""
    if text.lower().startswith("mailto:"):
        raise ContactInvalid("write the address itself, without a mailto: prefix")
    if len(text) > EMAIL_MAX:
        raise ContactInvalid(f"email is longer than {EMAIL_MAX} characters")
    match = _EMAIL_RE.fullmatch(text)
    if not match:
        raise ContactInvalid(f"{text!r} is not a single email address")
    domain = match.group("domain")
    labels = domain.split(".")
    if len(labels) < 2 or domain.startswith(".") or domain.endswith("."):
        raise ContactInvalid(f"{domain!r} is not a domain an address can end in")
    if any(label.startswith("-") or label.endswith("-") for label in labels):
        raise ContactInvalid(f"{domain!r} has a label that starts or ends with a hyphen")
    if not all(labels[1:]):
        raise ContactInvalid(f"{domain!r} has an empty label")
    return text


async def read_contact_support() -> tuple[str, str | None]:
    """The published support address, or `("", None)` when none was ever set.

    A missing row is a state, not an error, exactly as with the destinations: an
    install the operator has not configured yet must answer "belum ada" so the
    footer can render no contact row at all, rather than 503 or an empty link.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT value, updated_at
          FROM system_settings
         WHERE key = $1
        """,
        CONTACT_SUPPORT_KEY,
    )
    if row is None:
        return "", None
    try:
        value = _json_value(row["value"])
        email = _clean_email(value["email"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ContactUnavailable(
            f"'{CONTACT_SUPPORT_KEY}' does not hold a usable address: {exc}"
        ) from exc

    updated = row["updated_at"]
    return email, updated.isoformat() if updated else None


async def write_contact_support(email: str) -> str:
    """Publish `email`, or clear the address when it is empty.

    One upsert, the same shape as the other two keys, so a reader cannot catch a
    half-applied change. Clearing writes an empty string rather than deleting the
    row: one write path, and `updated_at` still says when the operator last
    decided.
    """
    cleaned = _clean_email(email)
    pool = await get_pool()
    await pool.fetchrow(
        """
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ($1, jsonb_build_object('email', $2::text), NOW())
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = EXCLUDED.updated_at
        """,
        CONTACT_SUPPORT_KEY,
        cleaned,
    )
    logger.info(
        "settings: contact_support %s", cleaned if cleaned else "cleared"
    )
    return cleaned
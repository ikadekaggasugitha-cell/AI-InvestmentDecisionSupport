"""
Reading and writing the settings an operator owns: the price, the payment
destinations, the online payment channels, the contact address, and the email
configuration.

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

The `smtp` key is the one that reverses a recorded decision: its credential is
stored as plaintext jsonb, readable in any backup and by anyone with read access
to Postgres. The mitigations that could be built are built — no endpoint returns
the value, no log line prints one, and the send path is the only reader — and the
consequence that could not be mitigated is written down in
`docs/adr/00NN-smtp-di-database.md`.
"""

import json
import logging
import re
from dataclasses import dataclass
from dataclasses import field as dataclass_field

from api.core.db import get_pool
# Both registries answer "is this key known", about two different vocabularies.
# Imported under distinct names on purpose: one shared `is_known` would let a
# channel list be validated against the bank codes and pass, since neither name
# is reserved by the other.
from api.services.bank_registry import OTHER_CODE
from api.services.bank_registry import is_known as is_known_bank
from api.services.channel_registry import is_known as is_known_channel

logger = logging.getLogger(__name__)

PRICING_KEY = "pricing"
BANK_ACCOUNTS_KEY = "bank_accounts"
CONTACT_SUPPORT_KEY = "contact_support"
PAYMENT_CHANNELS_KEY = "payment_channels"
SMTP_KEY = "smtp"

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

    Stored as a plain object rather than passed around as a dict so the field
    names — and how many there are — live here, not at every consumer.

    `code` is the key into `bank_registry`, not a clearing code; `bank` is what
    gets printed. `enabled` says whether the paying public sees this row at all:
    an operator who is preparing a destination, or retiring one, should not have
    to publish it to every customer to record it.
    """

    bank: str
    account_number: str
    holder_name: str
    code: str = OTHER_CODE
    enabled: bool = True


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

    The two newer fields are optional *when absent* and strict *when present*.
    That asymmetry is deliberate and it is what keeps a live install working:

      * A row written before `code`/`enabled` existed has neither. Reading it
        must not fail — `read_bank_accounts` answers 503 when the list is
        unusable, and a 503 here would take the payment page away from every
        customer of an install that was working fine yesterday. So absent means
        `other` (the name they typed is still the name) and `enabled` (it was
        published before, so it stays published).
      * A `code` that is present but unknown is a different thing. That is a
        write from something that does not know the list, and storing it would
        put a row on the admin screen whose bank cannot be selected again.
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

    raw_code = entry.get("code")
    if raw_code is None:
        code = OTHER_CODE
    else:
        code = " ".join(str(raw_code).split()).lower()
        if not is_known_bank(code):
            raise BankAccountInvalid(f"unknown bank code {code!r}")

    raw_enabled = entry.get("enabled")
    enabled = True if raw_enabled is None else bool(raw_enabled)

    return BankAccountEntry(
        bank=bank,
        account_number=number.strip(),
        holder_name=holder,
        code=code,
        enabled=enabled,
    )


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
                    "code": e.code,
                    "enabled": e.enabled,
                }
                for e in cleaned
            ]
        ),
    )
    logger.info(
        "settings: bank_accounts set (%d destinations, %d shown to users)",
        len(cleaned),
        sum(1 for e in cleaned if e.enabled),
    )
    return cleaned


# ── Kanal pembayaran ───────────────────────────────────────────────────────


class PaymentChannelsInvalid(ValueError):
    """A channel list naming something the registry does not know.

    Refused on write rather than stored, because an unknown key sent to the
    gateway is not an error the payer sees: the method simply never appears on
    the payment page, and the operator is left wondering why.
    """


class PaymentChannelsUnavailable(RuntimeError):
    """The `payment_channels` row exists but does not hold a usable list."""


async def read_payment_channels() -> tuple[list[str] | None, str | None]:
    """Which channels this install offers online, and when that was set.

    The two answers are different and the difference is the whole point of
    returning None rather than an empty list. Before the admin panel had this
    setting, the gateway's own dashboard decided which methods a payer could
    see, and we sent no `enabled_payments` at all. If "never written" read as
    "nothing enabled", deploying this feature would silently remove every payment
    method a working install had — the same class of surprise as a bank row that
    stops parsing. So: None means leave the gateway alone, a list means constrain
    it to exactly these.

    `updated_at` comes along for the admin form, which has to show when the
    choice was last made; the money path ignores it and reads the same row once.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT value, updated_at
          FROM system_settings
         WHERE key = $1
        """,
        PAYMENT_CHANNELS_KEY,
    )
    if row is None:
        return None, None
    try:
        value = _json_value(row["value"])
        raw = value["channels"]
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise PaymentChannelsUnavailable(
            f"'{PAYMENT_CHANNELS_KEY}' does not hold a usable channel list: {exc}"
        ) from exc

    if not isinstance(raw, list):
        raise PaymentChannelsUnavailable(
            f"'{PAYMENT_CHANNELS_KEY}' holds {type(raw).__name__}, expected a list"
        )
    # A key the registry does not know is left out of the answer, not deleted
    # from the row: read never rewrites what something else wrote. It cannot
    # become a payment method either way, because it has no gateway code, so
    # what is being refused here is a label on a payer's screen that nobody
    # could ever pay with.
    updated = row["updated_at"]
    return (
        [str(k) for k in raw if is_known_channel(str(k))],
        updated.isoformat() if updated else None,
    )


async def write_payment_channels(channels) -> list[str]:
    """Replace the enabled channel list.

    Unlike the destination list, an empty one is accepted here. It means "no
    online payment method", which is a coherent thing for an operator to decide
    on an install that only takes manual transfers — different from deleting
    every bank destination, which would leave the manual path with nowhere to
    send money.
    """
    if not isinstance(channels, list):
        raise PaymentChannelsInvalid("the payload must be a list of channels")
    cleaned: list[str] = []
    for entry in channels:
        key = " ".join(str(entry).split()).lower()
        if not is_known_channel(key):
            raise PaymentChannelsInvalid(f"unknown payment channel {entry!r}")
        if key not in cleaned:
            cleaned.append(key)

    pool = await get_pool()
    await pool.fetchrow(
        """
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ($1, jsonb_build_object('channels', $2::jsonb), NOW())
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = EXCLUDED.updated_at
        """,
        PAYMENT_CHANNELS_KEY,
        json.dumps(cleaned),
    )
    logger.info("settings: payment_channels set (%d enabled)", len(cleaned))
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

# ── Konfigurasi email ───────────────────────────────────────────────────────

SMTP_HOST_MAX = 253
SMTP_USERNAME_MAX = 320
SMTP_PASSWORD_MAX = 320

# Port 465 is implicit TLS and 587 is STARTTLS. They are not stored as a rule —
# `email_transport` already picks the protocol class from the port — so this is
# only the window a typo can fall into. Zero and sixty-five-five-three-six are
# not ports anyone dials.
SMTP_PORT_MIN = 1
SMTP_PORT_MAX = 65535


class SmtpInvalid(ValueError):
    """A field the operator wrote that this install could not send with.

    Refused on write rather than stored. A host with a space in it, or a port
    outside the range, produces a send failure minutes later in a queue the
    operator is not looking at; naming it here is the difference between a form
    that says "no" and a confirmation email that never arrives.
    """


class SmtpUnavailable(RuntimeError):
    """The `smtp` row exists but does not hold a usable configuration."""


@dataclass(frozen=True)
class SmtpStored:
    """What the `smtp` row holds, field by field.

    `None` on any field means the row says nothing about it and the deployment's
    environment still answers — that is the whole override rule, and it is why
    saving a host does not silently pin a port someone never looked at.

    `password` carries no `repr`. The dataclass is what a log line or a debugger
    would reach for, and a plaintext credential printing itself there is the
    specific thing this shape is built to avoid. The password is stored as
    plaintext in the row — that is the owner's decision, recorded in
    `docs/adr/00NN-smtp-di-database.md` — but it does not have to go further than
    the row on its own.
    """

    host: str | None = None
    port: int | None = None
    username: str | None = None
    mail_from: str | None = None
    use_tls: bool | None = None
    enabled: bool | None = None
    password: str | None = dataclass_field(repr=False, default=None)

    @property
    def has_password(self) -> bool:
        return bool(self.password)


def _clean_smtp_host(raw) -> str | None:
    """A bare hostname, or None meaning "the environment answers this one".

    No scheme and no spaces, because both are paste accidents that produce a host
    that cannot be looked up, and `smtplib` reports that as a connection error
    three layers away from the form that caused it.
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise SmtpInvalid("host must be a string")
    # Outer whitespace is a paste artefact and is dropped. Inner whitespace is
    # not: squashing `smtp example.test` into `smtpexample.test` would store a
    # different host than the one the operator typed, and a different host is
    # exactly what this function exists to refuse.
    text = raw.strip()
    if not text:
        return None
    if len(text) > SMTP_HOST_MAX:
        raise SmtpInvalid(f"host is longer than {SMTP_HOST_MAX} characters")
    if "://" in text:
        raise SmtpInvalid("write the host alone, without http:// or smtp://")
    if any(c.isspace() for c in text):
        raise SmtpInvalid("host cannot contain a space")
    if ":" in text:
        raise SmtpInvalid(
            "write the host alone; the port has its own field"
        )
    if not re.fullmatch(r"[A-Za-z0-9.\-]+", text):
        raise SmtpInvalid(f"{text!r} is not a host name")
    return text.lower()


def _clean_smtp_port(raw) -> int | None:
    if raw is None or raw == "":
        return None
    try:
        port = int(raw)
    except (TypeError, ValueError) as exc:
        raise SmtpInvalid("port must be a whole number") from exc
    if not SMTP_PORT_MIN <= port <= SMTP_PORT_MAX:
        raise SmtpInvalid(
            f"port must be between {SMTP_PORT_MIN} and {SMTP_PORT_MAX}"
        )
    return port


def _clean_smtp_text(raw, maximum: int, label: str) -> str | None:
    """One line, trimmed, or None when the operator left it empty.

    A newline in a username or a password is not a formatting curiosity: SMTP
    folds headers and commands on CRLF, so an embedded line ends the argument and
    starts another one. Refusing it here is also the guard against a value pasted
    with trailing whitespace, which the server will not strip.
    """
    if raw is None:
        return None
    if not isinstance(raw, str):
        raise SmtpInvalid(f"{label} must be a string")
    if any(c in raw for c in ("\r", "\n", "\x00")):
        raise SmtpInvalid(f"{label} cannot contain a line break")
    text = raw.strip()
    if not text:
        return None
    if len(text) > maximum:
        raise SmtpInvalid(f"{label} is longer than {maximum} characters")
    return text


def _clean_smtp_bool(raw) -> bool | None:
    """None stays None — the environment keeps answering until told otherwise."""
    if raw is None or raw == "":
        return None
    return bool(raw)


async def read_smtp(conn=None) -> SmtpStored | None:
    """The stored email configuration, or None when the row was never written.

    None is a state, not an error, and the distinction is what keeps the admin
    form honest: an install whose email comes from `.env` has nothing in this row
    and must not be shown an empty form as though someone had cleared it.

    `conn` is the caller's own connection. The approve and deny paths read this
    while holding one inside a database transaction, and a second acquire from
    the pool there would be a pool-size dependency hiding in a settings read — the
    same reason `_recipient_email` takes a connection.
    """
    reader = conn if conn is not None else await get_pool()
    row = await reader.fetchrow(
        """
        SELECT value, updated_at
          FROM system_settings
         WHERE key = $1
        """,
        SMTP_KEY,
    )
    if row is None:
        return None
    try:
        value = _json_value(row["value"])
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        raise SmtpUnavailable(
            f"'{SMTP_KEY}' does not hold a usable configuration: {exc}"
        ) from exc
    if not isinstance(value, dict):
        raise SmtpUnavailable(
            f"'{SMTP_KEY}' holds {type(value).__name__}, expected an object"
        )

    try:
        # Unknown keys are ignored rather than refused: the row outlives the code
        # that wrote it, and a field a later version adds must not make email
        # unreadable for an install that rolls back.
        stored = SmtpStored(
            host=_clean_smtp_host(value.get("host")),
            port=_clean_smtp_port(value.get("port")),
            username=_clean_smtp_text(
                value.get("username"), SMTP_USERNAME_MAX, "username"
            ),
            mail_from=(
                _clean_email(value.get("from_address")) or None
                if value.get("from_address") is not None
                else None
            ),
            use_tls=_clean_smtp_bool(value.get("use_tls")),
            enabled=_clean_smtp_bool(value.get("enabled")),
            password=(
                _clean_smtp_text(value.get("password"), SMTP_PASSWORD_MAX, "password")
                if value.get("password")
                else None
            ),
        )
    except ContactInvalid as exc:
        # The address validator is the one the contact form already uses. Its
        # error type is re-raised under this key's name so a caller catching
        # `SmtpInvalid` catches everything about this row.
        raise SmtpInvalid(str(exc)) from exc
    return stored


async def read_smtp_updated_at() -> str | None:
    """When the email configuration was last written, or None.

    Separate from `read_smtp()` because the send path asks the first question a
    dozen times a minute and has no use for a timestamp; the form asks both, and
    one statement each is cheaper than a tuple every caller has to unpack.
    """
    pool = await get_pool()
    row = await pool.fetchrow(
        """
        SELECT updated_at
          FROM system_settings
         WHERE key = $1
        """,
        SMTP_KEY,
    )
    if row is None:
        return None
    updated = row["updated_at"]
    return updated.isoformat() if updated else None


async def write_smtp(payload: dict) -> SmtpStored:
    """Replace the stored email configuration with what the operator wrote.

    Two rules here that are not decoration:

    * An empty `password` keeps the one already stored. A form that sends the
      other five fields without the secret — which is what editing a hostname
      looks like — would otherwise delete the credential and the operator would
      find out on the next failed send, from a queue they are not watching.
    * A field left empty is written as absent, so the environment answers it
      again. Clearing one field is not a request to pin every other one.

    `updated_at` is set by the same statement, so the timestamp the form shows is
    the write's own, not a second call that could disagree with it.
    """
    if not isinstance(payload, dict):
        raise SmtpInvalid("the email configuration must be an object")

    previous = await read_smtp()
    raw_password = payload.get("password")
    if isinstance(raw_password, str) and raw_password.strip():
        password = _clean_smtp_text(raw_password, SMTP_PASSWORD_MAX, "password")
    else:
        # Absent or blank: whatever is already there stays there.
        password = previous.password if previous is not None else None

    from_address = payload.get("fromAddress")
    try:
        # Absent means "the environment keeps answering", not "the address must be
        # a string". The validator's own empty-in-empty-out rule then does the
        # rest: clearing the field is a choice the operator can make and see.
        cleaned_from = (
            _clean_email(from_address) or None
            if from_address is not None
            else None
        )
    except ContactInvalid as exc:
        raise SmtpInvalid(str(exc)) from exc

    stored = SmtpStored(
        host=_clean_smtp_host(payload.get("host")),
        port=_clean_smtp_port(payload.get("port")),
        username=_clean_smtp_text(
            payload.get("username"), SMTP_USERNAME_MAX, "username"
        ),
        mail_from=cleaned_from,
        use_tls=_clean_smtp_bool(payload.get("useTls")),
        enabled=_clean_smtp_bool(payload.get("enabled")),
        password=password,
    )

    value = {
        "host": stored.host,
        "port": stored.port,
        "username": stored.username,
        "from_address": stored.mail_from,
        "use_tls": stored.use_tls,
        "enabled": stored.enabled,
        "password": stored.password,
    }
    pool = await get_pool()
    await pool.fetchrow(
        """
        INSERT INTO system_settings (key, value, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value,
                updated_at = EXCLUDED.updated_at
        """,
        SMTP_KEY,
        # `None` values are kept in the object: "this field is unset" is the fact
        # the next read has to see, and dropping the key would say the same thing
        # in a way the row cannot tell apart from a version that never had it.
        json.dumps(value),
    )
    # Which fields changed, never what they became. The password is included as a
    # name when it is written, and the name is not the value.
    changed = [
        key
        for key, before, after in (
            ("host", previous.host if previous else None, stored.host),
            ("port", previous.port if previous else None, stored.port),
            ("username", previous.username if previous else None, stored.username),
            ("from_address", previous.mail_from if previous else None, stored.mail_from),
            ("use_tls", previous.use_tls if previous else None, stored.use_tls),
            ("enabled", previous.enabled if previous else None, stored.enabled),
            ("password", previous.has_password if previous else False, stored.has_password),
        )
        if before != after
    ]
    logger.info("settings: smtp written (%s)", ", ".join(changed) or "no field changed")
    return stored

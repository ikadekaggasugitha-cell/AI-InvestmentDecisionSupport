"""The list of banks an operator can choose a transfer destination from.

One source, served to the admin panel over the API rather than copied into the
frontend. A list that lives in two places is a list that eventually disagrees,
and the disagreement is discovered by someone trying to select a bank the other
half has never heard of.

**What a `code` is, and what it is not.** It is an internal key for our own use:
it names the row, it survives a rename of the display name, and it is what
`system_settings.bank_accounts` stores. It is deliberately **not** a bank's
clearing code, not an SWIFT/BIC, and not a routing number. Those numbers decide
where money lands, and one wrong digit sends someone's payment to somebody else —
so none are written here, and nothing here should be treated as a substitute for
the bank's own published code. If a real one is ever needed, it comes from the
bank's documentation and that is a decision of its own, not a detail to fill in.

`other` exists because a curated list is, by definition, incomplete. Without it
an operator holding a destination at a smaller bank could not record it at all,
and the honest alternative — refusing — would be worse than letting them type the
name. When `code` is `other`, `bank` carries what they typed.
"""

from __future__ import annotations

from dataclasses import dataclass

OTHER_CODE = "other"


@dataclass(frozen=True)
class BankOption:
    code: str
    name: str


# Ordered the way an operator scans it: the banks most people hold accounts at
# first, then the rest alphabetically, then the escape hatch last.
BANK_OPTIONS: tuple[BankOption, ...] = (
    BankOption("bca", "BCA"),
    BankOption("mandiri", "Bank Mandiri"),
    BankOption("bni", "BNI"),
    BankOption("bri", "BRI"),
    BankOption("cimb", "CIMB Niaga"),
    BankOption("danamon", "Bank Danamon"),
    BankOption("permata", "Bank Permata"),
    BankOption("bsi", "Bank Syariah Indonesia"),
    BankOption("mega", "Bank Mega"),
    BankOption("ninjex", "J&T Bank"),
    BankOption("neo", "Bank Neo Commerce"),
    BankOption("seabank", "SEABANK"),
    BankOption(OTHER_CODE, "Lainnya (tulis sendiri)"),
)

_NAMES: dict[str, str] = {option.code: option.name for option in BANK_OPTIONS}


def is_known(code: str) -> bool:
    return code in _NAMES


def display_name(code: str) -> str:
    """The name for a code, falling back to the code itself.

    A code stored before it was in the list must still be readable on screen, so
    this never raises. Refusing to render a row the operator did write would turn
    a bookkeeping change into a lost destination.
    """
    return _NAMES.get(code, code)


def options() -> list[BankOption]:
    return list(BANK_OPTIONS)

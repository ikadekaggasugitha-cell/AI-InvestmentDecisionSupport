"""Payment channels: what the payer can choose, and what the gateway is told.

One registry, three questions answered from it, because the three used to live in
three places that could disagree:

  * what the payer may pick on the payment screen,
  * what `transactions.payment_method` is allowed to hold,
  * what `enabled_payments` gets sent to Midtrans Snap.

**The Snap codes are the gateway's vocabulary, not ours.** Each one below was
taken from Midtrans' own Snap documentation, not inferred from what looks
plausible: `qris`, `bca_va`, `bni_va`, `permata_va`, `credit_card`, `gopay`,
`shopeepay`. Two are worth flagging because a wrong guess here fails silently:

  * Mandiri's virtual account is **`echannel`**, not `mandiri_va`. Midtrans' own
    alias documents `bank_transfer` as expanding to
    `permata_va, bca_va, bni_va, bri_va, echannel`, and `echannel` is the entry
    that stands for Mandiri. A code that is almost right does not error; the
    method simply never appears on the payment page.
  * `bank_transfer` is an **alias** in Snap, meaning "every virtual account". In
    this codebase it already means something else: the payer wired money to a
    destination the operator typed, with no gateway involved. Those two must not
    share a key that gets sent outward, so `bank_transfer` here is
    declare-only — `snap` is None, and it can never reach a Snap request.

A new code should be added only against the documentation, and a channel whose
`snap` is None is by construction impossible to offer online.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Channel:
    key: str
    label: str
    snap: str | None


# `label` is what a payer reads. It names the instrument, never the company that
# processes it: the product decision on this screen is that the gateway's brand
# does not appear where a customer chooses how to pay.
CHANNELS: tuple[Channel, ...] = (
    Channel("qris", "QRIS", "qris"),
    Channel("credit_card", "Kartu kredit", "credit_card"),
    Channel("gopay", "GoPay", "gopay"),
    Channel("shopeepay", "ShopeePay", "shopeepay"),
    Channel("va_bca", "Virtual Account BCA", "bca_va"),
    Channel("va_bni", "Virtual Account BNI", "bni_va"),
    Channel("va_bri", "Virtual Account BRI", "bri_va"),
    Channel("va_mandiri", "Virtual Account Mandiri", "echannel"),
    Channel("va_permata", "Virtual Account Permata", "permata_va"),
    # Declared by a payer who moved money themselves. No gateway is involved, so
    # there is no code for it and it must never be sent as one.
    Channel("bank_transfer", "Transfer bank langsung", None),
)

_BY_KEY: dict[str, Channel] = {c.key: c for c in CHANNELS}


def is_known(key: str) -> bool:
    return key in _BY_KEY


def label(key: str) -> str:
    """The payer-facing name, falling back to the key.

    A row written before a channel was in the registry still has to render
    something rather than crash the payment page.
    """
    channel = _BY_KEY.get(key)
    return channel.label if channel else key


def gateway_keys() -> list[str]:
    """Channels that can be paid through the gateway at all."""
    return [c.key for c in CHANNELS if c.snap]


def snap_code(key: str) -> str | None:
    """The gateway's word for our key, or None if this channel is not a gateway one."""
    channel = _BY_KEY.get(key)
    return channel.snap if channel else None


def snap_codes(keys: list[str]) -> list[str]:
    """Gateway codes for the enabled channels, in the order given.

    Channels with no code are dropped rather than raising: an operator who
    enabled `bank_transfer` for declarations did not ask to send it to Snap, and
    an empty result is handled by the caller, which knows the difference between
    "nothing enabled" and "nothing was configured".
    """
    return [code for code in (snap_code(k) for k in keys) if code]


def options() -> list[Channel]:
    return list(CHANNELS)

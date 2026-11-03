"""Outbound email, through the standard library.

`smtplib` rather than a package, for one specific reason: the thing that drains
the outbox is a synchronous Celery task — `workers/signal_worker.py` is `def`,
not `async def`, and it bridges to asyncpg with an inner loop when it needs the
database. An async SMTP client would be wrapped in an event loop for no benefit,
and would add a dependency to `requirements.txt` that this file does not need.
Python has shipped an SMTP client since long before this project existed.

Configuration is read through one predicate, `email_configured()`, named rather
than inlined because two answers to "does mail go out from this install" would
disagree: the approve path would queue a message the panel told the operator
would never be sent, or the other way round. The queue copy, the worker and the
admin panel all call this module, exactly as the checkout path and the panel both
call `midtrans_service.gateway_configured()`.

Like that module, this one never returns a credential. `smtp_password` exists to
open a session and appears in no response, no log line and no admin screen — not
masked, not truncated, not as a length.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage

from api.core.config import get_settings

logger = logging.getLogger(__name__)

# A hung SMTP server must not become a hung worker. Without a timeout, a
# provider that accepts the TCP connection and then says nothing holds the
# Celery slot until the task's own time limit kills it — which looks like the
# worker is broken rather than like the provider is.
_CONNECT_TIMEOUT_SECONDS = 20

# Port 465 is implicit TLS: the connection is encrypted before any protocol
# bytes are exchanged, so STARTTLS on it fails. The transport picks the class
# from the port rather than adding a second flag that could disagree with the
# first.
_IMPLICIT_TLS_PORT = 465


class EmailUnavailable(RuntimeError):
    """This install cannot send mail at all — no host, no sender, or switched off.

    Distinct from `EmailSendFailed`, which means a configured server said no.
    Collapsing them would tell an operator to retry a send that can never
    succeed, or to configure a server that is already there.
    """


class EmailSendFailed(RuntimeError):
    """A configured server refused the message, or the connection broke."""


@dataclass(frozen=True)
class EmailStatus:
    """What this install has, and what it lacks, as separate facts.

    `configured` alone would leave an operator staring at "not configured"
    without knowing whether they forgot the flag, the host, or the sender — and
    those are three different edits in three different places.
    """

    enabled: bool
    has_host: bool
    has_sender: bool

    @property
    def configured(self) -> bool:
        return self.enabled and self.has_host and self.has_sender

    @property
    def missing(self) -> tuple[str, ...]:
        out: list[str] = []
        if not self.enabled:
            out.append("NOTIFICATIONS_ENABLED")
        if not self.has_host:
            out.append("SMTP_HOST")
        if not self.has_sender:
            out.append("SMTP_MAIL_FROM")
        return tuple(out)


def email_status() -> EmailStatus:
    settings = get_settings()
    return EmailStatus(
        enabled=settings.notifications_enabled,
        has_host=bool(settings.smtp_host.strip()),
        has_sender=bool(settings.smtp_mail_from.strip()),
    )


def email_configured() -> bool:
    """Whether mail actually leaves this install. The one question everyone asks."""
    return email_status().configured


def send_mail(recipient: str, subject: str, body: str) -> None:
    """Deliver one plain-text message, blocking until the server answers.

    Plain text, not the HTML invoice §7.2 sketches. An HTML invoice needs a
    logo asset, a template, and a decision about multipart alternatives; a
    payment confirmation that says the amount, the plan and the date the access
    ends is a complete message on its own, and shipping the text one is not
    blocked on designing the other.

    Raises `EmailUnavailable` when this install cannot send and `EmailSendFailed`
    when a configured server refuses. Never returns a truthy value on a failure:
    the caller marks the outbox row, and a row marked `sent` has to mean the
    server took it.
    """
    settings = get_settings()
    status = email_status()
    if not status.configured:
        raise EmailUnavailable(
            "no mail is sent from this install: " + ", ".join(status.missing) + " not set"
        )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = settings.smtp_mail_from
    message["To"] = recipient
    message.set_content(body)

    try:
        if settings.smtp_port == _IMPLICIT_TLS_PORT:
            client: smtplib.SMTP = smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=_CONNECT_TIMEOUT_SECONDS,
                context=ssl.create_default_context(),
            )
        else:
            client = smtplib.SMTP(
                settings.smtp_host, settings.smtp_port, timeout=_CONNECT_TIMEOUT_SECONDS
            )
    except OSError as exc:
        # Naming the host is fine; it is configuration, not a secret.
        raise EmailSendFailed(f"could not reach {settings.smtp_host}: {exc}") from exc

    try:
        with client:
            if settings.smtp_port != _IMPLICIT_TLS_PORT and settings.smtp_use_tls:
                client.starttls(context=ssl.create_default_context())
            # Username optional on purpose: a local relay that authenticates by
            # network position is a real deployment, and requiring the pair would
            # make that install look broken.
            if settings.smtp_username.strip():
                client.login(settings.smtp_username, settings.smtp_password)
            client.send_message(message)
    except smtplib.SMTPException as exc:
        raise EmailSendFailed(f"the mail server refused the message: {exc}") from exc
    except OSError as exc:
        raise EmailSendFailed(f"the connection to the mail server broke: {exc}") from exc

    # The address is personal data, so it is logged only as a fact about a send
    # that succeeded, never on the failure path where it would be repeated across
    # every retry.
    logger.info("email: delivered a %r message to the outbox row's recipient", subject)

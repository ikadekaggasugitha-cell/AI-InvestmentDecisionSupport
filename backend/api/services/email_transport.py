"""Outbound email, through the standard library.

`smtplib` rather than a package, for one specific reason: the thing that drains
the outbox is a synchronous Celery task — `workers/signal_worker.py` is `def`,
not `async def`, and it bridges to asyncpg with an inner loop when it needs the
database. An async SMTP client would be wrapped in an event loop for no benefit,
and would add a dependency to `requirements.txt` that this file does not need.
Python has shipped an SMTP client since long before this project existed.

**One reader of email configuration: `mail_config()`, and it reads the database
row at send time.** That sentence is the reason this file is shaped the way it
is. `get_settings()` is `lru_cache`d at import, so a form writing the host to
`system_settings` while the transport kept reading `Settings` would be a screen
that appears to save and changes nothing — a worse outcome than having no form,
because the operator would only find out from a confirmation email that never
arrived. So `mail_config()` resolves the stored row over the environment, field
by field, on every call, and nothing here reads `get_settings()` again.

Configuration is still answered through one predicate, `email_configured()`,
named rather than inlined because two answers to "does mail go out from this
install" would disagree: the approve path would queue a message the panel told
the operator would never be sent, or the other way round. The queue copy, the
worker and the admin panel all call this module, exactly as the checkout path and
the panel both call `midtrans_service.gateway_configured()`.

Like that module, this one never returns a credential. The password opens a
session and appears in no response, no log line and no admin screen — not masked,
not truncated, not as a length. It is stored as plaintext in `system_settings`,
which is the owner's decision and is recorded in
`docs/adr/00NN-smtp-di-database.md`; what this file can control is how far it
travels from that row, and the answer is nowhere.

`send_mail()` takes the resolved `MailConfig` rather than fetching it, because it
runs on a synchronous thread with no event loop of its own. The drain reads the
configuration once per beat and hands it to every row in that beat: a change the
operator saves takes effect on the next beat, with no restart, and the one beat
already in flight is not half old and half new.
"""

from __future__ import annotations

import logging
import smtplib
import ssl
from dataclasses import dataclass
from dataclasses import field as dataclass_field
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
    # Whether the stored row answered for any field. The panel shows it, because
    # "this install sends from the environment" and "this install sends from what
    # the operator typed" are different things to read while deciding where to
    # look next.
    from_database: bool = False

    @property
    def configured(self) -> bool:
        return self.enabled and self.has_host and self.has_sender

    @property
    def missing(self) -> tuple[str, ...]:
        """The load-bearing fields that have no value from either source.

        The names are the environment variables, which is the identifier that has
        always named these three, and it is still true: an entry here means
        neither the row nor the environment has a value, so the operator can fix
        it in the email editor or in `.env`. The admin panel lists them rather
        than a bare "not configured" because the three are three different edits.
        """
        out: list[str] = []
        if not self.enabled:
            out.append("NOTIFICATIONS_ENABLED")
        if not self.has_host:
            out.append("SMTP_HOST")
        if not self.has_sender:
            out.append("SMTP_MAIL_FROM")
        return tuple(out)


@dataclass(frozen=True)
class MailConfig:
    """Everything the transport needs for one send, resolved.

    `password` is kept out of `repr` for the same reason no endpoint returns it:
    a dataclass that prints itself into a log line is a credential in a log file,
    and this object is passed across a function boundary on purpose so the
    reading happens in exactly one place.
    """

    enabled: bool
    host: str
    port: int
    username: str
    mail_from: str
    use_tls: bool
    password: str = dataclass_field(repr=False, default="")
    from_database: bool = False


async def mail_config(conn=None) -> MailConfig:
    """The email configuration in force right now, row over environment.

    The only reader of email settings in this codebase, and deliberately not
    cached. Every field is resolved on its own, so an operator who stores only a
    host does not silently pin a port, a username, and a sender address copied
    from the form's initial display — the fields they left alone keep answering
    from `.env`.

    `conn` is passed through to the row read for the reason the approve path takes
    one everywhere: it already holds a connection inside a database transaction,
    and a settings read that acquired a second would make the pool's size a
    dependency of confirming a payment.

    An unusable row is not swallowed. `SmtpUnavailable` propagates: mail that
    stops because the stored configuration cannot be parsed is a broken install
    that has to say so, and falling back to the environment here would look like
    the operator's edit had been ignored.
    """
    from api.services.system_settings_service import read_smtp

    settings = get_settings()
    stored = await read_smtp(conn)
    if stored is None:
        return MailConfig(
            enabled=settings.notifications_enabled,
            host=settings.smtp_host.strip(),
            port=settings.smtp_port,
            username=settings.smtp_username.strip(),
            mail_from=settings.smtp_mail_from.strip(),
            use_tls=settings.smtp_use_tls,
            password=settings.smtp_password,
        )

    return MailConfig(
        enabled=(
            stored.enabled
            if stored.enabled is not None
            else settings.notifications_enabled
        ),
        host=stored.host if stored.host is not None else settings.smtp_host.strip(),
        port=stored.port if stored.port is not None else settings.smtp_port,
        username=(
            stored.username
            if stored.username is not None
            else settings.smtp_username.strip()
        ),
        mail_from=(
            stored.mail_from
            if stored.mail_from is not None
            else settings.smtp_mail_from.strip()
        ),
        use_tls=(
            stored.use_tls if stored.use_tls is not None else settings.smtp_use_tls
        ),
        password=(
            stored.password
            if stored.password is not None
            else settings.smtp_password
        ),
        from_database=True,
    )


async def email_status(conn=None) -> EmailStatus:
    """What this install has and what it lacks, from the configuration in force."""
    config = await mail_config(conn)
    return EmailStatus(
        enabled=config.enabled,
        has_host=bool(config.host),
        has_sender=bool(config.mail_from),
        from_database=config.from_database,
    )


async def email_configured(conn=None) -> bool:
    """Whether mail actually leaves this install. The one question everyone asks."""
    return (await email_status(conn)).configured


def _missing(config: MailConfig) -> tuple[str, ...]:
    """Which load-bearing fields have no value. Same three names `EmailStatus`
    uses, computed from a config already resolved rather than from a second read
    that could disagree with the first."""
    out: list[str] = []
    if not config.enabled:
        out.append("NOTIFICATIONS_ENABLED")
    if not config.host:
        out.append("SMTP_HOST")
    if not config.mail_from:
        out.append("SMTP_MAIL_FROM")
    return tuple(out)


def send_mail(recipient: str, subject: str, body: str, *, config: MailConfig) -> None:
    """Deliver one plain-text message, blocking until the server answers.

    `config` is required and resolved by the caller through `mail_config()`. That
    is not ceremony: this function runs on a synchronous thread with no event
    loop, and a transport that quietly read its own settings would be a second
    reader of the same row with a different idea of when it was read.

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
    missing = _missing(config)
    if missing:
        raise EmailUnavailable(
            "no mail is sent from this install: " + ", ".join(missing) + " not set"
        )

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = config.mail_from
    message["To"] = recipient
    message.set_content(body)

    try:
        if config.port == _IMPLICIT_TLS_PORT:
            client: smtplib.SMTP = smtplib.SMTP_SSL(
                config.host,
                config.port,
                timeout=_CONNECT_TIMEOUT_SECONDS,
                context=ssl.create_default_context(),
            )
        else:
            client = smtplib.SMTP(
                config.host, config.port, timeout=_CONNECT_TIMEOUT_SECONDS
            )
    except OSError as exc:
        # Naming the host is fine; it is configuration, not a secret.
        raise EmailSendFailed(f"could not reach {config.host}: {exc}") from exc

    try:
        with client:
            if config.port != _IMPLICIT_TLS_PORT and config.use_tls:
                client.starttls(context=ssl.create_default_context())
            # Username optional on purpose: a local relay that authenticates by
            # network position is a real deployment, and requiring the pair would
            # make that install look broken.
            if config.username:
                client.login(config.username, config.password)
            client.send_message(message)
    except smtplib.SMTPException as exc:
        raise EmailSendFailed(f"the mail server refused the message: {exc}") from exc
    except OSError as exc:
        raise EmailSendFailed(f"the connection to the mail server broke: {exc}") from exc

    # The address is personal data, so it is logged only as a fact about a send
    # that succeeded, never on the failure path where it would be repeated across
    # every retry.
    logger.info("email: delivered a %r message to the outbox row's recipient", subject)

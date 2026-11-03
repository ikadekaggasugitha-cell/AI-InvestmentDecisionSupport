"""
Outbound email: the predicate, the transport, and the words it says.

Three things this file is trying to prove, in the order they would hurt:

  * **The predicate has one answer.** `email_configured()` is what the approve
    path, the worker and the admin panel all read. If it could be true in one of
    them and false in another, the console would either queue mail it cannot send
    or refuse to queue mail it could.
  * **A send that failed is not a send that succeeded.** The outbox row is marked
    `sent` only when the server took the message. A transport that swallowed an
    SMTP error would turn a lost confirmation into a row that says it was
    delivered, which is worse than no row at all.
  * **The message says only what the payment path actually did.** No attachment
    that does not exist, no receipt image (ADR-0011 keeps that column empty on
    purpose), no promise about what happens next.

The database half — the unique key, the claim under `FOR UPDATE SKIP LOCKED`, the
retry state machine — is in `test_admin_live_sql.py`, because a fake that answers
those queries in Python would only be proving the fake agrees with itself.
"""

import smtplib
from datetime import datetime, timezone

import pytest

from api.core.config import get_settings
from api.services.email_transport import (
    EmailSendFailed,
    EmailUnavailable,
    email_configured,
    email_status,
    send_mail,
)
from api.services.notification_service import _approved_body, _denied_body, _rupiah

MAIL_ENV = {
    "NOTIFICATIONS_ENABLED": "true",
    "SMTP_HOST": "smtp.example.test",
    "SMTP_MAIL_FROM": "billing@example.test",
}


@pytest.fixture(autouse=True)
def _clean_settings_cache():
    """Every test here rewrites the environment the cached Settings reads.

    `get_settings()` is lru_cached, so a cleared cache at the end of the module is
    what keeps a later test file from inheriting this one's fake SMTP host.
    """
    get_settings.cache_clear()
    yield
    get_settings.cache_clear()


def _mail_on(monkeypatch, **overrides) -> None:
    """Set the install's mail state, and make the cached settings read it.

    `get_settings()` is lru_cached, so without the clear a test that set the
    environment would still see whatever the first test in the process asked for
    — the same trap that makes conftest.py set its defaults at import time.
    """
    for key, value in {**MAIL_ENV, **overrides}.items():
        monkeypatch.setenv(key, str(value))
    get_settings.cache_clear()


class _RecordingSMTP:
    """Stands in for a server that takes the message.

    Records the protocol calls rather than their effect: the point of several of
    these tests is which methods got called in which order, which a mock that
    only returned 250 would hide.
    """

    instances: list = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host, self.port = host, port
        self.timeout, self.context = timeout, context
        self.calls: list[str] = []
        self.sent = []
        type(self).instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.calls.append("quit")
        return False

    def starttls(self, context=None):
        self.calls.append("starttls")

    def login(self, user, password):
        self.calls.append(f"login:{user}")

    def send_message(self, message):
        self.calls.append("send_message")
        self.sent.append(message)


class _RefusingSMTP(_RecordingSMTP):
    def send_message(self, message):
        raise smtplib.SMTPRecipientsRefused({"nobody@example.test": (550, b"no such user")})


class TestThePredicate:
    def test_a_fresh_install_sends_nothing(self, monkeypatch):
        """The default is off, and that must be a fact a test holds.

        Mail to a customer cannot be unsent. An install that inherits a host from
        somebody else's `.env` should have to opt in, not discover it had opted in.
        """
        for key in MAIL_ENV:
            monkeypatch.delenv(key, raising=False)
        get_settings.cache_clear()

        assert email_configured() is False

    def test_all_three_present_means_mail_goes_out(self, monkeypatch):
        _mail_on(monkeypatch)
        assert email_configured() is True
        assert email_status().missing == ()

    @pytest.mark.parametrize(
        "absent", ["NOTIFICATIONS_ENABLED", "SMTP_HOST", "SMTP_MAIL_FROM"]
    )
    def test_removing_any_one_of_the_three_stops_the_mail(self, monkeypatch, absent):
        """All three are load-bearing, and each fails in its own way.

        A boolean is set to `false` rather than to the empty string, which
        pydantic refuses to parse — the install would not boot at all, which is
        a different failure from the one being tested here.
        """
        values = dict(MAIL_ENV)
        values[absent] = "false" if absent == "NOTIFICATIONS_ENABLED" else ""
        for key, value in values.items():
            monkeypatch.setenv(key, value)
        get_settings.cache_clear()

        assert email_configured() is False, f"{absent} alone should be enough to stop mail"

    def test_it_names_what_is_missing_rather_than_saying_no(self, monkeypatch):
        """An operator told only "not configured" has three files to guess at."""
        monkeypatch.setenv("NOTIFICATIONS_ENABLED", "false")
        monkeypatch.setenv("SMTP_HOST", "smtp.example.test")
        monkeypatch.setenv("SMTP_MAIL_FROM", "")
        get_settings.cache_clear()

        status = email_status()
        assert status.configured is False
        assert set(status.missing) == {"NOTIFICATIONS_ENABLED", "SMTP_MAIL_FROM"}

    def test_whitespace_is_not_a_host(self, monkeypatch):
        _mail_on(monkeypatch, SMTP_HOST="   ")
        assert email_configured() is False


class TestTheTransport:
    def test_an_unconfigured_install_refuses_instead_of_looking_like_a_send(
        self, monkeypatch
    ):
        for key in MAIL_ENV:
            monkeypatch.delenv(key, raising=False)
        get_settings.cache_clear()

        with pytest.raises(EmailUnavailable):
            send_mail("seseorang@example.test", "Hal", "Isi")

    def test_the_message_carries_the_addresses_and_the_body(self, monkeypatch):
        _mail_on(monkeypatch)
        _RecordingSMTP.instances = []
        monkeypatch.setattr(smtplib, "SMTP", _RecordingSMTP)

        send_mail("pembayar@example.test", "Pembayaran diterima", "Isi pesan")

        client = _RecordingSMTP.instances[-1]
        message = client.sent[0]
        assert message["To"] == "pembayar@example.test"
        # The sender is configuration, not a value the caller gets to choose: an
        # outbox row that could set its own From is an open relay for whoever can
        # write a row.
        assert message["From"] == "billing@example.test"
        assert message["Subject"] == "Pembayaran diterima"
        assert "Isi pesan" in message.get_content()

    def test_starttls_runs_before_login_on_a_plain_port(self, monkeypatch):
        _mail_on(monkeypatch, SMTP_PORT=587, SMTP_USERNAME="relay-user")
        _RecordingSMTP.instances = []
        monkeypatch.setattr(smtplib, "SMTP", _RecordingSMTP)

        send_mail("a@example.test", "s", "b")

        # Order is the security property here. Authenticating over a plain
        # connection would put the password on the wire in clear text.
        assert _RecordingSMTP.instances[-1].calls == [
            "starttls",
            "login:relay-user",
            "send_message",
            "quit",
        ]

    def test_no_login_when_the_install_has_no_credentials(self, monkeypatch):
        """A relay that trusts the network is a real deployment."""
        _mail_on(monkeypatch, SMTP_USERNAME="", SMTP_PASSWORD="")
        _RecordingSMTP.instances = []
        monkeypatch.setattr(smtplib, "SMTP", _RecordingSMTP)

        send_mail("a@example.test", "s", "b")

        assert "login:relay-user" not in _RecordingSMTP.instances[-1].calls

    def test_port_465_uses_implicit_tls_and_never_calls_starttls(self, monkeypatch):
        """STARTTLS on 465 fails, because that port is already encrypted."""
        _mail_on(monkeypatch, SMTP_PORT=465)
        _RecordingSMTP.instances = []
        monkeypatch.setattr(smtplib, "SMTP_SSL", _RecordingSMTP)
        monkeypatch.setattr(smtplib, "SMTP", _RecordingSMTP)

        send_mail("a@example.test", "s", "b")

        client = _RecordingSMTP.instances[-1]
        assert client.port == 465
        assert "starttls" not in client.calls

    def test_a_server_that_refuses_raises_rather_than_returning_quietly(
        self, monkeypatch
    ):
        """The single most expensive failure this module could have.

        Swallowing the refusal would let the worker mark the row `sent`. The
        operator would then look at a table saying the payer was told, and the
        payer would have nothing.
        """
        _mail_on(monkeypatch)
        monkeypatch.setattr(smtplib, "SMTP", _RefusingSMTP)

        with pytest.raises(EmailSendFailed):
            send_mail("a@example.test", "s", "b")

    def test_the_connection_has_a_timeout(self, monkeypatch):
        """No timeout means a silent provider holds the worker forever."""
        _mail_on(monkeypatch)
        _RecordingSMTP.instances = []
        monkeypatch.setattr(smtplib, "SMTP", _RecordingSMTP)

        send_mail("a@example.test", "s", "b")

        assert _RecordingSMTP.instances[-1].timeout is not None

    def test_the_password_never_reaches_the_message(self, monkeypatch):
        _mail_on(monkeypatch, SMTP_PASSWORD="rahasia-kunci-smtp")
        _RecordingSMTP.instances = []
        monkeypatch.setattr(smtplib, "SMTP", _RecordingSMTP)

        send_mail("a@example.test", "s", "b")

        client = _RecordingSMTP.instances[-1]
        message = str(client.sent[0])
        assert "rahasia-kunci-smtp" not in message
        assert all("rahasia-kunci-smtp" not in c for c in client.calls)


class TestTheWords:
    def test_the_confirmation_names_the_facts_and_only_the_facts(self):
        body = _approved_body(
            "INV-20261103-ABC123",
            44000,
            "monthly",
            datetime(2026, 12, 3, tzinfo=timezone.utc),
        )

        assert "INV-20261103-ABC123" in body
        assert "Rp 44.000" in body
        assert "bulanan" in body
        assert "03 December 2026" in body

    def test_the_refusal_carries_the_reason_the_operator_wrote(self):
        """The deny endpoint makes a reason mandatory so this line can be true."""
        body = _denied_body("INV-1", 252000, "Nomor rekening tujuan tidak cocok")

        assert "Nomor rekening tujuan tidak cocok" in body
        assert "Rp 252.000" in body

    def test_rupiah_uses_the_local_separator(self):
        assert _rupiah(44000) == "Rp 44.000"
        assert _rupiah(252000) == "Rp 252.000"

    def test_the_invoice_code_is_not_rewritten_by_the_number_format(self):
        """A regression this file was written for.

        `f"…{amount:,}…".replace(",", ".")` hung on an adjacent string literal
        applies to the whole concatenated run, so it used to touch the invoice
        code line too. A code containing a comma would have been silently
        changed into one containing a dot.
        """
        body = _approved_body(
            "INV,WITH,COMMAS", 7000, "weekly", datetime(2026, 11, 10, tzinfo=timezone.utc)
        )

        assert "INV,WITH,COMMAS" in body
        assert "INV.WITH.COMMAS" not in body

    def test_no_message_promises_a_receipt_or_an_attachment(self):
        """ADR-0011 keeps `proof_image_url` empty on purpose. A line telling the
        payer to find their receipt in this email would point at nothing."""
        for body in (
            _approved_body(
                "INV-1", 15000, "weekly", datetime(2026, 11, 10, tzinfo=timezone.utc)
            ),
            _denied_body("INV-1", 15000, "sebab"),
        ):
            lowered = body.lower()
            assert "lampiran" not in lowered
            assert "attachment" not in lowered
            assert "bukti transfer" not in lowered

    def test_no_pictographic_glyph_in_any_message(self):
        """§7.2's template is written with rocket and link emoji. The repo bans
        pictographs in text it renders, and a message that trips that guard is a
        message somebody will have to explain later."""
        import re

        pictograph = re.compile(
            r"[\U0001F000-\U0001FAFF\U0001F1E6-\U0001F1FF\U0001F300-\U0001F5FF"
            r"\U0001F600-\U0001F64F\U0001F680-\U0001F6FF]|️|⃣",
            re.UNICODE,
        )
        bodies = [
            _approved_body(
                "INV-1", 15000, "weekly", datetime(2026, 11, 10, tzinfo=timezone.utc)
            ),
            _denied_body("INV-1", 15000, "sebab"),
        ]

        assert [b for b in bodies if pictograph.search(b)] == []

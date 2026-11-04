"""
The `smtp` setting: an operator-editable email configuration that the transport
actually reads.

This is the slice with the sharp edge, and the tests are shaped around it. The
failure this feature must not produce is the one a screen cannot show: a form
that saves to `system_settings` while `email_transport` keeps reading the
`lru_cache`d `Settings`. That form looks like it works. It changes nothing. A
confirmation email silently never arrives, weeks later, in a queue nobody is
watching — which is why the file's centre of gravity is the group below that
writes through the endpoint and proves the send path moved without a restart.

The rest follows from the owner's decision to keep the credential in the row:

  * No endpoint returns the password, in any shape. Not masked, not truncated,
    not a length.
  * Editing one field must not delete the secret. A blank `password` on write
    keeps what is stored.
  * An empty field falls back to the environment, per field rather than per row,
    so saving a hostname does not pin a port the operator never looked at.
"""

import base64

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from api.services.email_transport import (
    email_configured,
    email_status,
    mail_config,
)
from api.services.system_settings_service import (
    SMTP_KEY,
    SmtpInvalid,
    SmtpUnavailable,
    read_smtp,
    write_smtp,
)
from tests.test_admin_api import make_admin, signup

PASSWORD = "surely-a-secret-not-a-plain"

FULL_FORM = {
    "host": "smtp.example.test",
    "port": 587,
    "username": "relay-user",
    "fromAddress": "billing@example.test",
    "useTls": True,
    "enabled": True,
    "password": PASSWORD,
}


@pytest.fixture
def client(monkeypatch, mock_redis):
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    # A clean environment: every test here has to know whether the value it sees
    # came from the row or from `.env`, and that question is unanswerable if the
    # suite's own defaults leak in.
    for key in (
        "NOTIFICATIONS_ENABLED",
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USERNAME",
        "SMTP_PASSWORD",
        "SMTP_MAIL_FROM",
        "SMTP_USE_TLS",
    ):
        monkeypatch.delenv(key, raising=False)
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _env(monkeypatch, **values):
    defaults = {
        "NOTIFICATIONS_ENABLED": "false",
        "SMTP_HOST": "",
        "SMTP_PORT": "587",
        "SMTP_USERNAME": "",
        "SMTP_PASSWORD": "",
        "SMTP_MAIL_FROM": "",
        "SMTP_USE_TLS": "true",
    }
    for key, value in {**defaults, **values}.items():
        monkeypatch.setenv(key, str(value))
    get_settings.cache_clear()


class TestTheStoredRow:
    async def test_no_row_reads_as_none_not_as_an_empty_config(self, fake_identity):
        """The state every install is in before someone opens the editor.

        An empty config here would be indistinguishable from an operator clearing
        every field, and the form would show blanks over a working environment.
        """
        assert await read_smtp() is None

    async def test_every_field_written_comes_back_as_it_was_cleaned(
        self, fake_identity
    ):
        stored = await write_smtp(dict(FULL_FORM))
        assert stored.host == "smtp.example.test"
        assert stored.port == 587
        assert stored.username == "relay-user"
        assert stored.mail_from == "billing@example.test"
        assert stored.use_tls is True
        assert stored.enabled is True
        assert stored.password == PASSWORD
        assert stored.has_password is True

    async def test_a_field_left_empty_is_stored_as_unset_not_as_a_blank(
        self, fake_identity
    ):
        """Absence has to survive the round trip.

        `""` and unset are different facts: the first would be a sender address
        the transport tries to use, the second is the environment still answering.
        """
        stored = await write_smtp({"host": "smtp.example.test"})
        assert stored.host == "smtp.example.test"
        assert stored.port is None
        assert stored.username is None
        assert stored.mail_from is None
        # A tri-state, so `None` here is not "false" and the environment's
        # `SMTP_USE_TLS=true` still wins.
        assert stored.use_tls is None

    async def test_the_host_is_refused_not_stored_when_it_could_never_connect(
        self, fake_identity
    ):
        # A blank is not in this list. Empty means "the environment answers this
        # field again", which is a choice the form exposes deliberately.
        for bad in ["smtp example.test", "https://smtp.example.test"]:
            with pytest.raises(SmtpInvalid):
                await write_smtp({"host": bad})

    async def test_a_host_with_a_port_glued_on_is_refused(self, fake_identity):
        """`smtp.example.test:587` is a paste accident with a real one behind it.

        `smtplib` would try to resolve a host named that and fail at connect
        time, in a worker, hours after the form was the last thing anyone looked
        at.
        """
        with pytest.raises(SmtpInvalid):
            await write_smtp({"host": "smtp.example.test:587"})

    async def test_whitespace_round_a_host_is_dropped_and_a_host_is_not_rewritten(
        self, fake_identity
    ):
        """The two halves are one line apart and mean opposite things.

        Trimming what someone pasted is kind. Squashing the space out of
        `smtp example.test` would store a different host than the one the
        operator read on screen, which is the one thing a settings writer must
        never do quietly.
        """
        stored = await write_smtp({"host": "  smtp.example.test  "})
        assert stored.host == "smtp.example.test"
        with pytest.raises(SmtpInvalid):
            await write_smtp({"host": "smtp example.test"})

    async def test_the_port_has_to_be_a_port(self, fake_identity):
        for bad in [0, -1, 65536, "dua ribu", 1_000_000]:
            with pytest.raises(SmtpInvalid):
                await write_smtp({"port": bad})

    async def test_the_sender_address_uses_the_validator_that_already_existed(
        self, fake_identity
    ):
        """Not a second email rule written next to the first.

        The contact form already refuses two addresses in one field and a
        `mailto:` prefix. A second validator would eventually disagree with it
        about what a deliverable address is.
        """
        for bad in ["a@b@c.example.test", "mailto:billing@example.test", "not-an-email"]:
            with pytest.raises(SmtpInvalid):
                await write_smtp({"fromAddress": bad})

    async def test_a_line_break_in_a_credential_is_refused(self, fake_identity):
        """SMTP folds on CRLF. A password carrying one ends the argument and
        starts another — the shape of a hole, whatever the intent was."""
        for field in ("password", "username"):
            with pytest.raises(SmtpInvalid):
                await write_smtp({field: "x\r\nMAIL FROM:<x@example.test>"})

    async def test_writing_password_empty_keeps_the_stored_one(self, fake_identity):
        """The rule that stops a hostname edit from deleting a credential."""
        await write_smtp(dict(FULL_FORM))
        again = await write_smtp({"host": "smtp-baru.example.test", "password": ""})
        assert again.password == PASSWORD
        assert again.host == "smtp-baru.example.test"

    async def test_an_absent_password_field_also_keeps_it(self, fake_identity):
        await write_smtp(dict(FULL_FORM))
        again = await write_smtp({"host": "smtp-baru.example.test"})
        assert again.password == PASSWORD

    async def test_a_password_can_deliberately_be_cleared(self, fake_identity):
        """Not by leaving the box empty — that is the case above.

        There is no "clear the secret" gesture in the row's own vocabulary, and
        that is the honest consequence of the rule that protects the common edit.
        A relay that stops needing auth is an environment change, and this test
        says which way the rule cuts.
        """
        await write_smtp(dict(FULL_FORM))
        stored = await write_smtp({"host": "relay.local", "port": 25})
        assert stored.has_password is True

    async def test_a_field_the_operator_emptied_is_stored_as_unset(
        self, fake_identity
    ):
        """Clearing one box is a write of "nothing", not of the empty string.

        The transport then reads the environment for that field again, which is
        the behaviour the form tells the operator it has.
        """
        await write_smtp(dict(FULL_FORM))
        stored = await write_smtp({"host": "smtp.example.test", "fromAddress": ""})
        assert stored.mail_from is None
        assert stored.host == "smtp.example.test"

    async def test_an_unusable_row_says_so_instead_of_reading_as_no_config(
        self, fake_identity
    ):
        fake_identity.settings[SMTP_KEY] = {
            "value": "bukan objek",
            "updated_at": None,
        }
        with pytest.raises(SmtpUnavailable):
            await read_smtp()

    async def test_a_key_the_code_does_not_know_does_not_break_the_read(
        self, fake_identity
    ):
        """The row outlives the version that wrote it.

        Refusing an unknown field here would stop mail on an install that rolled
        back to older code after a newer one had saved a column this version has
        never heard of.
        """
        fake_identity.settings[SMTP_KEY] = {
            "value": {"host": "smtp.example.test", "future_field": 7},
            "updated_at": None,
        }
        stored = await read_smtp()
        assert stored.host == "smtp.example.test"


class TestTheTransportReadsTheRow:
    """The consequence the whole design exists to avoid.

    `get_settings()` is cached at import. If the transport read `Settings` and
    the form wrote to the database, every test below would still pass at the
    *form* level and the feature would be a lie at the only level that matters.
    """

    async def test_with_no_row_the_environment_answers(self, fake_identity, monkeypatch):
        _env(monkeypatch, NOTIFICATIONS_ENABLED="true", SMTP_HOST="env.example.test")
        config = await mail_config()
        assert config.host == "env.example.test"
        assert config.from_database is False

    async def test_a_stored_host_replaces_the_environment_without_a_restart(
        self, fake_identity, monkeypatch
    ):
        _env(monkeypatch, NOTIFICATIONS_ENABLED="true", SMTP_HOST="env.example.test")
        await write_smtp({"host": "row.example.test"})

        config = await mail_config()
        assert config.host == "row.example.test"
        assert config.from_database is True

    async def test_fields_the_row_leaves_alone_keep_answering_from_the_environment(
        self, fake_identity, monkeypatch
    ):
        """Field-by-field override, which is what makes a partial edit safe.

        Storing a host must not silently pin the port, the username, or the
        sender the form displayed at the time it was opened.
        """
        _env(
            monkeypatch,
            NOTIFICATIONS_ENABLED="true",
            SMTP_PORT="2525",
            SMTP_MAIL_FROM="billing@example.test",
        )
        await write_smtp({"host": "row.example.test"})

        config = await mail_config()
        assert config.host == "row.example.test"
        assert config.port == 2525
        assert config.mail_from == "billing@example.test"

    async def test_a_password_in_the_row_is_the_one_used_and_the_env_is_not(
        self, fake_identity, monkeypatch
    ):
        _env(monkeypatch, NOTIFICATIONS_ENABLED="true", SMTP_PASSWORD="env-secret")
        await write_smtp({"password": PASSWORD})
        assert (await mail_config()).password == PASSWORD

    async def test_the_predicate_moves_with_the_row(self, fake_identity, monkeypatch):
        """`email_configured()` is one answer, and the row changes it.

        The approve path, the worker and the panel all read this predicate. If
        the editor could not move it, the panel would keep saying "mail tidak
        bisa dikirim" after the operator had just configured it.
        """
        _env(monkeypatch, NOTIFICATIONS_ENABLED="true", SMTP_HOST="", SMTP_MAIL_FROM="")
        assert await email_configured() is False

        await write_smtp(
            {"host": "smtp.example.test", "fromAddress": "billing@example.test"}
        )
        assert await email_configured() is True

        # And back: emptying the stored sender returns the decision to the
        # environment, which still has nothing.
        await write_smtp({"host": "smtp.example.test", "fromAddress": ""})
        assert await email_configured() is False

    async def test_the_enabled_flag_can_be_turned_on_from_the_row(
        self, fake_identity, monkeypatch
    ):
        """A form that could fill a host but not switch mail on would be half a
        feature: the flag is the one field an install has to opt in with."""
        _env(
            monkeypatch,
            NOTIFICATIONS_ENABLED="false",
            SMTP_HOST="smtp.example.test",
            SMTP_MAIL_FROM="billing@example.test",
        )
        assert await email_configured() is False

        await write_smtp({"enabled": True})
        status = await email_status()
        assert status.configured is True
        assert "NOTIFICATIONS_ENABLED" not in status.missing

    async def test_the_row_can_switch_mail_off_again(self, fake_identity, monkeypatch):
        _env(
            monkeypatch,
            NOTIFICATIONS_ENABLED="true",
            SMTP_HOST="smtp.example.test",
            SMTP_MAIL_FROM="billing@example.test",
        )
        assert await email_configured() is True
        await write_smtp({"enabled": False})
        assert await email_configured() is False

    async def test_an_unreadable_row_stops_the_mail_rather_than_falling_back(
        self, fake_identity, monkeypatch
    ):
        """Silently using the environment again would look like the edit was
        ignored. A broken install has to say it is broken."""
        _env(monkeypatch, NOTIFICATIONS_ENABLED="true", SMTP_HOST="env.example.test")
        fake_identity.settings[SMTP_KEY] = {"value": 7, "updated_at": None}
        with pytest.raises(SmtpUnavailable):
            await mail_config()


class TestTheEndpoint:
    def test_anonymous_is_401_and_a_normal_account_is_403(self, client, fake_identity):
        assert client.get("/v1/admin/settings/smtp").status_code == 401
        signup(client, "biasa@aidss.id")
        assert client.get("/v1/admin/settings/smtp").status_code == 403
        assert (
            client.put("/v1/admin/settings/smtp", json={"host": "x.example"}).status_code
            == 403
        )

    def test_the_password_value_is_never_in_the_response(self, client, fake_identity):
        """Every shape a leak could take, asserted on the raw body.

        The pattern is the one the Integrations panel already holds itself to, and
        it is stricter than it looks: a prefix of a short credential is enough to
        rule out candidates, so "masked" is not a safe middle setting.
        """
        make_admin(client, fake_identity)
        assert (
            client.put("/v1/admin/settings/smtp", json=FULL_FORM).status_code == 200
        )

        resp = client.get("/v1/admin/settings/smtp")
        assert resp.status_code == 200, resp.text
        assert PASSWORD not in resp.text
        assert base64.b64encode(PASSWORD.encode()).decode() not in resp.text
        for size in (4, 6, 8, 12):
            assert PASSWORD[:size] not in resp.text
        body = resp.json()
        assert set(body) == {
            "host",
            "port",
            "username",
            "fromAddress",
            "useTls",
            "enabled",
            "hasPassword",
            "stored",
            "updatedAt",
        }
        assert body["hasPassword"] is True

    def test_the_response_is_the_effective_config_not_just_the_row(
        self, client, fake_identity, monkeypatch
    ):
        """Blanks where the install actually sends would be a screen that lies.

        An operator who has never opened the editor still has mail working from
        `.env`, and the form has to show what is in force or they will "fix" a
        configuration that was never broken.
        """
        _env(
            monkeypatch,
            NOTIFICATIONS_ENABLED="true",
            SMTP_HOST="env.example.test",
            SMTP_MAIL_FROM="billing@example.test",
        )
        make_admin(client, fake_identity)

        body = client.get("/v1/admin/settings/smtp").json()
        assert body["host"] == "env.example.test"
        assert body["fromAddress"] == "billing@example.test"
        assert body["stored"] is False
        assert body["updatedAt"] is None

    async def test_saving_moves_the_send_path_without_restarting_the_process(
        self, client, fake_identity, monkeypatch
    ):
        """The test the slice was designed around.

        Nothing here reloads anything. The PUT writes a row and the next read of
        the predicate sees it, which is only possible because the transport reads
        the row instead of the cached settings object.
        """
        _env(monkeypatch, NOTIFICATIONS_ENABLED="true")
        make_admin(client, fake_identity)
        assert client.get("/v1/admin/settings/smtp").json()["host"] == ""
        assert await email_configured() is False

        resp = client.put(
            "/v1/admin/settings/smtp",
            json={
                "host": "smtp.example.test",
                "port": 587,
                "username": "relay-user",
                "fromAddress": "billing@example.test",
                "useTls": True,
                "enabled": True,
                "password": PASSWORD,
            },
        )
        assert resp.status_code == 200, resp.text
        # Same process, same import, no cache clear, no restart.
        assert await email_configured() is True

    def test_an_empty_password_on_write_keeps_the_stored_one_on_read(
        self, client, fake_identity
    ):
        make_admin(client, fake_identity)
        client.put("/v1/admin/settings/smtp", json=FULL_FORM)

        resp = client.put("/v1/admin/settings/smtp", json={"host": "baru.example.test"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["hasPassword"] is True

    def test_an_impossible_field_is_422_and_the_stored_row_is_untouched(
        self, client, fake_identity
    ):
        make_admin(client, fake_identity)
        client.put("/v1/admin/settings/smtp", json=FULL_FORM)

        resp = client.put("/v1/admin/settings/smtp", json={"port": 70000})
        assert resp.status_code == 422, resp.text
        assert client.get("/v1/admin/settings/smtp").json()["port"] == 587

    def test_the_write_is_logged_without_its_values(self, client, fake_identity, caplog):
        """Who and which fields, never what.

        The row holds a plaintext credential by decision; a log line repeating it
        would put the same secret in a place that is usually shipped somewhere
        else and kept for longer.
        """
        make_admin(client, fake_identity)
        with caplog.at_level("INFO"):
            client.put("/v1/admin/settings/smtp", json=FULL_FORM)

        text = caplog.text
        assert PASSWORD not in text
        assert "relay-user" not in text
        assert "smtp written" in text

    async def test_the_log_names_fields_and_never_their_values(
        self, fake_identity, caplog
    ):
        with caplog.at_level("INFO"):
            await write_smtp(dict(FULL_FORM))
        assert "smtp written" in caplog.text
        assert "surely-a-secret" not in caplog.text
        assert "relay-user" not in caplog.text


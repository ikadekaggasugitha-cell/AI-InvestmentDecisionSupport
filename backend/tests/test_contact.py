"""
`contact_support` in system_settings — the address the public footer publishes.

The same three-part shape the price and the transfer destinations already use:
one service that reads and writes, one public read, one admin write. The rules
this file pins:

  * Nothing is published until an operator writes it. A fresh install answers
    `"email": null`, and the footer renders no contact row — not an empty
    `mailto:`. This is `docs/settings-module-spec.md` R-26, the rule the project
    wrote for itself before anyone had a channel to name.
  * An address that could not be delivered to is refused on write. The footer
    turns the value into a link, so a string that is not an address ships as a
    control that sends mail nowhere.
  * Clearing is allowed and is a write like any other. Unlike the destination
    list, where saving an empty list silently deletes every account, one box
    going blank is the only way to say "take it off the page", so the form names
    that action and the service accepts it.
  * `pricing` and `bank_accounts` are not touched by this key, and this key is
    not touched by them.
"""

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from api.services.system_settings_service import (
    CONTACT_SUPPORT_KEY,
    ContactInvalid,
    read_contact_support,
    write_contact_support,
)
from tests.test_admin_api import make_admin, signup


def _stored(fake_identity):
    return fake_identity.settings.get(CONTACT_SUPPORT_KEY)


class TestWriteReadThroughTheService:
    async def test_what_was_written_is_what_is_read_back(self, fake_identity):
        stored = await write_contact_support("support@aidss.id")

        assert stored == "support@aidss.id"
        read, updated = await read_contact_support()
        assert read == "support@aidss.id"
        assert updated is not None

    async def test_an_install_that_never_set_one_reads_empty(self, fake_identity):
        """Not yet configured is a state, not a failure: the footer needs the
        difference between "no address" and "the server is broken"."""
        read, updated = await read_contact_support()
        assert read == ""
        assert updated is None

    async def test_surrounding_space_is_cleaned_off(self, fake_identity):
        """Pasting from an email client leaves whitespace behind. The address is
        still the one the operator meant."""
        stored = await write_contact_support("  support@aidss.id  ")
        assert stored == "support@aidss.id"

    @pytest.mark.parametrize(
        "raw",
        [
            "not-an-email",
            "a@@b.com",
            "a@b",  # no domain to deliver to
            "a@.com",
            "a@b..com",
            "a@-b.com",
            "a@b-.com",
            "mailto:support@aidss.id",  # the prefix is not part of an address
            "sup port@aidss.id",
            "a,b@aidss.id",
            "two@aidss.id second@aidss.id",
        ],
    )
    async def test_a_string_that_is_not_one_address_is_refused(self, fake_identity, raw):
        with pytest.raises(ContactInvalid):
            await write_contact_support(raw)
        assert _stored(fake_identity) is None

    async def test_an_overlong_address_is_refused(self, fake_identity):
        with pytest.raises(ContactInvalid):
            await write_contact_support(f"{'x' * 70}@aidss.id")
        with pytest.raises(ContactInvalid):
            await write_contact_support(f"support@{'y' * 250}.id")

    async def test_a_non_string_is_refused(self, fake_identity):
        for value in (None, 42, ["a@b.co"]):
            with pytest.raises(ContactInvalid):
                await write_contact_support(value)

    async def test_clearing_writes_empty_and_the_read_agrees(self, fake_identity):
        await write_contact_support("support@aidss.id")
        stored = await write_contact_support("")

        assert stored == ""
        read, updated = await read_contact_support()
        assert read == ""
        # The row is still there with a fresh timestamp: one write path, and the
        # operator's decision is recorded rather than erased.
        assert _stored(fake_identity)["value"]["email"] == ""
        assert updated is not None

    async def test_case_is_kept_as_written(self, fake_identity):
        """The local part can be case-sensitive, so this is not ours to fold."""
        assert await write_contact_support("Support@AIDSS.id") == "Support@AIDSS.id"

    async def test_a_row_hand_edited_to_noise_is_not_published_as_an_address(
        self, fake_identity
    ):
        """Reading validates too, not only writing. A value that reached the table
        some other way must not be served to a visitor as a way to reach the team."""
        fake_identity.settings[CONTACT_SUPPORT_KEY] = {
            "value": {"email": "broke"},
            "updated_at": None,
        }
        from api.services.system_settings_service import ContactUnavailable

        with pytest.raises(ContactUnavailable):
            await read_contact_support()

    async def test_the_other_keys_are_not_touched(self, fake_identity):
        await write_contact_support("support@aidss.id")
        assert "pricing" in fake_identity.settings
        assert "bank_accounts" not in fake_identity.settings


class TestOverHTTP:
    """The public read the footer calls, and the admin write the form calls."""

    @pytest.fixture
    def client(self, monkeypatch, mock_redis):
        monkeypatch.setenv("AUTH_BYPASS", "false")
        monkeypatch.setenv("PAYWALL_ENABLED", "false")
        monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
        monkeypatch.setenv("METRICS_ENABLED", "false")
        get_settings.cache_clear()
        from api.main import create_app

        yield TestClient(create_app())
        get_settings.cache_clear()

    def _put(self, client, email):
        return client.put("/v1/admin/settings/contact", json={"email": email})

    def test_anonymous_reads_the_contact_and_gets_null(self, client):
        """Public like the price: the footer stands on signed-out screens."""
        resp = client.get("/v1/subscriptions/contact")
        assert resp.status_code == 200
        assert resp.json() == {"email": None, "updatedAt": None}

    def test_anonymous_write_is_401_and_a_normal_account_is_403(self, client, fake_identity):
        assert self._put(client, "support@aidss.id").status_code == 401

        signup(client, "biasa@aidss.id")
        assert self._put(client, "support@aidss.id").status_code == 403
        assert _stored(fake_identity) is None

    def test_only_an_admin_can_read_the_form_endpoint(self, client, fake_identity):
        assert client.get("/v1/admin/settings/contact").status_code == 401

        signup(client, "biasa@aidss.id")
        assert client.get("/v1/admin/settings/contact").status_code == 403

        make_admin(client, fake_identity)
        assert client.get("/v1/admin/settings/contact").status_code == 200

    def test_an_admin_writes_and_the_public_reads_the_same_address(
        self, client, fake_identity
    ):
        make_admin(client, fake_identity)

        written = self._put(client, "support@aidss.id")
        assert written.status_code == 200, written.text
        assert written.json()["email"] == "support@aidss.id"
        assert written.json()["updatedAt"] is not None

        # The reader holds no session — the footer is exactly that.
        client.cookies.clear()
        public = client.get("/v1/subscriptions/contact")
        assert public.status_code == 200
        assert public.json()["email"] == "support@aidss.id"

    def test_clearing_takes_the_address_off_the_public_read(self, client, fake_identity):
        make_admin(client, fake_identity)
        assert self._put(client, "support@aidss.id").status_code == 200

        cleared = self._put(client, "")
        assert cleared.status_code == 200
        assert cleared.json()["email"] is None

        client.cookies.clear()
        assert client.get("/v1/subscriptions/contact").json()["email"] is None

    def test_an_address_that_is_not_one_is_422_and_changes_nothing(self, client, fake_identity):
        make_admin(client, fake_identity)

        resp = self._put(client, "support at aidss")
        assert resp.status_code == 422
        assert "email address" in resp.json()["detail"]
        assert _stored(fake_identity) is None

    def test_a_body_without_the_field_is_422(self, client, fake_identity):
        """A PUT that names no address is a malformed request, not a clear: the
        form always sends the field, blank or not."""
        make_admin(client, fake_identity)
        await_row = _stored(fake_identity)

        resp = client.put("/v1/admin/settings/contact", json={})
        assert resp.status_code == 422
        assert _stored(fake_identity) == await_row

    def test_admin_read_reports_null_and_the_form_can_still_open(self, client, fake_identity):
        """An unconfigured install must open a blank form, not an error screen:
        the operator needs a place to write the first address."""
        make_admin(client, fake_identity)
        resp = client.get("/v1/admin/settings/contact")
        assert resp.status_code == 200
        assert resp.json() == {"email": None, "updatedAt": None}

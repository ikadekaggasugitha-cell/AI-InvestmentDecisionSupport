"""
Payment channels: one registry, the operator's choice, and both reading it.

The task this file exists to keep honest is the silent one. A Snap code that is
almost right does not raise: the method simply never appears on the payment
page, and nobody is told. So the assertions here are about the exact strings
that leave this server and the exact list that reaches a browser, not about
"some restriction happened".

Three surfaces, and the plan's rule is that they answer from one source:

  * `channel_registry` — our keys, the payer's labels, the gateway's codes.
  * `system_settings.payment_channels` — the operator's choice, with "nobody
    has chosen" kept distinct from "everything is off".
  * The endpoints. The public one publishes keys and labels only; the admin one
    additionally shows the gateway code, because an operator deciding what to
    offer benefits from knowing what will be sent outward.
"""

import pytest
from fastapi.testclient import TestClient

from api.core.config import get_settings
from api.services import channel_registry
from api.services.system_settings_service import (
    PAYMENT_CHANNELS_KEY,
    PaymentChannelsInvalid,
    PaymentChannelsUnavailable,
    read_payment_channels,
    write_payment_channels,
)
from tests.test_admin_api import login, make_admin, signup


@pytest.fixture
def client(monkeypatch, mock_redis):
    """Module-level for the same reason the bank-account file's is: two classes
    drive these endpoints, and a second copy of the environment lines is how
    they end up testing two different apps."""
    monkeypatch.setenv("AUTH_BYPASS", "false")
    monkeypatch.setenv("PAYWALL_ENABLED", "false")
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("METRICS_ENABLED", "false")
    get_settings.cache_clear()
    from api.main import create_app

    yield TestClient(create_app())
    get_settings.cache_clear()


def _stored(fake_identity):
    return fake_identity.settings.get(PAYMENT_CHANNELS_KEY)


def _seed(fake_identity, channels):
    """A row written by something other than the service, in the shape Postgres
    would hand back. Going through `write_payment_channels` here would be
    circular: every test below is about a row the writer refused to produce."""
    fake_identity.settings[PAYMENT_CHANNELS_KEY] = {
        "value": {"channels": channels},
        "updated_at": None,
    }


async def _channels():
    """The list alone, because most of these tests are about the list."""
    enabled, _updated = await read_payment_channels()
    return enabled


class TestRegistry:
    """The mapping itself, checked as data rather than as behaviour."""

    def test_mandiri_is_echannel_and_not_a_plausible_guess(self):
        """The one code this whole feature would have gotten wrong by eye.

        `mandiri_va` looks right and does not exist. Midtrans' alias document
        expands `bank_transfer` to `permata_va, bca_va, bni_va, bri_va,
        echannel`, and `echannel` is the Mandiri entry. Pinned as a test because
        the failure mode is invisible: the VA method would just never show up.
        """
        assert channel_registry.snap_code("va_mandiri") == "echannel"

    def test_no_key_is_its_own_gateway_code_by_accident(self):
        """Keys and codes are two vocabularies; where they coincide it is because
        the gateway's word happens to equal ours (`qris`, `gopay`), not because
        the registry passes strings through."""
        passthrough = [
            c.key
            for c in channel_registry.options()
            if c.snap and c.snap == c.key
        ]
        assert set(passthrough) == {"qris", "credit_card", "gopay", "shopeepay"}

    def test_bank_transfer_can_never_be_sent_outward(self):
        """Declare-only, by construction.

        In Snap `bank_transfer` is an alias meaning "every virtual account". Here
        it means a payer who moved money themselves. If it had a code, enabling
        it for declarations would widen the gateway page to methods the operator
        never picked.
        """
        assert channel_registry.snap_code("bank_transfer") is None
        assert "bank_transfer" not in channel_registry.gateway_keys()

    def test_a_declare_only_channel_cannot_reach_a_snap_request(self):
        """The drop is the guard, so it has to be tested as one."""
        codes = channel_registry.snap_codes(
            ["bank_transfer", "qris", "bank_transfer"]
        )
        assert codes == ["qris"]

    def test_an_unknown_key_maps_to_nothing_rather_than_raising(self):
        assert channel_registry.snap_code("bitcoin") is None
        assert channel_registry.snap_codes(["bitcoin", "qris"]) == ["qris"]

    def test_a_label_exists_for_every_channel_because_a_payer_reads_them(self):
        """Empty labels are what a payment page with no method names looks like."""
        for channel in channel_registry.options():
            assert channel.label.strip() == channel.label
            assert channel.label != ""

    def test_labels_carry_no_gateway_brand(self):
        """The payer's vocabulary is instruments, not companies.

        Asserted on the registry rather than the rendered screen because this is
        where the words are written; the frontend test asserts the screen.
        """
        for channel in channel_registry.options():
            assert "midtrans" not in channel.label.lower()


class TestWriteReadThroughTheService:
    async def test_nothing_written_reads_as_never_chosen_not_empty(self, fake_identity):
        """The distinction the deploy depends on.

        An empty list here would be read by the checkout as "online payment is
        off", so installing this feature would switch off every payment method on
        every install that had not opened the new admin screen yet.
        """
        assert await _channels() is None

    async def test_what_was_written_is_what_is_read_back(self, fake_identity):
        written = await write_payment_channels(["qris", "va_bca"])
        assert written == ["qris", "va_bca"]
        assert await _channels() == ["qris", "va_bca"]

    async def test_the_row_carries_when_it_was_set_for_the_form(self, fake_identity):
        """`updated_at` is read here rather than shown as a blank.

        The admin screen prints it, and a screen that always printed nothing
        would be a form claiming a setting it cannot date.
        """
        await write_payment_channels(["qris"])
        _enabled, updated = await read_payment_channels()
        assert updated is not None
        assert "T" in updated

    async def test_an_empty_list_is_a_choice_and_reads_as_one(self, fake_identity):
        """Accepted, and not confused with never having been written."""
        assert await write_payment_channels([]) == []
        assert await _channels() == []

    async def test_an_unknown_channel_is_refused_on_write(self, fake_identity):
        """Refused rather than stored: a stored typo is a missing payment method
        with no error attached."""
        with pytest.raises(PaymentChannelsInvalid):
            await write_payment_channels(["qris", "bitcoin"])
        assert _stored(fake_identity) is None

    async def test_the_refusal_says_which_name_is_the_problem(self, fake_identity):
        with pytest.raises(PaymentChannelsInvalid) as exc:
            await write_payment_channels(["gopay", "not_a_channel"])
        assert "not_a_channel" in str(exc.value)

    async def test_case_and_spacing_are_normalised_and_duplicates_dropped(
        self, fake_identity
    ):
        written = await write_payment_channels(["  QRIS ", "qris", " VA_BCA "])
        assert written == ["qris", "va_bca"]

    async def test_a_payload_that_is_not_a_list_is_refused(self, fake_identity):
        with pytest.raises(PaymentChannelsInvalid):
            await write_payment_channels("qris")

    async def test_writing_twice_replaces_rather_than_merges(self, fake_identity):
        await write_payment_channels(["qris", "va_bca"])
        await write_payment_channels(["gopay"])
        assert await _channels() == ["gopay"]

    async def test_a_stored_row_that_is_not_a_list_reports_unreadable(self, fake_identity):
        """Installed state that reads as noise is named, not repeated as fact."""
        _seed(fake_identity, "qris")
        with pytest.raises(PaymentChannelsUnavailable):
            await read_payment_channels()

    async def test_a_stored_row_with_no_channels_key_reports_unreadable(
        self, fake_identity
    ):
        fake_identity.settings[PAYMENT_CHANNELS_KEY] = {
            "value": {"methods": ["qris"]},
            "updated_at": None,
        }
        with pytest.raises(PaymentChannelsUnavailable):
            await read_payment_channels()

    async def test_an_unknown_key_in_a_stored_row_is_not_offered_and_the_row_is_untouched(
        self, fake_identity
    ):
        """Read filters the answer and never rewrites the row.

        A key with no gateway code cannot become a payment method, so what is
        being kept off the screen is a label nobody could pay with. The stored
        row still holds it afterwards, because a reader that quietly edited the
        operator's setting would be a second writer.
        """
        _seed(fake_identity, ["qris", "legacy_thing"])

        assert await _channels() == ["qris"]
        assert _stored(fake_identity)["value"]["channels"] == ["qris", "legacy_thing"]


class TestPublicEndpoint:
    def test_anonymous_reads_the_choices(self, client):
        resp = client.get("/v1/subscriptions/payment-channels")
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"restricted": False, "channels": []}

    def test_the_gateway_vocabulary_never_crosses_the_wire(self, client, fake_identity):
        """The one assertion in this file that would catch a copied field.

        `snap` belongs to the admin screen and the service that maps it. A public
        response that carries it hands the browser the words the gateway
        understands, and a body that knows those words is a body that can pick
        methods the operator never enabled.
        """
        async def _seed():
            await write_payment_channels(["qris", "va_mandiri", "va_bca"])

        import asyncio

        asyncio.run(_seed())

        text = str(client.get("/v1/subscriptions/payment-channels").json()).lower()
        for code in ("echannel", "bca_va", "bni_va", "permata_va"):
            assert code not in text
        assert "snap" not in text

    def test_only_the_enabled_channels_are_offered(self, client, fake_identity):
        _seed(fake_identity, ["qris"])
        body = client.get("/v1/subscriptions/payment-channels").json()
        assert body["restricted"] is True
        assert body["channels"] == [{"key": "qris", "label": "QRIS"}]

    def test_a_declare_only_key_stored_by_something_is_not_offlined(self, client, fake_identity):
        """Even a list that contains it, because it has no gateway code."""
        _seed(fake_identity, ["bank_transfer"])
        body = client.get("/v1/subscriptions/payment-channels").json()
        assert body["restricted"] is True
        assert body["channels"] == []

    def test_an_unreadable_row_is_503_not_an_empty_list(self, client, fake_identity):
        _seed(fake_identity, "not-a-list")
        assert client.get("/v1/subscriptions/payment-channels").status_code == 503


class TestAdminEndpoint:
    def test_anonymous_is_401_and_a_normal_account_is_403(self, client, fake_identity):
        assert client.get("/v1/admin/settings/payment-channels").status_code == 401
        signup(client, "biasa@aidss.id")
        assert client.get("/v1/admin/settings/payment-channels").status_code == 403
        assert (
            client.put(
                "/v1/admin/settings/payment-channels", json={"channels": ["qris"]}
            ).status_code
            == 403
        )

    def test_the_form_sees_every_choice_and_the_current_one(self, client, fake_identity):
        make_admin(client, fake_identity)
        _seed(fake_identity, ["qris"])

        body = client.get("/v1/admin/settings/payment-channels").json()

        assert body["restricted"] is True
        assert body["enabled"] == ["qris"]
        keys = [option["key"] for option in body["options"]]
        assert "shopeepay" in keys  # a choice that is off still has to be listed
        assert "bank_transfer" in keys  # so the operator can enable the manual path

    def test_an_install_that_never_chose_says_so_rather_than_showing_nothing(
        self, client, fake_identity
    ):
        """`restricted: false` with an empty `enabled`.

        The two empty-looking states must read differently on screen, and the
        only way they can is if the server says which one it is.
        """
        make_admin(client, fake_identity)
        body = client.get("/v1/admin/settings/payment-channels").json()
        assert body["restricted"] is False
        assert body["enabled"] == []

    def test_writing_returns_the_stored_set_and_the_read_back(self, client, fake_identity):
        make_admin(client, fake_identity)
        resp = client.put(
            "/v1/admin/settings/payment-channels",
            json={"channels": ["qris", "va_mandiri"]},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["enabled"] == ["qris", "va_mandiri"]
        assert client.get("/v1/admin/settings/payment-channels").json()["enabled"] == [
            "qris",
            "va_mandiri",
        ]
        assert _stored(fake_identity)["value"]["channels"] == ["qris", "va_mandiri"]

    def test_the_form_reports_when_the_choice_was_made(self, client, fake_identity):
        """Not a blank beside a label that says "Diperbarui".

        The row was read for its `updated_at` the way the destination list is, so
        the assertion is that a stored row actually carries the date out.
        """
        make_admin(client, fake_identity)
        resp = client.put(
            "/v1/admin/settings/payment-channels", json={"channels": ["qris"]}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["updatedAt"]

    def test_a_name_the_registry_does_not_know_is_422(self, client, fake_identity):
        make_admin(client, fake_identity)
        resp = client.put(
            "/v1/admin/settings/payment-channels", json={"channels": ["bitcoin"]}
        )
        assert resp.status_code == 422, resp.text
        assert PAYMENT_CHANNELS_KEY not in fake_identity.settings

    def test_switching_everything_off_is_written_and_reads_back(self, client, fake_identity):
        make_admin(client, fake_identity)
        resp = client.put(
            "/v1/admin/settings/payment-channels", json={"channels": []}
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["restricted"] is True
        assert resp.json()["enabled"] == []


class TestDeclarationAcceptsOnlyKnownChannels:
    """The manual path shares the registry with the online one.

    `payment_method` was validated as "a non-empty string of a sane length",
    which let the queue be handed a method no payment path ever offered and
    show it to the operator as a fact about how the money moved.
    """

    def _declare(self, client, email, method):
        signup(client, email)
        login(client, email)
        return client.post(
            "/v1/payments/manual",
            json={"plan": "monthly", "payment_method": method},
        )

    def test_a_declared_channel_is_stored_as_written(self, client, fake_identity):
        resp = self._declare(client, "transfer@aidss.id", "bank_transfer")
        assert resp.status_code == 200, resp.text
        assert resp.json()["paymentMethod"] == "bank_transfer"

    def test_an_online_channel_can_also_be_declared(self, client, fake_identity):
        """A payer who paid through the page and the page never settled still needs
        a way to tell the queue what they used. It is the same vocabulary."""
        resp = self._declare(client, "qris-sendiri@aidss.id", "qris")
        assert resp.status_code == 200, resp.text
        assert resp.json()["paymentMethod"] == "qris"

    def test_a_made_up_method_is_refused(self, client, fake_identity):
        resp = self._declare(client, "karangan@aidss.id", "crypto")
        assert resp.status_code == 422, resp.text
        assert fake_identity.transactions == {}

    def test_the_gateways_own_word_is_not_a_declaration_method(self, client, fake_identity):
        """Symmetry with the checkout: the browser does not speak Snap."""
        resp = self._declare(client, "snapword@aidss.id", "bca_va")
        assert resp.status_code == 422, resp.text

    def test_a_channel_the_operator_switched_off_cannot_be_declared_as_used(
        self, client, fake_identity
    ):
        """The enabled list governs both doors, not just the one that opens a page.

        If the checkout respected the operator's choice and the declaration did
        not, switching a method off would leave a second way to pay by it — and
        the queue would fill with rows claiming a method this install refused.
        """
        import asyncio

        asyncio.run(write_payment_channels(["qris"]))
        resp = self._declare(client, "va-yang-mati@aidss.id", "va_bca")
        assert resp.status_code == 422, resp.text
        assert fake_identity.transactions == {}

    def test_the_transfer_path_is_not_hostage_to_the_online_list(
        self, client, fake_identity
    ):
        """`bank_transfer` has no gateway code, so it is not in that list to be off.

        An install that enables nothing online still takes transfers, and refusing
        the declaration that *is* a transfer would make the operator's "no online
        payment" mean "no payment at all".
        """
        import asyncio

        asyncio.run(write_payment_channels([]))
        resp = self._declare(client, "hanya-transfer@aidss.id", "bank_transfer")
        assert resp.status_code == 200, resp.text
        assert resp.json()["paymentMethod"] == "bank_transfer"

    def test_an_install_that_never_chose_still_accepts_what_it_always_did(
        self, client, fake_identity
    ):
        """No row, no restriction — the same asymmetry the checkout keeps.

        Deploying this must not invalidate a declaration that was fine yesterday
        on an install whose operator has not opened the new screen.
        """
        resp = self._declare(client, "seperti-biasa@aidss.id", "qris")
        assert resp.status_code == 200, resp.text
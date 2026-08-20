"""
Tests for the market WebSocket endpoint and health check.
"""



class TestHealthEndpoint:
    def test_health_reports_dependency_state(self, client):
        """
        /health is a readiness probe, not a literal. It reports "degraded" when
        an optional dependency is down — which is the case in CI, where there is
        no Redis and no database — and 503 only when a hard one is missing.

        This test previously asserted status == "ok" against a hardcoded
        response, so it passed while every dependency was unreachable.
        """
        resp = client.get("/health")
        assert resp.status_code in (200, 503)

        body = resp.json()
        assert body["status"] in ("ok", "degraded", "unhealthy")
        # The point of the endpoint: name what was checked.
        assert "checks" in body
        assert {"redis", "database", "model"} <= set(body["checks"])

    def test_livez_is_unconditional(self, client):
        """Liveness must not fail on a dependency outage, or restarts thrash."""
        resp = client.get("/livez")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_health_returns_version(self, client):
        resp = client.get("/health")
        assert "version" in resp.json()

    def test_health_reports_scheduler_liveness(self, client):
        """
        The daily-update heartbeat must be surfaced so "is the 24/7 scheduler
        running?" is observable rather than assumed. The field is always present
        — either a heartbeat object or an honest "no heartbeat yet" string.
        """
        body = client.get("/health").json()
        assert "daily_update" in body["checks"]

    def test_health_reports_data_freshness_when_db_present(self, client):
        """
        When the database is reachable, /health reports the newest OHLCV session
        and its age so a stalled pipeline (stale data) is visible. Skipped when
        there is no DB in the test environment — the field is DB-gated.
        """
        checks = client.get("/health").json()["checks"]
        db = checks.get("database", "")
        if isinstance(db, str) and db.startswith("unavailable"):
            import pytest
            pytest.skip("no database in this environment")
        # DB reachable → freshness fields present (unless the table is empty).
        if checks.get("ohlcv_rows"):
            assert "last_ohlcv_session" in checks
            assert "ohlcv_age_hours" in checks


class TestMarketWebSocket:
    def test_ws_connect_and_receive_snapshot(self, client):
        """WebSocket should send at least one market snapshot within 3 seconds."""
        import json
        with client.websocket_connect("/v1/ws/market") as ws:
            data = ws.receive_text()
            msg = json.loads(data)
            assert msg["type"] == "snapshot"
            assert "stocks" in msg["data"]
            assert "ihsg" in msg["data"]

    def test_ws_snapshot_has_bbca(self, client):
        import json
        with client.websocket_connect("/v1/ws/market") as ws:
            data = ws.receive_text()
            msg = json.loads(data)
            stocks = msg["data"]["stocks"]
            assert "BBCA" in stocks

    def test_ws_stock_has_price_and_change(self, client):
        import json
        with client.websocket_connect("/v1/ws/market") as ws:
            data = ws.receive_text()
            msg = json.loads(data)
            bbca = msg["data"]["stocks"]["BBCA"]
            assert "price" in bbca
            assert "change" in bbca
            assert bbca["price"] > 0

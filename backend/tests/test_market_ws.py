"""
Tests for the market WebSocket endpoint and health check.
"""

import pytest
from fastapi.testclient import TestClient


class TestHealthEndpoint:
    def test_health_returns_ok(self, client):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_health_returns_version(self, client):
        resp = client.get("/health")
        assert "version" in resp.json()


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

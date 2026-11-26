"""The dashboard asks other devices for a password, never this machine."""

import base64

import pytest
from fastapi.testclient import TestClient

from toyota_telemetry.api import app


def basic(pw: str) -> dict[str, str]:
    return {"Authorization": "Basic " + base64.b64encode(f"me:{pw}".encode()).decode()}


@pytest.fixture
def phone() -> TestClient:
    return TestClient(app, client=("192.168.1.50", 50000))


def test_no_password_set_leaves_it_open(monkeypatch, phone):
    monkeypatch.delenv("TOYOTA_TELEMETRY_PASSWORD", raising=False)
    assert phone.get("/api/settings").status_code == 200


def test_other_device_needs_the_password(monkeypatch, phone):
    monkeypatch.setenv("TOYOTA_TELEMETRY_PASSWORD", "s3cret")
    r = phone.get("/api/settings")
    assert r.status_code == 401
    assert r.headers["www-authenticate"].startswith("Basic")
    assert phone.get("/api/settings", headers=basic("wrong")).status_code == 401
    assert phone.get("/api/settings", headers={"Authorization": "Basic !!!"}).status_code == 401
    assert phone.get("/api/settings", headers=basic("s3cret")).status_code == 200


def test_this_machine_never_asked(monkeypatch):
    monkeypatch.setenv("TOYOTA_TELEMETRY_PASSWORD", "s3cret")
    local = TestClient(app, client=("127.0.0.1", 50000))
    assert local.get("/api/settings").status_code == 200


def test_qr_link_sets_a_cookie_and_drops_the_key(monkeypatch, phone):
    monkeypatch.setenv("TOYOTA_TELEMETRY_PASSWORD", "s3cret")
    r = phone.get("/trips?key=s3cret&x=1", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/trips?x=1"
    cookie = r.headers["set-cookie"]
    assert "tt_key=s3cret" in cookie and "HttpOnly" in cookie
    assert phone.get("/api/settings").status_code == 200  # the client kept the cookie


def test_wrong_key_or_cookie_is_refused(monkeypatch, phone):
    monkeypatch.setenv("TOYOTA_TELEMETRY_PASSWORD", "s3cret")
    assert phone.get("/?key=nope", follow_redirects=False).status_code == 401
    assert phone.get("/?key=", follow_redirects=False).status_code == 401
    phone.cookies.set("tt_key", "nope")
    assert phone.get("/api/settings").status_code == 401

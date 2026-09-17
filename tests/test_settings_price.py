"""Where the fuel price comes from, and whether the app admits it is a placeholder."""

from pathlib import Path

import pytest

from toyota_telemetry import store


@pytest.fixture(autouse=True)
def clean_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(store.FUEL_PRICE_ENV, raising=False)
    monkeypatch.delenv(store.CURRENCY_ENV, raising=False)


def test_fresh_db_without_env_is_flagged_as_placeholder(tmp_path: Path) -> None:
    s = store.get_settings(store.connect(tmp_path / "t.db"))
    assert s["fuel_price"] == 1.75
    assert s["currency"] == "EUR"
    assert s["fuel_price_source"] == "default"


def test_env_seeds_price_and_currency(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(store.FUEL_PRICE_ENV, "9.97")
    monkeypatch.setenv(store.CURRENCY_ENV, "RON")
    s = store.get_settings(store.connect(tmp_path / "t.db"))
    assert s["fuel_price"] == 9.97
    assert s["currency"] == "RON"
    assert s["fuel_price_source"] == "env"


def test_env_seeds_only_a_fresh_db(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A price already in the database is the user's, not something the environment resets."""
    db = tmp_path / "t.db"
    store.set_settings(store.connect(db), fuel_price=2.50)
    monkeypatch.setenv(store.FUEL_PRICE_ENV, "9.97")
    s = store.get_settings(store.connect(db))
    assert s["fuel_price"] == 2.50
    assert s["fuel_price_source"] == "manual"


def test_typing_a_price_clears_the_placeholder_flag(tmp_path: Path) -> None:
    conn = store.connect(tmp_path / "t.db")
    assert store.get_settings(conn)["fuel_price_source"] == "default"
    assert store.set_settings(conn, fuel_price=9.97)["fuel_price_source"] == "manual"


def test_currency_is_settable(tmp_path: Path) -> None:
    s = store.set_settings(store.connect(tmp_path / "t.db"), fuel_price=9.97, currency="RON")
    assert s["currency"] == "RON"


def test_db_predating_the_origin_column_is_not_nagged(tmp_path: Path) -> None:
    conn = store.connect(tmp_path / "t.db")
    conn.execute("DELETE FROM settings WHERE key = 'fuel_price_origin'")
    conn.commit()
    assert store.get_settings(conn)["fuel_price_source"] == "manual"

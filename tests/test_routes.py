"""Toyota serves routes only from the trip detail endpoint since 2026-09-30."""

import asyncio
import json
from datetime import date
from pathlib import Path

from toyota_telemetry import toyota

POINT = {"lat": 45.18, "lon": 5.72, "overspeed": False, "highway": False, "indexInPoints": 0, "mode": 0, "isEv": True}


class FakeApi:
    def __init__(self, routes: dict[str, list], fail: tuple[str, ...] = ()) -> None:
        self.routes, self.fail, self.calls = routes, fail, []

    async def trip_route(self, vin: str, trip_id: str) -> list:
        self.calls.append(trip_id)
        if trip_id in self.fail:
            raise RuntimeError("boom")
        return self.routes.get(trip_id, [])


def attach(api: FakeApi, trips: list[dict], known: dict | None = None) -> int:
    return asyncio.run(toyota.attach_routes(api, "VIN", trips, known or {}))


def test_missing_routes_are_fetched_from_the_detail_endpoint():
    trips = [{"id": "a"}, {"id": "b"}]
    missing = attach(FakeApi({"a": [POINT], "b": [POINT, POINT]}), trips)
    assert [len(t["route"]) for t in trips] == [1, 2]
    assert missing == 0


def test_a_route_already_cached_costs_no_call():
    trips = [{"id": "a"}]
    api = FakeApi({})
    assert attach(api, trips, {"a": [POINT]}) == 0
    assert api.calls == [] and trips[0]["route"] == [POINT]


def test_a_failed_fetch_does_not_abort_the_sync():
    trips = [{"id": "a"}, {"id": "b"}]
    missing = attach(FakeApi({"b": [POINT]}, fail=("a",)), trips)
    assert missing == 1
    assert "route" not in trips[0] and trips[1]["route"] == [POINT]


def test_cached_routes_are_read_from_the_month_file(tmp_path: Path):
    p = tmp_path / "2026-09.json"
    assert toyota.cached_routes(p) == {}
    p.write_text(json.dumps({"trips": [{"id": 7, "route": [POINT]}, {"id": 8}]}))
    assert toyota.cached_routes(p) == {"7": [POINT]}


def test_pull_keeps_cached_routes_when_the_list_omits_them(tmp_path: Path, monkeypatch):
    trips_dir = tmp_path / "trips"
    trips_dir.mkdir()
    month = trips_dir / "2026-09.json"
    month.write_text(json.dumps({"trips": [{"id": "old", "route": [POINT]}]}))

    class Client(FakeApi):
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def _empty(self, *a):
            return {}

        vehicles = telemetry = location = health = notifications = service_history = _empty

        async def trips(self, vin, a, b, *, summary=False):
            return {"trips": [{"id": "old"}, {"id": "new"}]}

    client = Client({"new": [POINT, POINT]})
    monkeypatch.setattr(toyota, "RAW_DIR", tmp_path)
    monkeypatch.setattr(toyota, "load_env", lambda: ("u", "p"))
    monkeypatch.setattr(toyota, "ToyotaRaw", lambda u, p: client)
    asyncio.run(toyota.pull_all("VIN", date(2026, 9, 1), date(2026, 9, 30), refresh_from=date(2026, 9, 1)))
    saved = {t["id"]: t["route"] for t in json.loads(month.read_text())["trips"]}
    assert saved == {"old": [POINT], "new": [POINT, POINT]}
    assert client.calls == ["new"]

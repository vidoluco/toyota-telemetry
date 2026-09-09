"""Command line: `toyota sync [--full] [--days N]`, `toyota load`, `toyota serve [--port]`."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from datetime import date, timedelta
from typing import Any

from toyota_telemetry import store, toyota

# Toyota keeps trips only while connected services are active, so there is a floor to how far
# back a sync can reach. Override with TOYOTA_TELEMETRY_HISTORY_START=YYYY-MM-DD when your history is older.
HISTORY_START = date.fromisoformat(os.environ.get("TOYOTA_TELEMETRY_HISTORY_START", "2024-01-01"))


def _vin() -> str:
    veh = toyota.RAW_DIR / "vehicles.json"
    if veh.exists():
        cars = json.loads(veh.read_text())
        if cars and isinstance(cars, list) and cars[0].get("vin"):
            return cars[0]["vin"]
    user, pwd = toyota.load_env()

    async def first() -> str:
        async with toyota.ToyotaRaw(user, pwd) as api:
            cars = await api.vehicles()
        if not cars:
            raise SystemExit("no vehicle linked to this MyToyota account")
        return cars[0]["vin"]

    return asyncio.run(first())


def run_sync(refresh_from: date, full: bool) -> dict[str, Any]:
    vin = _vin()
    start = HISTORY_START
    written = asyncio.run(toyota.pull_all(vin, start, date.today(), refresh_from=None if full else refresh_from))
    conn = store.connect()
    month_files = [p for p in written if p.parent.name == "trips"]
    loaded = store.load_raw(conn, only=None if full else month_files)
    snap = conn.execute("SELECT MAX(ts) t FROM snapshots").fetchone()["t"]
    conn.close()
    return {"loaded": loaded, "files": len(written), "snapshot_ts": snap}


LABEL = "com.github.toyota-telemetry.sync"


def schedule(action: str, hour: int) -> str:
    """Daily `toyota sync` through launchd, logging to data/sync.log. Local machine only."""
    import shutil
    import subprocess
    from pathlib import Path

    plist = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
    root = Path(__file__).resolve().parent.parent
    if action == "status":
        out = subprocess.run(["launchctl", "list"], capture_output=True, text=True).stdout
        return f"installed at {plist}, {'loaded' if LABEL in out else 'not loaded'}" if plist.exists() else "not installed"
    if action == "remove":
        subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
        plist.unlink(missing_ok=True)
        return "removed"
    uv = shutil.which("uv") or str(Path.home() / ".local" / "bin" / "uv")
    plist.parent.mkdir(parents=True, exist_ok=True)
    plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array><string>{uv}</string><string>run</string><string>toyota</string><string>sync</string></array>
  <key>WorkingDirectory</key><string>{root}</string>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>{hour}</integer><key>Minute</key><integer>15</integer></dict>
  <key>StandardOutPath</key><string>{root / 'data' / 'sync.log'}</string>
  <key>StandardErrorPath</key><string>{root / 'data' / 'sync.log'}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>{Path(uv).parent}:/usr/local/bin:/usr/bin:/bin</string></dict>
</dict></plist>
""")
    subprocess.run(["launchctl", "unload", str(plist)], capture_output=True)
    r = subprocess.run(["launchctl", "load", str(plist)], capture_output=True, text=True)
    return f"installed {plist}, runs daily at {hour:02d}:15" + (f" ({r.stderr.strip()})" if r.stderr.strip() else "")


def main(argv: list[str] | None = None) -> None:
    p = argparse.ArgumentParser(prog="toyota_telemetry")
    sub = p.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sync", help="pull from the Toyota cloud and load the database")
    s.add_argument("--full", action="store_true", help="re-download every month since history start")
    s.add_argument("--days", type=int, default=14, help="re-download months touching the last N days")
    sub.add_parser("load", help="rebuild the database from the raw cache, no network")
    dm = sub.add_parser("demo", help="build a synthetic database and serve it: no account needed")
    dm.add_argument("--port", type=int, default=8000)
    dm.add_argument("--no-serve", action="store_true", help="only build data/demo.db")
    sc = sub.add_parser("schedule", help="install or remove the daily sync as a macOS launchd agent")
    sc.add_argument("action", choices=["install", "remove", "status"])
    sc.add_argument("--hour", type=int, default=7, help="local hour to run the sync, default 07")
    sv = sub.add_parser("serve", help="run the API and dashboard")
    sv.add_argument("--port", type=int, default=8000)
    sv.add_argument("--host", default="127.0.0.1")
    a = p.parse_args(argv)
    if a.cmd == "sync":
        r = run_sync(date.today() - timedelta(days=a.days), a.full)
        print(f"loaded {r['loaded']} trips from {r['files']} files, snapshot {r['snapshot_ts']}")
    elif a.cmd == "load":
        conn = store.connect()
        print(f"loaded {store.load_raw(conn)} trips")
    elif a.cmd == "demo":
        import os

        from toyota_telemetry import demo

        path = store.ROOT / "data" / "demo.db"
        path.unlink(missing_ok=True)
        conn = store.connect(path)
        n = demo.load_into(conn)
        conn.close()
        print(f"demo database with {n} synthetic trips at {path}")
        if not a.no_serve:
            os.environ["TOYOTA_TELEMETRY_DB"] = str(path)
            import uvicorn

            uvicorn.run("toyota_telemetry.api:app", host="127.0.0.1", port=a.port, reload=False)
    elif a.cmd == "schedule":
        print(schedule(a.action, a.hour))
    elif a.cmd == "serve":
        import uvicorn

        uvicorn.run("toyota_telemetry.api:app", host=a.host, port=a.port, reload=False)


if __name__ == "__main__":
    main()

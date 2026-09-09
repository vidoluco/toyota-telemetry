"""Derived quantities the API does not provide: timestamps, speed, elevation, distance."""

from __future__ import annotations

import io
import itertools
import math
import os
from datetime import datetime
from pathlib import Path

import httpx
from PIL import Image

EARTH_R = 6_371_000.0

# A segment implying more than this is a GPS jump rather than driving, and is rebuilt from
# its neighbours so it cannot distort the shape of the speed curve. It is a filter on the
# sensor, not a statement about the car: no speed figure derived here is published as a
# number, because the API carries no timestamps to calibrate one against.
SPEED_CAP_KMH = float(os.environ.get("TOYOTA_TELEMETRY_SPEED_CAP", "185"))
TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
DEM_ZOOM = 12


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_R * math.asin(math.sqrt(a))


def cumulative_distance_m(points: list[tuple[float, float]]) -> list[float]:
    out = [0.0]
    for (a_lat, a_lon), (b_lat, b_lon) in itertools.pairwise(points):
        out.append(out[-1] + haversine_m(a_lat, a_lon, b_lat, b_lon))
    return out


def nearest_index(points: list[tuple[float, float]], lat: float, lon: float) -> tuple[int, float]:
    best_i, best_d = 0, float("inf")
    for i, (plat, plon) in enumerate(points):
        d = haversine_m(plat, plon, lat, lon)
        if d < best_d:
            best_i, best_d = i, d
    return best_i, best_d


def parse_ts(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def estimate_timestamps(
    points: list[tuple[float, float]],
    start_ts: datetime,
    end_ts: datetime,
    events: list[tuple[datetime, float, float]],
    max_anchor_m: float = 150.0,
    min_gap_points: int = 5,
    min_gap_s: float = 5.0,
) -> list[float]:
    """Seconds from trip start for every route point.

    Anchors are the trip start (index 0), each event whose position matches a route point
    within ``max_anchor_m``, and the trip end (last index). Between anchors the time is
    linear in the point index. Anchors that would go backwards in index or time are dropped.
    """
    n = len(points)
    if n == 0:
        return []
    total = max((end_ts - start_ts).total_seconds(), 1.0)
    if n == 1:
        return [0.0]
    anchors: list[tuple[int, float]] = [(0, 0.0)]
    candidates = []
    for ts, lat, lon in events:
        idx, d = nearest_index(points, lat, lon)
        t = (ts - start_ts).total_seconds()
        if d <= max_anchor_m and 0 < t < total and 0 < idx < n - 1:
            candidates.append((idx, t))
    for idx, t in sorted(candidates):
        if idx >= anchors[-1][0] + min_gap_points and t >= anchors[-1][1] + min_gap_s:
            anchors.append((idx, t))
    while anchors and (anchors[-1][0] > n - 1 - min_gap_points or anchors[-1][1] > total - min_gap_s) and anchors[-1][0] != 0:
        anchors.pop()
    anchors.append((n - 1, total))
    out = [0.0] * n
    for (i0, t0), (i1, t1) in itertools.pairwise(anchors):
        span = i1 - i0
        for k in range(i0, i1 + 1):
            out[k] = t0 + (t1 - t0) * (k - i0) / span
    return out


def speeds_kmh(dist_m: list[float], t_s: list[float], window: int = 11, cap: float = SPEED_CAP_KMH, k: int = 6) -> list[float]:
    """Speed at each point from a central difference over +-k points, then median-smoothed.

    Point spacing in time is itself estimated, so a wider difference window damps the
    artefacts of that interpolation. ``cap`` rejects readings the car cannot produce.
    """
    n = len(dist_m)
    if n == 0:
        return []
    dist_m = clean_glitches(dist_m, t_s, cap)
    raw = []
    for i in range(n):
        a, b = max(0, i - k), min(n - 1, i + k)
        dt = t_s[b] - t_s[a]
        v = (dist_m[b] - dist_m[a]) / dt * 3.6 if dt > 0 else 0.0
        raw.append(min(max(v, 0.0), cap))
    half = window // 2
    out = []
    for i in range(n):
        win = sorted(raw[max(0, i - half): i + half + 1])
        out.append(win[len(win) // 2])
    return out


def clean_glitches(dist_m: list[float], t_s: list[float], cap_kmh: float) -> list[float]:
    """Rebuild cumulative distance with GPS spikes removed.

    A segment whose implied speed exceeds ``cap_kmh`` cannot be driving; it is a GPS
    glitch. Its length is replaced by the median of the nearest plausible segments.
    """
    n = len(dist_m)
    if n < 3:
        return list(dist_m)
    seg = [dist_m[i] - dist_m[i - 1] for i in range(1, n)]
    dt = [max(t_s[i] - t_s[i - 1], 1e-6) for i in range(1, n)]
    ok = [s / d * 3.6 <= cap_kmh for s, d in zip(seg, dt, strict=False)]
    good = [s for s, o in zip(seg, ok, strict=False) if o]
    fallback = sorted(good)[len(good) // 2] if good else 0.0
    cleaned = []
    for i, (s, o) in enumerate(zip(seg, ok, strict=False)):
        if o:
            cleaned.append(s)
            continue
        window = [seg[j] for j in range(max(0, i - 5), min(len(seg), i + 6)) if ok[j]]
        cleaned.append(sorted(window)[len(window) // 2] if window else fallback)
    out = [0.0]
    for s in cleaned:
        out.append(out[-1] + s)
    return out


def percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    vs = sorted(values)
    return vs[min(len(vs) - 1, round(q * (len(vs) - 1)))]


def tile_xy(lat: float, lon: float, zoom: int) -> tuple[int, int, float, float]:
    """Tile column, row and the fractional pixel position inside the tile."""
    n = 2**zoom
    x = (lon + 180.0) / 360.0 * n
    lat_r = math.radians(lat)
    y = (1.0 - math.log(math.tan(lat_r) + 1 / math.cos(lat_r)) / math.pi) / 2.0 * n
    xi, yi = int(x), int(y)
    return xi, yi, (x - xi) * 256, (y - yi) * 256


def decode_terrarium(png_bytes: bytes) -> list[list[float]]:
    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    w, h = img.size
    px = img.load()
    return [[px[x, y][0] * 256 + px[x, y][1] + px[x, y][2] / 256 - 32768 for x in range(w)] for y in range(h)]


class Elevation:
    """Elevation lookup from cached Terrarium DEM tiles. Returns None when a tile is unavailable."""

    def __init__(self, cache_dir: Path, zoom: int = DEM_ZOOM, online: bool = True) -> None:
        self.cache_dir = cache_dir
        self.zoom = zoom
        self.online = online
        self._tiles: dict[tuple[int, int], list[list[float]] | None] = {}
        self._http = httpx.Client(timeout=20, headers={"User-Agent": "toyota-telemetry/0.1 (personal project)"})

    def _tile(self, x: int, y: int) -> list[list[float]] | None:
        key = (x, y)
        if key in self._tiles:
            return self._tiles[key]
        path = self.cache_dir / str(self.zoom) / str(x) / f"{y}.png"
        data: bytes | None = None
        if path.exists():
            data = path.read_bytes()
        elif self.online:
            try:
                resp = self._http.get(TERRARIUM_URL.format(z=self.zoom, x=x, y=y))
                resp.raise_for_status()
                data = resp.content
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
            except Exception:
                data = None
        self._tiles[key] = decode_terrarium(data) if data else None
        return self._tiles[key]

    def at(self, lat: float, lon: float) -> float | None:
        x, y, px, py = tile_xy(lat, lon, self.zoom)
        grid = self._tile(x, y)
        if grid is None:
            return None
        return grid[min(int(py), 255)][min(int(px), 255)]

    def profile(self, points: list[tuple[float, float]]) -> list[float | None]:
        return [self.at(lat, lon) for lat, lon in points]


def median_smooth(values: list[float], window: int = 7) -> list[float]:
    half = window // 2
    out = []
    for i in range(len(values)):
        win = sorted(values[max(0, i - half): i + half + 1])
        out.append(win[len(win) // 2])
    return out


def climb_descent(elev: list[float | None], threshold_m: float = 12.0) -> tuple[float, float]:
    """Total ascent and descent from a median-smoothed profile, with hysteresis.

    The DEM is ~40 m per pixel and the GPS trace wanders across cells, so raw differences
    invent hundreds of metres of climb on flat city driving. Smoothing plus a 12 m dead band
    keeps real hills and drops the jitter.
    """
    vals = [e for e in elev if e is not None]
    if len(vals) < 2:
        return 0.0, 0.0
    vals = median_smooth(vals)
    up = down = 0.0
    ref = vals[0]
    for e in vals[1:]:
        if e - ref >= threshold_m:
            up += e - ref
            ref = e
        elif ref - e >= threshold_m:
            down += ref - e
            ref = e
    return round(up, 1), round(down, 1)


def simplify(points: list[tuple[float, float]], tolerance: float) -> list[tuple[float, float]]:
    """Douglas-Peucker in degrees, iterative, preserving endpoints."""
    if len(points) < 3 or tolerance <= 0:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = points[a], points[b]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best_i, best_d = -1, 0.0
        for i in range(a + 1, b):
            px, py = points[i]
            d = abs(dy * px - dx * py + bx * ay - by * ax) / norm if norm else math.hypot(px - ax, py - ay)
            if d > best_d:
                best_i, best_d = i, d
        if best_d > tolerance and best_i > 0:
            keep[best_i] = True
            stack.append((a, best_i))
            stack.append((best_i, b))
    return [p for p, k in zip(points, keep, strict=False) if k]

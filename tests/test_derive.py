import itertools
from datetime import UTC, datetime, timedelta

from toyota_telemetry import derive

T0 = datetime(2026, 9, 1, 8, 0, tzinfo=UTC)


def straight_line(n: int, step_deg: float = 0.001) -> list[tuple[float, float]]:
    return [(44.4 + i * step_deg, 26.0) for i in range(n)]


def test_haversine_one_degree_lat_is_111km():
    assert abs(derive.haversine_m(44.0, 26.0, 45.0, 26.0) - 111_195) < 300


def test_timestamps_without_events_are_linear():
    pts = straight_line(11)
    t = derive.estimate_timestamps(pts, T0, T0 + timedelta(seconds=100), [])
    assert t[0] == 0 and t[-1] == 100 and abs(t[5] - 50) < 1e-9


def test_timestamps_anchor_on_event():
    pts = straight_line(21)
    ev = [(T0 + timedelta(seconds=20), pts[10][0], pts[10][1])]  # reached midpoint after 20 s of 100
    t = derive.estimate_timestamps(pts, T0, T0 + timedelta(seconds=100), ev)
    assert abs(t[10] - 20) < 1e-9
    assert all(b > a for a, b in itertools.pairwise(t))  # strictly increasing


def test_timestamps_ignore_far_or_backwards_events():
    pts = straight_line(31)
    far = (T0 + timedelta(seconds=20), 45.0, 26.0)  # 60 km away
    back = (T0 + timedelta(seconds=90), pts[6][0], pts[6][1])  # index 6 at t=90 then index 15 at t=20: keep first only
    later = (T0 + timedelta(seconds=20), pts[15][0], pts[15][1])
    t = derive.estimate_timestamps(pts, T0, T0 + timedelta(seconds=100), [far, back, later])
    assert all(b > a for a, b in itertools.pairwise(t))


def test_speed_from_distance_and_time():
    dist = [0.0, 100.0, 200.0, 300.0, 400.0]
    t = [0.0, 10.0, 20.0, 30.0, 40.0]
    v = derive.speeds_kmh(dist, t, window=1, k=1)
    assert all(abs(x - 36.0) < 1e-9 for x in v)


def test_speed_is_capped_at_what_the_car_can_do():
    v = derive.speeds_kmh([0.0, 10_000.0, 10_000.0, 10_000.0], [0.0, 1.0, 2.0, 3.0], window=1, k=1)
    assert max(v) <= derive.SPEED_CAP_KMH and min(v) >= 0.0


def test_a_real_motorway_speed_survives_the_cap():
    # 150 km/h for six seconds: 250 m of travel, sampled every second
    dist = [i * 41.7 for i in range(7)]
    t = [float(i) for i in range(7)]
    v = derive.speeds_kmh(dist, t, window=1, k=1)
    assert 145 <= max(v) <= 155


def test_terrarium_decode_formula():
    import io

    from PIL import Image
    img = Image.new("RGB", (256, 256), (128, 200, 0))  # 128*256 + 200 - 32768 = 200 m
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    grid = derive.decode_terrarium(buf.getvalue())
    assert grid[0][0] == 200.0 and len(grid) == 256


def test_climb_descent_with_hysteresis():
    raw = [100] * 8 + [110] * 8 + [120] * 8 + [100] * 8 + [None] + [105] * 8  # plateaus longer than the median window
    up, down = derive.climb_descent(raw, threshold_m=4.0)
    assert up == 25.0 and down == 20.0
    assert derive.climb_descent([100, 103, 100, 104, 100, 103, 100] * 5, threshold_m=4.0) == (0.0, 0.0)  # jitter ignored  # 100->110->120 up 20, 120->100 down 20, 100->105 up 5


def test_simplify_keeps_corners():
    pts = [(0.0, 0.0), (0.5, 0.0001), (1.0, 0.0), (1.0, 1.0)]
    assert derive.simplify(pts, 0.001) == [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0)]


def test_tile_xy_known_point():
    x, y, _, _ = derive.tile_xy(45.19, 5.72, 12)
    assert (x, y) == (2113, 1470)


def test_gps_spike_does_not_become_speed():
    # 2 s cadence, 10 m per step (18 km/h), one point jumps 400 m away and back
    dist = [0.0, 10.0, 20.0, 420.0, 430.0, 440.0, 450.0]
    t = [0.0, 2.0, 4.0, 6.0, 8.0, 10.0, 12.0]
    cleaned = derive.clean_glitches(dist, t, cap_kmh=160)
    assert abs(cleaned[-1] - 60.0) < 1e-9  # the 400 m spike replaced by a typical 10 m step
    v = derive.speeds_kmh(dist, t, window=1, k=1)
    assert max(v) < 20.0


def test_percentile():
    assert derive.percentile([1, 2, 3, 4, 100], 0.5) == 3 and derive.percentile([], 0.9) == 0.0

# Contributing

Bug reports, other Toyota models and better analytics are all welcome.

## Getting set up

```bash
uv sync
cd web && npm ci && npm run build && cd ..
uv run toyota demo       # synthetic data, no account needed
```

Work against the demo dataset whenever you can: it is deterministic, it needs no credentials,
and it means no real GPS trace ends up in a screenshot or a test fixture.

## Before opening a pull request

```bash
uv run pytest           # backend
uv run ruff check toyota_telemetry tests
cd web && npx tsc -b && npx vitest run && npm run build
```

## Things to know about the data

- Toyota sends route points **without timestamps**. Speed, elevation and climb are derived in
  `toyota_telemetry/derive.py` and must stay labelled as estimates in the interface.
- The coaching codes (`coachingMsg`, `diagnosticMsg`) are undocumented. The labels in
  `toyota_telemetry/labels.py` are inferred from the event type and Toyota's own good/bad flag. If you
  have evidence for a code, please bring it: that mapping is the weakest part of the project.
- `pytoyoda` models sometimes reject a vehicle payload. The raw client in `toyota_telemetry/toyota.py`
  exists for that reason. If you fix a model upstream, say so here and we will drop the
  workaround.

## What does not belong in a pull request

- Real trip data, screenshots with real coordinates, or a VIN.
- Anything that sends data anywhere other than Toyota and the map tile hosts.

## Adding a screenshot

Generate it from the demo dataset at a 1600 by 1000 viewport, convert to webp, and keep it
under 200 KB:

```bash
cwebp -q 82 shot.png -o docs/img/name.webp
```

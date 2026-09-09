# Third-party services and data

Everything this project talks to, and why.

| What | Used for | Terms |
|---|---|---|
| Toyota Connected Services Europe (`ctpa-oneapi`) | your own vehicle data, with your own credentials | undocumented, unofficial, no public API terms |
| [pytoyoda](https://github.com/pytoyoda/pytoyoda) | authentication against that backend | MIT |
| [OpenFreeMap](https://openfreemap.org) | vector basemap tiles, no key | free, no account, [usage](https://openfreemap.org/#pricing) |
| [OpenMapTiles](https://openmaptiles.org) schema, [OpenStreetMap](https://www.openstreetmap.org/copyright) data | the map itself | ODbL, attributed in the interface |
| [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Mapzen Terrarium) | elevation and 3D terrain | public domain / open data, attributed in the interface |
| [OSRM demo server](https://project-osrm.org) | fetched **once** to generate the demo dataset's road geometry, cached in `toyota_telemetry/demo_routes.json` | not called at runtime |

No analytics, no error reporting, no telemetry of any kind.

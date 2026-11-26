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
| [Sketchfab](https://sketchfab.com) Viewer API &amp; 3D models | interactive 3D Toyota models on the Overview page ([Yaris](https://sketchfab.com/3d-models/toyota-yaris-2020-b702373da1274645a8c57da1cac8bf4d), [Yaris Cross](https://sketchfab.com/3d-models/toyota-yaris-cross-2021-cacdb1efe9244b2597611e24c7820b84) &amp; [C-HR](https://sketchfab.com/3d-models/toyota-c-hr-gr-sport-2021-f426a2f495fc41c8aaef33574d232567) by [SQUIR3D](https://sketchfab.com/SQUIR3D); [Corolla](https://sketchfab.com/3d-models/toyota-corolla-2020-6d7d34ee42734d1ab28a6b1f1c5fc4fc) by [ItsDiyor](https://sketchfab.com/ItsDiyor); [RAV4](https://sketchfab.com/3d-models/2023-toyota-rav4-hybrid-ed155ad0cb7d447085a519eaff9aa2df) by [Ddiaz Design](https://sketchfab.com/ddiaz-design)) | Sketchfab Standard License, embedded via public viewer |

No analytics, no error reporting, no telemetry of any kind.

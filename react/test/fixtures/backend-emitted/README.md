# Backend-emitted event logs

Recorded session logs from the platform go here, one JSON file per recorded
session or turn, as `GET /sessions/<id>/events` returned them through the
public API. Every `*.json` file in this directory is run by
`react/src/fixtures.test.ts` on `npm test`: replayed whole and in pages, and
checked for settled tool rows on settled turns, unique tool rows and a decoded
result.

The file shape is the one the authored fixtures in `../documented/` use:

```json
{ "events": [ ...events, in log order... ], "turns": [ ...expected turns, optional... ] }
```

`turns` is optional; when present it is compared for deep equality with what
the reducer produces. Without it the invariants above are still checked.

This directory holds only this README until the platform emits the documented
event shape on every runtime (bluecode F2); recordings made before then would
pin the wrong contract. Add recordings here once that ships, do not author
them by hand.

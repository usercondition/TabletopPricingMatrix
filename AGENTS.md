# AGENTS.md

## Cursor Cloud specific instructions

### Product

**Tabletop Pricing Matrix** — competitive resin-print quote tool for Print Operations.

Flow:
1. Slicer resin grams × live Amazon bottle cost → material
2. Cost stack → min-margin floor
3. Amazon listing for the finished item → undercut while maximizing profit
4. Map to HubSpot fields

### Reliability / hang prevention

- Generate **never waits on Amazon**. Live fetches are background-only; manual `$` fields always work.
- Client API calls abort at **12s**; Amazon server fetch aborts at **8s** and falls back to cache/manual.
- Concurrent Amazon requests for the same ASIN are **deduped**.
- UI does **not** full-re-render on status changes (avoids wiped inputs / frozen “Working…”).
- Form state persists in `sessionStorage` (`tpm-pricing-v2`).
- Stale `/api/price` responses are ignored via a sequence counter.

### Services

| Service | Command | Port |
|---|---|---|
| App | `npm run build && npm run start` (or `npm run dev`) | `PORT` or `4177` |
| Tests | `npm test` | |
| Lint | `npm run lint` | |

### Print Operations

Link from HubSpotHost Tools via `PRICING_MATRIX_URL`. Patch in `patches/`.

# AGENTS.md

## Cursor Cloud specific instructions

### Product

**Tabletop Pricing Matrix** — competitive resin-print quote tool.

Core flow:
1. Slicer resin grams × live Amazon bottle cost → material
2. Full cost stack → min-margin floor
3. Amazon listing for the finished product → undercut while maximizing profit
4. Map to HubSpot Print Operations fields

### Services

| Service | Command | Port |
|---|---|---|
| App | `npm run build && npm run start` (or `npm run dev`) | `PORT` or `4177` |
| Tests | `npm test` | |
| Lint | `npm run lint` | |

Amazon HTML price parse is best-effort (cache + manual fallback).

### Print Operations

Link from HubSpotHost Tools via `PRICING_MATRIX_URL`. Patch in `patches/`.

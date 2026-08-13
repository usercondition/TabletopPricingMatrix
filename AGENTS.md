# AGENTS.md

## Cursor Cloud specific instructions

### Product

**Tabletop Pricing Matrix** — resin-print quote generator. Express API + static Vite client.

### Services

| Service | Command | Notes |
|---|---|---|
| Pricing app (dev) | `npm run build && npm run dev` | Listens on `PORT` or `4177`. |
| Tests | `npm test` | Node test runner. |
| Typecheck | `npm run lint` | `tsc --noEmit`. |

No database. Amazon resin price is best-effort HTML parse with cache/fallback.

### Dependency refresh

`npm install` (see `.cursor/environment.json`).

### Print Operations

This tool is linked from HubSpotHost Print Operations **Tools** nav. Deploy URL goes in `PRICING_MATRIX_URL` on that service.

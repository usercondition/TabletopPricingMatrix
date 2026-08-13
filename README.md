# Tabletop Pricing Matrix

Quote generator for resin print jobs that **undercuts Warhammer RRP / Amazon** while maximizing profit.

## How it prices

1. **Slicer grams** × **live bottle cost** (Amazon resin ASIN) → material  
2. Add labor, machine, failure buffer, pack, ship → **cost floor** (supports **quantity**)  
3. Pick a **Warhammer kit** from the local SQLite catalog (or fetch an Amazon listing) as the competitor price  
4. Recommend the **highest price that still undercuts** that RRP (default 5%), unless that drops below your min-margin floor  

Generate never blocks on Amazon — type listing `$` manually anytime.

## Warhammer price catalog

- Seed JSON: `data/warhammer/seed.json` (~117 kits, unofficial USD RRP snapshots)
- Local DB: `data/warhammer/catalog.db` (created on boot / `npm run seed:warhammer`)
- APIs: `GET /api/warhammer/search?q=…`, `/stats`, `/factions`, `/:id`; `POST /api/warhammer/import`, `/reseed`
- Not affiliated with Games Workshop — verify prices before selling

## Reliability

- 8s Amazon server timeout + cache + fallback  
- 12s client abort  
- In-flight Amazon request dedupe  
- Stable form (no full-page wipe on status)  
- sessionStorage for inputs  

## Run locally

```bash
npm install
npm run build
npm run dev   # http://127.0.0.1:4177
npm test
npm run lint
```

## Railway

`railway.toml` included. Deploy this repo, then on Print Operations set:

```text
PRICING_MATRIX_URL=https://<this-service>.up.railway.app
```

HubSpotHost Tools integration patch: see `patches/APPLY-HUBSPOTHOST.md`.

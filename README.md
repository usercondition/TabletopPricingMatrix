# Tabletop Pricing Matrix

Quote generator for resin print jobs that **undercuts Amazon** while maximizing profit.

## How it prices

1. **Slicer grams** × **live bottle cost** (Amazon resin ASIN) → material  
2. Add labor, machine, failure buffer, pack, ship → **cost floor** (supports **quantity**)  
3. Fetch the **Amazon listing** for the finished item you compete with  
4. Recommend the **highest price that still undercuts** Amazon (default 5%), unless that drops below your min-margin floor  

Generate never blocks on Amazon — type listing `$` manually anytime.

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

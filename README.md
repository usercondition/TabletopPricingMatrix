# Tabletop Pricing Matrix

Quote generator for resin print jobs. Uses live Amazon bottle pricing (when available), your labor/machine rates, and Print Operations margin targets to recommend **floor / target / stretch** prices.

## What it does

1. Pulls real-world resin bottle price (Amazon ASIN, with cache + fallback).
2. Stacks material + labor + machine + failure buffer + pack/ship.
3. Solves for quote amounts at 25% / 40% / 55% margin (configurable).
4. Shows external market bands ($/g and $/print-hour) as a sanity check.
5. Maps outputs onto HubSpot Print Operations fields (`amount`, `print_*_cost`).

## Run locally

```bash
npm install
npm run build
npm run dev
```

Open http://127.0.0.1:4177

```bash
npm test
npm run lint
```

## Railway

This repo includes `railway.toml`. In your Railway project:

1. Add a service from this GitHub repo (`TabletopPricingMatrix`), branch `main`.
2. Deploy — health check is `/api/health`.
3. Copy the public URL.

## Print Operations integration

In **HubSpotHost** (Print Operations), the sidebar **Tools** section links to this app via `PRICING_MATRIX_URL` (falls back to `/pricing-matrix` relative path if unset).

Set on the Print Operations Railway service:

```text
PRICING_MATRIX_URL=https://<your-pricing-matrix>.up.railway.app
```

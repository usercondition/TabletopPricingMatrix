import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_INPUTS,
  generatePricing,
  type PricingInputs,
} from "../shared/pricing-model.js";
import { fetchAmazonListing, fetchAmazonResinPrice } from "./resin-market.js";
import {
  getWarhammerUnit,
  listFactions,
  seedWarhammerDb,
  searchWarhammerUnits,
  upsertUnits,
  warhammerStats,
  type WarhammerSeedRow,
} from "./warhammer-db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4177);

app.use(express.json({ limit: "1mb" }));

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

try {
  seedWarhammerDb(false);
} catch (err) {
  console.warn("Warhammer seed on boot failed:", err);
}

app.get("/api/health", (_req, res) => {
  let warhammer = null;
  try {
    warhammer = warhammerStats();
  } catch {
    warhammer = { total: 0, factions: 0, path: null, disclaimer: "unavailable" };
  }
  res.json({
    ok: true,
    service: "tabletop-pricing-matrix",
    time: new Date().toISOString(),
    amazonTimeoutMs: 8_000,
    warhammer,
  });
});

app.get("/api/resin-market", async (req, res) => {
  try {
    const asin = typeof req.query.asin === "string" ? req.query.asin : undefined;
    const force = req.query.force === "1" || req.query.force === "true";
    res.json(await fetchAmazonResinPrice({ asin, force }));
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Resin market fetch failed",
    });
  }
});

app.get("/api/amazon-product", async (req, res) => {
  try {
    const asinOrUrl =
      typeof req.query.asin === "string"
        ? req.query.asin
        : typeof req.query.url === "string"
          ? req.query.url
          : "";
    if (!asinOrUrl.trim()) {
      res.status(400).json({ error: "Pass ?asin= or ?url=" });
      return;
    }
    const force = req.query.force === "1" || req.query.force === "true";
    res.json(await fetchAmazonListing({ asinOrUrl, force }));
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Amazon product fetch failed",
    });
  }
});

app.get("/api/warhammer/stats", (_req, res) => {
  try {
    res.json(warhammerStats());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "stats failed" });
  }
});

app.get("/api/warhammer/factions", (_req, res) => {
  try {
    res.json({ factions: listFactions() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "factions failed" });
  }
});

app.get("/api/warhammer/search", (req, res) => {
  try {
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const limit = num(req.query.limit, 25);
    const units = searchWarhammerUnits(q, limit);
    res.json({
      query: q,
      count: units.length,
      units,
      disclaimer: warhammerStats().disclaimer,
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "search failed" });
  }
});

app.get("/api/warhammer/:id", (req, res) => {
  try {
    const unit = getWarhammerUnit(req.params.id);
    if (!unit) {
      res.status(404).json({ error: "Unit not found" });
      return;
    }
    res.json({ unit, disclaimer: warhammerStats().disclaimer });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "lookup failed" });
  }
});

app.post("/api/warhammer/import", (req, res) => {
  try {
    const body = req.body as { units?: WarhammerSeedRow[]; replaceSeed?: boolean };
    if (!Array.isArray(body.units) || body.units.length === 0) {
      res.status(400).json({ error: "Body must include units: WarhammerSeedRow[]" });
      return;
    }
    for (const u of body.units) {
      if (!u?.id || !u?.name || !u?.faction || !Number.isFinite(Number(u.gwPriceUsd))) {
        res.status(400).json({ error: "Each unit needs id, name, faction, gwPriceUsd" });
        return;
      }
    }
    if (body.replaceSeed) seedWarhammerDb(true);
    const upserted = upsertUnits(body.units);
    res.json({ upserted, stats: warhammerStats() });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "import failed" });
  }
});

app.post("/api/warhammer/reseed", (_req, res) => {
  try {
    res.json(seedWarhammerDb(true));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "reseed failed" });
  }
});

app.post("/api/price", (req, res) => {
  try {
    const body = (req.body ?? {}) as Partial<PricingInputs>;
    const input: PricingInputs = {
      ...DEFAULT_INPUTS,
      resinMassG: num(body.resinMassG, DEFAULT_INPUTS.resinMassG),
      resinVolumeMl: num(body.resinVolumeMl, DEFAULT_INPUTS.resinVolumeMl),
      quantity: num(body.quantity, DEFAULT_INPUTS.quantity),
      bottlePriceUsd: num(body.bottlePriceUsd, DEFAULT_INPUTS.bottlePriceUsd),
      bottleMassG: num(body.bottleMassG, DEFAULT_INPUTS.bottleMassG),
      bottleVolumeMl:
        body.bottleVolumeMl === null || body.bottleVolumeMl === undefined
          ? DEFAULT_INPUTS.bottleVolumeMl
          : num(body.bottleVolumeMl, 0),
      competitorPriceUsd: num(body.competitorPriceUsd, DEFAULT_INPUTS.competitorPriceUsd),
      undercutPercent: num(body.undercutPercent, DEFAULT_INPUTS.undercutPercent),
      undercutExtraUsd: num(body.undercutExtraUsd, DEFAULT_INPUTS.undercutExtraUsd),
      laborMinutes: num(body.laborMinutes, DEFAULT_INPUTS.laborMinutes),
      laborRatePerHour: num(body.laborRatePerHour, DEFAULT_INPUTS.laborRatePerHour),
      printHours: num(body.printHours, DEFAULT_INPUTS.printHours),
      machineRatePerHour: num(body.machineRatePerHour, DEFAULT_INPUTS.machineRatePerHour),
      packagingUsd: num(body.packagingUsd, DEFAULT_INPUTS.packagingUsd),
      shippingUsd: num(body.shippingUsd, DEFAULT_INPUTS.shippingUsd),
      failureRate: num(body.failureRate, DEFAULT_INPUTS.failureRate),
      minMargin: num(body.minMargin, DEFAULT_INPUTS.minMargin),
      targetMargin: num(body.targetMargin, DEFAULT_INPUTS.targetMargin),
    };

    if (input.resinMassG < 0 || input.bottlePriceUsd < 0 || input.competitorPriceUsd < 0) {
      res.status(400).json({ error: "Costs and prices must be non-negative" });
      return;
    }

    res.json({ input, result: generatePricing(input) });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Pricing failed",
    });
  }
});

const clientDist = path.resolve(__dirname, "../dist/client");
const clientSrc = path.resolve(__dirname, "../client");
const useDist = fs.existsSync(path.join(clientDist, "index.html"));
app.use(express.static(useDist ? clientDist : clientSrc, { fallthrough: true }));
app.get(/^(?!\/api).*/, (_req, res, next) => {
  res.sendFile(path.join(useDist ? clientDist : clientSrc, "index.html"), (err) => {
    if (err) next(err);
  });
});

app.listen(PORT, () => {
  console.log(`tabletop-pricing-matrix listening on :${PORT}`);
});

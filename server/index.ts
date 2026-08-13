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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4177);

app.use(express.json({ limit: "256kb" }));

function num(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "tabletop-pricing-matrix",
    time: new Date().toISOString(),
    amazonTimeoutMs: 8_000,
  });
});

app.get("/api/resin-market", async (req, res) => {
  try {
    const asin = typeof req.query.asin === "string" ? req.query.asin : undefined;
    const force = req.query.force === "1" || req.query.force === "true";
    const price = await fetchAmazonResinPrice({ asin, force });
    res.json(price);
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
    const listing = await fetchAmazonListing({ asinOrUrl, force });
    res.json(listing);
  } catch (err) {
    res.status(502).json({
      error: err instanceof Error ? err.message : "Amazon product fetch failed",
    });
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

    res.json({
      input,
      result: generatePricing(input),
    });
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

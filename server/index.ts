import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_INPUTS,
  generatePricing,
  type PricingInputs,
} from "../shared/pricing-model.js";
import { fetchAmazonResinPrice } from "./resin-market.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 4177);

app.use(express.json({ limit: "256kb" }));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "tabletop-pricing-matrix",
    time: new Date().toISOString(),
  });
});

app.get("/api/resin-market", async (req, res) => {
  const asin = typeof req.query.asin === "string" ? req.query.asin : undefined;
  const force = req.query.force === "1" || req.query.force === "true";
  const price = await fetchAmazonResinPrice({ asin, force });
  res.json(price);
});

app.post("/api/price", (req, res) => {
  const body = (req.body ?? {}) as Partial<PricingInputs>;
  const input: PricingInputs = {
    ...DEFAULT_INPUTS,
    ...body,
    resinMassG: Number(body.resinMassG ?? DEFAULT_INPUTS.resinMassG),
    resinVolumeMl: Number(body.resinVolumeMl ?? DEFAULT_INPUTS.resinVolumeMl),
    bottlePriceUsd: Number(body.bottlePriceUsd ?? DEFAULT_INPUTS.bottlePriceUsd),
    bottleMassG: Number(body.bottleMassG ?? DEFAULT_INPUTS.bottleMassG),
    bottleVolumeMl:
      body.bottleVolumeMl === null || body.bottleVolumeMl === undefined
        ? DEFAULT_INPUTS.bottleVolumeMl
        : Number(body.bottleVolumeMl),
    laborMinutes: Number(body.laborMinutes ?? DEFAULT_INPUTS.laborMinutes),
    laborRatePerHour: Number(body.laborRatePerHour ?? DEFAULT_INPUTS.laborRatePerHour),
    printHours: Number(body.printHours ?? DEFAULT_INPUTS.printHours),
    machineRatePerHour: Number(body.machineRatePerHour ?? DEFAULT_INPUTS.machineRatePerHour),
    packagingUsd: Number(body.packagingUsd ?? DEFAULT_INPUTS.packagingUsd),
    shippingUsd: Number(body.shippingUsd ?? DEFAULT_INPUTS.shippingUsd),
    failureRate: Number(body.failureRate ?? DEFAULT_INPUTS.failureRate),
    floorMargin: Number(body.floorMargin ?? DEFAULT_INPUTS.floorMargin),
    targetMargin: Number(body.targetMargin ?? DEFAULT_INPUTS.targetMargin),
    stretchMargin: Number(body.stretchMargin ?? DEFAULT_INPUTS.stretchMargin),
  };

  if (!Number.isFinite(input.resinMassG) || input.resinMassG < 0) {
    res.status(400).json({ error: "resinMassG must be a non-negative number" });
    return;
  }

  res.json({
    input,
    result: generatePricing(input),
  });
});

const clientDist = path.resolve(__dirname, "../dist/client");
const clientSrc = path.resolve(__dirname, "../client");
const staticRoot = path.join(clientDist, "index.html");
const useDist = fs.existsSync(staticRoot);
app.use(express.static(useDist ? clientDist : clientSrc));
app.get(/^(?!\/api).*/, (req, res, next) => {
  const indexPath = path.join(useDist ? clientDist : clientSrc, "index.html");
  res.sendFile(indexPath, (err) => {
    if (err) next(err);
  });
});

app.listen(PORT, () => {
  console.log(`tabletop-pricing-matrix listening on :${PORT}`);
});

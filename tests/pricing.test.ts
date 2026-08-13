import test from "node:test";
import assert from "node:assert/strict";
import {
  amountForMargin,
  computeCompetitiveQuote,
  computeCosts,
  generatePricing,
  DEFAULT_INPUTS,
  round2,
} from "../shared/pricing-model.js";
import { parseAmazonProductPrice, parseAsin } from "../server/resin-market.js";

test("amountForMargin uses cost / (1 - margin)", () => {
  assert.equal(amountForMargin(60, 0.4), 100);
});

test("parseAsin accepts bare ASIN and dp URL", () => {
  assert.equal(parseAsin("B0D6Y6JV42"), "B0D6Y6JV42");
  assert.equal(parseAsin("https://www.amazon.com/dp/B0D6Y6JV42?th=1"), "B0D6Y6JV42");
});

test("undercut maximizes profit under Amazon when above floor", () => {
  const input = {
    ...DEFAULT_INPUTS,
    resinMassG: 50,
    bottlePriceUsd: 30,
    bottleMassG: 1000,
    competitorPriceUsd: 120,
    undercutPercent: 0.05,
    undercutExtraUsd: 0,
    minMargin: 0.25,
    quantity: 1,
  };
  const result = generatePricing(input);
  assert.equal(result.competitive.strategy, "undercut_max_profit");
  assert.equal(result.competitive.recommendedUsd, 114);
  assert.equal(result.competitive.viable, true);
  assert.ok((result.insights.maxViableUndercutPercent ?? 0) > 5);
});

test("quantity scales Amazon and costs", () => {
  const one = generatePricing({
    ...DEFAULT_INPUTS,
    competitorPriceUsd: 100,
    undercutPercent: 0.1,
    quantity: 1,
  });
  const two = generatePricing({
    ...DEFAULT_INPUTS,
    competitorPriceUsd: 100,
    undercutPercent: 0.1,
    quantity: 2,
  });
  assert.equal(two.costs.quantity, 2);
  assert.equal(two.competitive.recommendedUsd, round2(one.competitive.recommendedUsd * 2));
  assert.equal(two.competitive.amazonListingUsd, 200);
});

test("blocks undercut when Amazon is below cost floor", () => {
  const input = {
    ...DEFAULT_INPUTS,
    resinMassG: 500,
    bottlePriceUsd: 40,
    competitorPriceUsd: 30,
    undercutPercent: 0.05,
    laborMinutes: 120,
    printHours: 20,
    minMargin: 0.25,
  };
  const costs = computeCosts(input);
  const competitive = computeCompetitiveQuote(input, costs);
  assert.equal(competitive.strategy, "cost_floor_blocked");
  assert.equal(competitive.viable, false);
  assert.equal(competitive.recommendedUsd, competitive.minViableUsd);
});

test("without competitor uses target margin", () => {
  const result = generatePricing({ ...DEFAULT_INPUTS, competitorPriceUsd: 0 });
  assert.equal(result.competitive.strategy, "no_competitor_target_margin");
  assert.equal(result.recommended.marginPercent, 40);
  assert.equal(result.insights.amazonBeatsFloor, null);
});

test("hubspot fields sum to cost total", () => {
  const result = generatePricing({ ...DEFAULT_INPUTS, competitorPriceUsd: 150, quantity: 3 });
  assert.equal(
    round2(
      result.hubspotFields.print_material_cost +
        result.hubspotFields.print_labor_cost +
        result.hubspotFields.print_packaging_cost +
        result.hubspotFields.print_actual_shipping_cost,
    ),
    result.costs.costTotalUsd,
  );
});

test("parseAmazonProductPrice reads priceToPay", () => {
  assert.equal(parseAmazonProductPrice(`{"priceToPay":{"amount":27.99}}`), 27.99);
});

test("insights expose profit per print hour", () => {
  const result = generatePricing({
    ...DEFAULT_INPUTS,
    competitorPriceUsd: 200,
    printHours: 5,
    quantity: 2,
  });
  assert.ok(result.insights.profitPerPrintHour !== null);
  assert.ok(result.insights.profitPerPrintHour > 0);
});

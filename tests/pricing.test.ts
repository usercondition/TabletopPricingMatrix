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

test("costs are resin only; shipping is separate", () => {
  const costs = computeCosts({
    ...DEFAULT_INPUTS,
    resinMassG: 100,
    bottlePriceUsd: 30,
    bottleMassG: 1000,
    shippingUsd: 12,
    quantity: 2,
  });
  assert.equal(costs.materialUsd, 6);
  assert.equal(costs.costTotalUsd, 6);
  assert.equal(costs.shippingUsd, 12);
});

test("undercut maximizes profit under competitor when above floor", () => {
  const input = {
    ...DEFAULT_INPUTS,
    resinMassG: 50,
    bottlePriceUsd: 30,
    bottleMassG: 1000,
    competitorPriceUsd: 120,
    undercutPercent: 0.05,
    undercutExtraUsd: 0,
    shippingUsd: 8,
    minMargin: 0.25,
    quantity: 1,
  };
  const result = generatePricing(input);
  assert.equal(result.competitive.strategy, "undercut_max_profit");
  assert.equal(result.competitive.recommendedProductUsd, 114);
  assert.equal(result.competitive.recommendedUsd, 122); // 114 + $8 shipping
  assert.equal(result.competitive.shippingUsd, 8);
  assert.equal(result.competitive.viable, true);
  assert.ok((result.insights.maxViableUndercutPercent ?? 0) > 5);
});

test("quantity scales competitor and product price; shipping once", () => {
  const one = generatePricing({
    ...DEFAULT_INPUTS,
    competitorPriceUsd: 100,
    undercutPercent: 0.1,
    shippingUsd: 8,
    quantity: 1,
  });
  const two = generatePricing({
    ...DEFAULT_INPUTS,
    competitorPriceUsd: 100,
    undercutPercent: 0.1,
    shippingUsd: 8,
    quantity: 2,
  });
  assert.equal(two.costs.quantity, 2);
  assert.equal(two.competitive.recommendedProductUsd, round2(one.competitive.recommendedProductUsd * 2));
  assert.equal(two.competitive.amazonListingUsd, 200);
  assert.equal(two.competitive.shippingUsd, 8);
  assert.equal(
    two.competitive.recommendedUsd,
    round2(two.competitive.recommendedProductUsd + 8),
  );
});

test("blocks undercut when competitor is below resin cost floor", () => {
  const input = {
    ...DEFAULT_INPUTS,
    resinMassG: 900,
    bottlePriceUsd: 40,
    bottleMassG: 1000,
    competitorPriceUsd: 30,
    undercutPercent: 0.05,
    shippingUsd: 5,
    minMargin: 0.25,
  };
  const costs = computeCosts(input);
  const competitive = computeCompetitiveQuote(input, costs);
  assert.equal(competitive.strategy, "cost_floor_blocked");
  assert.equal(competitive.viable, false);
  assert.equal(competitive.recommendedProductUsd, competitive.minViableUsd);
  assert.equal(competitive.recommendedUsd, round2(competitive.minViableUsd + 5));
});

test("without competitor uses target margin then adds shipping", () => {
  const result = generatePricing({
    ...DEFAULT_INPUTS,
    competitorPriceUsd: 0,
    shippingUsd: 8,
  });
  assert.equal(result.competitive.strategy, "no_competitor_target_margin");
  assert.ok(result.competitive.marginPercent >= 39.5 && result.competitive.marginPercent <= 40.5);
  assert.equal(
    result.competitive.recommendedUsd,
    round2(result.competitive.recommendedProductUsd + 8),
  );
  assert.equal(result.insights.amazonBeatsFloor, null);
});

test("hubspot amount is product + shipping; labor/pack are zero", () => {
  const result = generatePricing({
    ...DEFAULT_INPUTS,
    competitorPriceUsd: 150,
    shippingUsd: 10,
    quantity: 3,
  });
  assert.equal(result.hubspotFields.print_labor_cost, 0);
  assert.equal(result.hubspotFields.print_packaging_cost, 0);
  assert.equal(result.hubspotFields.print_actual_shipping_cost, 10);
  assert.equal(result.hubspotFields.print_material_cost, result.costs.materialUsd);
  assert.equal(
    result.hubspotFields.suggested_amount,
    round2(result.competitive.recommendedProductUsd + 10),
  );
});

test("parseAmazonProductPrice reads priceToPay", () => {
  assert.equal(parseAmazonProductPrice(`{"priceToPay":{"amount":27.99}}`), 27.99);
});

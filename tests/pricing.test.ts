import test from "node:test";
import assert from "node:assert/strict";
import {
  amountForMargin,
  generatePricing,
  DEFAULT_INPUTS,
  round2,
} from "../shared/pricing-model.js";
import { parseAmazonProductPrice } from "../server/resin-market.js";

test("amountForMargin uses cost / (1 - margin)", () => {
  assert.equal(amountForMargin(60, 0.4), 100);
  assert.equal(amountForMargin(75, 0.25), 100);
});

test("generatePricing recommends 40% target by default", () => {
  const result = generatePricing(DEFAULT_INPUTS);
  assert.equal(result.recommended.id, "target");
  assert.equal(result.recommended.marginPercent, 40);
  assert.ok(result.recommended.amountUsd > result.costs.costTotalUsd);
  assert.equal(
    round2(result.hubspotFields.print_material_cost + result.hubspotFields.print_labor_cost + result.hubspotFields.print_packaging_cost + result.hubspotFields.print_actual_shipping_cost),
    result.costs.costTotalUsd,
  );
});

test("zero resin and time yields zero quote", () => {
  const result = generatePricing({
    ...DEFAULT_INPUTS,
    resinMassG: 0,
    resinVolumeMl: 0,
    laborMinutes: 0,
    printHours: 0,
    packagingUsd: 0,
    shippingUsd: 0,
  });
  assert.equal(result.costs.costTotalUsd, 0);
  assert.equal(result.recommended.amountUsd, 0);
});

test("parseAmazonProductPrice reads priceToPay", () => {
  const html = `{"priceToPay":{"amount":27.99,"currency":"USD"}}`;
  assert.equal(parseAmazonProductPrice(html), 27.99);
});

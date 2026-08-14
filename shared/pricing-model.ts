/**
 * Competitive quote engine for resin print jobs.
 *
 * Real inputs:
 *   - slicer resin grams
 *   - current bottle cost (Amazon / manual)
 *   - Warhammer / Amazon listing price of the finished item you compete with
 *   - shipping (added on top of the final product price)
 *
 * Goal: undercut competitor product RRP while maximizing profit above a resin cost floor.
 * Shipping is a pass-through add-on — not part of the margin / undercut math.
 */

export interface PricingInputs {
  /** Resin used in grams (from slicer / CTB) per unit. */
  resinMassG: number;
  resinVolumeMl: number;
  /** How many units this quote covers. */
  quantity: number;
  /** Bottle economics (live Amazon resin or manual). */
  bottlePriceUsd: number;
  bottleMassG: number;
  bottleVolumeMl: number | null;
  /** Competitor RRP for the product you are making / competing with (per unit). */
  competitorPriceUsd: number;
  /** Undercut competitor by this fraction (0.05 = 5% cheaper). */
  undercutPercent: number;
  /** Optional flat extra undercut in dollars (added on top of %). */
  undercutExtraUsd: number;
  /** Shipping for the order — added on top of the final product price. */
  shippingUsd: number;
  /** Never recommend product price below this margin even to undercut. */
  minMargin: number;
  /** Soft target margin used when no competitor price is available. */
  targetMargin: number;
}

export interface CostBreakdown {
  materialUsd: number;
  /** Product cost only (resin). Shipping is separate. */
  costTotalUsd: number;
  costPerUnitUsd: number;
  shippingUsd: number;
  usdPerGram: number | null;
  usdPerMl: number | null;
  quantity: number;
}

export type QuoteStrategy =
  | "undercut_max_profit"
  | "cost_floor_blocked"
  | "no_competitor_target_margin";

export interface CompetitiveQuote {
  strategy: QuoteStrategy;
  amazonListingUsd: number | null;
  undercutPriceUsd: number | null;
  /** Product-only cost floor (no shipping). */
  costFloorUsd: number;
  minViableUsd: number;
  /** Product price before shipping. */
  recommendedProductUsd: number;
  recommendedProductPerUnitUsd: number;
  /** Product + shipping (what the customer pays). */
  recommendedUsd: number;
  recommendedPerUnitUsd: number;
  shippingUsd: number;
  savingsVsAmazonUsd: number | null;
  savingsVsAmazonPercent: number | null;
  /** Profit on product (shipping is pass-through). */
  grossProfitUsd: number;
  marginPercent: number;
  viable: boolean;
  message: string;
}

export interface QuoteTier {
  id: "floor" | "undercut" | "amazon" | "target";
  label: string;
  amountUsd: number;
  marginPercent: number;
  grossProfitUsd: number;
  rationale: string;
}

export interface PricingInsights {
  resinSharePercent: number;
  maxViableUndercutPercent: number | null;
  headroomVsAmazonUsd: number | null;
  amazonBeatsFloor: boolean | null;
}

export interface PricingResult {
  costs: CostBreakdown;
  competitive: CompetitiveQuote;
  insights: PricingInsights;
  tiers: QuoteTier[];
  recommended: QuoteTier;
  hubspotFields: {
    print_material_cost: number;
    print_labor_cost: number;
    print_packaging_cost: number;
    print_actual_shipping_cost: number;
    suggested_amount: number;
  };
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function amountForMargin(costTotal: number, margin: number): number {
  const m = clamp(margin, 0, 0.9);
  if (costTotal <= 0) return 0;
  return round2(costTotal / (1 - m));
}

export function marginForAmount(amount: number, costTotal: number): number {
  if (amount <= 0) return 0;
  return round2(((amount - costTotal) / amount) * 100);
}

export function normalizeQuantity(quantity: number): number {
  if (!Number.isFinite(quantity) || quantity < 1) return 1;
  return Math.min(10_000, Math.floor(quantity));
}

export function computeCosts(input: PricingInputs): CostBreakdown {
  const qty = normalizeQuantity(input.quantity);
  const bottleMass = input.bottleMassG > 0 ? input.bottleMassG : 1000;
  const usdPerGram =
    input.bottlePriceUsd > 0 && bottleMass > 0 ? input.bottlePriceUsd / bottleMass : null;

  const volume =
    input.bottleVolumeMl && input.bottleVolumeMl > 0
      ? input.bottleVolumeMl
      : bottleMass / 1.1;
  const usdPerMl =
    input.bottlePriceUsd > 0 && volume > 0 ? input.bottlePriceUsd / volume : null;

  let materialPerUnit = 0;
  if (input.resinMassG > 0 && usdPerGram !== null) {
    materialPerUnit = input.resinMassG * usdPerGram;
  } else if (input.resinVolumeMl > 0 && usdPerMl !== null) {
    materialPerUnit = input.resinVolumeMl * usdPerMl;
  }

  const materialUsd = materialPerUnit * qty;
  const shippingUsd = Math.max(0, input.shippingUsd);
  const costTotalUsd = materialUsd;

  return {
    materialUsd: round2(materialUsd),
    costTotalUsd: round2(costTotalUsd),
    costPerUnitUsd: round2(costTotalUsd / qty),
    shippingUsd: round2(shippingUsd),
    usdPerGram: usdPerGram === null ? null : round2(usdPerGram * 1000) / 1000,
    usdPerMl: usdPerMl === null ? null : round2(usdPerMl * 1000) / 1000,
    quantity: qty,
  };
}

/**
 * Highest product price that still undercuts competitor RRP, without going below min-margin floor.
 * Shipping is added afterward on the final customer total.
 */
export function computeCompetitiveQuote(
  input: PricingInputs,
  costs: CostBreakdown,
): CompetitiveQuote {
  const qty = costs.quantity;
  const shippingUsd = costs.shippingUsd;
  const minViableUsd = amountForMargin(costs.costTotalUsd, input.minMargin);
  const amazonUnit = input.competitorPriceUsd > 0 ? round2(input.competitorPriceUsd) : null;
  const amazon = amazonUnit === null ? null : round2(amazonUnit * qty);

  const withShipping = (productUsd: number) => ({
    recommendedProductUsd: productUsd,
    recommendedProductPerUnitUsd: round2(productUsd / qty),
    recommendedUsd: round2(productUsd + shippingUsd),
    recommendedPerUnitUsd: round2(productUsd / qty + shippingUsd / qty),
    shippingUsd,
  });

  if (amazon === null || amazonUnit === null) {
    const productUsd = amountForMargin(costs.costTotalUsd, input.targetMargin);
    const ship = withShipping(productUsd);
    return {
      strategy: "no_competitor_target_margin",
      amazonListingUsd: null,
      undercutPriceUsd: null,
      costFloorUsd: costs.costTotalUsd,
      minViableUsd,
      ...ship,
      savingsVsAmazonUsd: null,
      savingsVsAmazonPercent: null,
      grossProfitUsd: round2(productUsd - costs.costTotalUsd),
      marginPercent: marginForAmount(productUsd, costs.costTotalUsd),
      viable: productUsd >= minViableUsd,
      message:
        "No competitor RRP yet — using target margin on resin cost. Pick a Warhammer kit or paste an ASIN. Shipping is added on top.",
    };
  }

  const undercutPct = clamp(input.undercutPercent, 0, 0.5);
  const undercutExtra = Math.max(0, input.undercutExtraUsd);
  const undercutUnit = round2(amazonUnit * (1 - undercutPct) - undercutExtra);
  const undercutPriceUsd = round2(undercutUnit * qty);

  if (undercutPriceUsd < minViableUsd) {
    const ship = withShipping(minViableUsd);
    return {
      strategy: "cost_floor_blocked",
      amazonListingUsd: amazon,
      undercutPriceUsd,
      costFloorUsd: costs.costTotalUsd,
      minViableUsd,
      ...ship,
      savingsVsAmazonUsd: round2(amazon - minViableUsd),
      savingsVsAmazonPercent: round2(((amazon - minViableUsd) / amazon) * 100),
      grossProfitUsd: round2(minViableUsd - costs.costTotalUsd),
      marginPercent: marginForAmount(minViableUsd, costs.costTotalUsd),
      viable: false,
      message: `Undercut ($${undercutPriceUsd.toFixed(2)} product) is below your min-margin floor ($${minViableUsd.toFixed(2)}). Quote the floor + shipping ($${shippingUsd.toFixed(2)}) or skip.`,
    };
  }

  const ship = withShipping(undercutPriceUsd);
  return {
    strategy: "undercut_max_profit",
    amazonListingUsd: amazon,
    undercutPriceUsd,
    costFloorUsd: costs.costTotalUsd,
    minViableUsd,
    ...ship,
    savingsVsAmazonUsd: round2(amazon - undercutPriceUsd),
    savingsVsAmazonPercent: round2(((amazon - undercutPriceUsd) / amazon) * 100),
    grossProfitUsd: round2(undercutPriceUsd - costs.costTotalUsd),
    marginPercent: marginForAmount(undercutPriceUsd, costs.costTotalUsd),
    viable: true,
    message: `Best profit while undercutting by ${round2(undercutPct * 100)}%${undercutExtra > 0 ? ` + $${undercutExtra.toFixed(2)}/unit` : ""} · ${qty} unit${qty === 1 ? "" : "s"} · + $${shippingUsd.toFixed(2)} shipping.`,
  };
}

export function computeInsights(
  _input: PricingInputs,
  costs: CostBreakdown,
  competitive: CompetitiveQuote,
): PricingInsights {
  const resinSharePercent =
    costs.costTotalUsd > 0 ? round2((costs.materialUsd / costs.costTotalUsd) * 100) : 0;

  let maxViableUndercutPercent: number | null = null;
  let amazonBeatsFloor: boolean | null = null;
  let headroomVsAmazonUsd: number | null = null;

  if (competitive.amazonListingUsd !== null && competitive.amazonListingUsd > 0) {
    amazonBeatsFloor = competitive.amazonListingUsd >= competitive.minViableUsd;
    headroomVsAmazonUsd = round2(
      competitive.amazonListingUsd - competitive.recommendedProductUsd,
    );
    const raw = 1 - competitive.minViableUsd / competitive.amazonListingUsd;
    maxViableUndercutPercent = round2(clamp(raw, 0, 0.9) * 100);
  }

  return {
    resinSharePercent,
    maxViableUndercutPercent,
    headroomVsAmazonUsd,
    amazonBeatsFloor,
  };
}

function tier(
  id: QuoteTier["id"],
  label: string,
  amountUsd: number,
  costTotal: number,
  rationale: string,
): QuoteTier {
  return {
    id,
    label,
    amountUsd,
    marginPercent: marginForAmount(amountUsd, costTotal),
    grossProfitUsd: round2(amountUsd - costTotal),
    rationale,
  };
}

export function generatePricing(input: PricingInputs): PricingResult {
  const costs = computeCosts(input);
  const competitive = computeCompetitiveQuote(input, costs);
  const insights = computeInsights(input, costs, competitive);

  const tiers: QuoteTier[] = [
    tier(
      "floor",
      "Cost floor",
      competitive.minViableUsd,
      costs.costTotalUsd,
      `Min viable product price at ${round2(input.minMargin * 100)}% margin — never go below.`,
    ),
  ];

  if (competitive.undercutPriceUsd !== null) {
    tiers.push(
      tier(
        "undercut",
        "Undercut",
        competitive.undercutPriceUsd,
        costs.costTotalUsd,
        "Competitor RRP minus your undercut — max profit while still cheaper (before shipping).",
      ),
    );
  }

  if (competitive.amazonListingUsd !== null) {
    tiers.push(
      tier(
        "amazon",
        "Competitor RRP",
        competitive.amazonListingUsd,
        costs.costTotalUsd,
        "Warhammer / Amazon list price (scaled by quantity), before your shipping add-on.",
      ),
    );
  } else {
    tiers.push(
      tier(
        "target",
        "Target margin",
        amountForMargin(costs.costTotalUsd, input.targetMargin),
        costs.costTotalUsd,
        "Fallback when no competitor RRP is set.",
      ),
    );
  }

  const recommended =
    tiers.find((t) =>
      competitive.strategy === "undercut_max_profit"
        ? t.id === "undercut"
        : competitive.strategy === "cost_floor_blocked"
          ? t.id === "floor"
          : t.id === "target" || t.id === "floor",
    ) ?? tiers[0];

  const recommendedTier: QuoteTier = {
    ...recommended,
    amountUsd: competitive.recommendedUsd,
    marginPercent: competitive.marginPercent,
    grossProfitUsd: competitive.grossProfitUsd,
  };

  return {
    costs,
    competitive,
    insights,
    tiers,
    recommended: recommendedTier,
    hubspotFields: {
      print_material_cost: costs.materialUsd,
      print_labor_cost: 0,
      print_packaging_cost: 0,
      print_actual_shipping_cost: costs.shippingUsd,
      suggested_amount: competitive.recommendedUsd,
    },
  };
}

export const DEFAULT_INPUTS: PricingInputs = {
  resinMassG: 85,
  resinVolumeMl: 0,
  quantity: 1,
  bottlePriceUsd: 28,
  bottleMassG: 1000,
  bottleVolumeMl: null,
  competitorPriceUsd: 0,
  undercutPercent: 0.05,
  undercutExtraUsd: 0,
  shippingUsd: 8,
  minMargin: 0.25,
  targetMargin: 0.4,
};

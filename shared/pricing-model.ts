/**
 * Competitive quote engine for resin print jobs.
 *
 * Real inputs:
 *   - slicer resin grams
 *   - current bottle cost (Amazon / manual)
 *   - Amazon listing price of the finished item you compete with
 *
 * Goal: undercut Amazon while maximizing profit above a cost floor.
 */

export interface PricingInputs {
  /** Resin used in grams (from slicer / CTB). */
  resinMassG: number;
  resinVolumeMl: number;
  /** Bottle economics (live Amazon resin or manual). */
  bottlePriceUsd: number;
  bottleMassG: number;
  bottleVolumeMl: number | null;
  /** Amazon listing price for the product you are making / competing with. */
  competitorPriceUsd: number;
  /** Undercut Amazon by this fraction (0.05 = 5% cheaper). */
  undercutPercent: number;
  /** Optional flat extra undercut in dollars (added on top of %). */
  undercutExtraUsd: number;
  laborMinutes: number;
  laborRatePerHour: number;
  printHours: number;
  machineRatePerHour: number;
  packagingUsd: number;
  shippingUsd: number;
  failureRate: number;
  /** Never recommend below this margin even to undercut. */
  minMargin: number;
  /** Soft target margin used when no competitor price is available. */
  targetMargin: number;
}

export interface CostBreakdown {
  materialUsd: number;
  laborUsd: number;
  machineUsd: number;
  failureBufferUsd: number;
  packagingUsd: number;
  shippingUsd: number;
  costTotalUsd: number;
  usdPerGram: number | null;
  usdPerMl: number | null;
}

export type QuoteStrategy =
  | "undercut_max_profit"
  | "cost_floor_blocked"
  | "no_competitor_target_margin";

export interface CompetitiveQuote {
  strategy: QuoteStrategy;
  amazonListingUsd: number | null;
  undercutPriceUsd: number | null;
  costFloorUsd: number;
  minViableUsd: number;
  recommendedUsd: number;
  savingsVsAmazonUsd: number | null;
  savingsVsAmazonPercent: number | null;
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

export interface PricingResult {
  costs: CostBreakdown;
  competitive: CompetitiveQuote;
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

export function computeCosts(input: PricingInputs): CostBreakdown {
  const bottleMass = input.bottleMassG > 0 ? input.bottleMassG : 1000;
  const usdPerGram =
    input.bottlePriceUsd > 0 && bottleMass > 0 ? input.bottlePriceUsd / bottleMass : null;

  const volume =
    input.bottleVolumeMl && input.bottleVolumeMl > 0
      ? input.bottleVolumeMl
      : bottleMass / 1.1;
  const usdPerMl =
    input.bottlePriceUsd > 0 && volume > 0 ? input.bottlePriceUsd / volume : null;

  let materialUsd = 0;
  if (input.resinMassG > 0 && usdPerGram !== null) {
    materialUsd = input.resinMassG * usdPerGram;
  } else if (input.resinVolumeMl > 0 && usdPerMl !== null) {
    materialUsd = input.resinVolumeMl * usdPerMl;
  }

  const laborUsd = (Math.max(0, input.laborMinutes) / 60) * Math.max(0, input.laborRatePerHour);
  const machineUsd = Math.max(0, input.printHours) * Math.max(0, input.machineRatePerHour);
  const failureBufferUsd = (materialUsd + machineUsd) * clamp(input.failureRate, 0, 1);
  const packagingUsd = Math.max(0, input.packagingUsd);
  const shippingUsd = Math.max(0, input.shippingUsd);
  const costTotalUsd =
    materialUsd + laborUsd + machineUsd + failureBufferUsd + packagingUsd + shippingUsd;

  return {
    materialUsd: round2(materialUsd),
    laborUsd: round2(laborUsd),
    machineUsd: round2(machineUsd),
    failureBufferUsd: round2(failureBufferUsd),
    packagingUsd: round2(packagingUsd),
    shippingUsd: round2(shippingUsd),
    costTotalUsd: round2(costTotalUsd),
    usdPerGram: usdPerGram === null ? null : round2(usdPerGram * 1000) / 1000,
    usdPerMl: usdPerMl === null ? null : round2(usdPerMl * 1000) / 1000,
  };
}

/**
 * Highest price that still undercuts Amazon, without going below min-margin floor.
 * That maximizes profit among undercutting prices.
 */
export function computeCompetitiveQuote(
  input: PricingInputs,
  costs: CostBreakdown,
): CompetitiveQuote {
  const minViableUsd = amountForMargin(costs.costTotalUsd, input.minMargin);
  const amazon = input.competitorPriceUsd > 0 ? round2(input.competitorPriceUsd) : null;

  if (amazon === null) {
    const recommendedUsd = amountForMargin(costs.costTotalUsd, input.targetMargin);
    return {
      strategy: "no_competitor_target_margin",
      amazonListingUsd: null,
      undercutPriceUsd: null,
      costFloorUsd: costs.costTotalUsd,
      minViableUsd,
      recommendedUsd,
      savingsVsAmazonUsd: null,
      savingsVsAmazonPercent: null,
      grossProfitUsd: round2(recommendedUsd - costs.costTotalUsd),
      marginPercent: marginForAmount(recommendedUsd, costs.costTotalUsd),
      viable: recommendedUsd >= minViableUsd,
      message:
        "No Amazon product price yet — using target margin. Paste a competitor ASIN to undercut.",
    };
  }

  const undercutPct = clamp(input.undercutPercent, 0, 0.5);
  const undercutExtra = Math.max(0, input.undercutExtraUsd);
  // Max profit while undercutting = price just under Amazon by the chosen undercut.
  const undercutPriceUsd = round2(amazon * (1 - undercutPct) - undercutExtra);

  if (undercutPriceUsd < minViableUsd) {
    return {
      strategy: "cost_floor_blocked",
      amazonListingUsd: amazon,
      undercutPriceUsd,
      costFloorUsd: costs.costTotalUsd,
      minViableUsd,
      recommendedUsd: minViableUsd,
      savingsVsAmazonUsd: round2(amazon - minViableUsd),
      savingsVsAmazonPercent: round2(((amazon - minViableUsd) / amazon) * 100),
      grossProfitUsd: round2(minViableUsd - costs.costTotalUsd),
      marginPercent: marginForAmount(minViableUsd, costs.costTotalUsd),
      viable: false,
      message: `Undercut ($${undercutPriceUsd.toFixed(2)}) is below your min-margin floor ($${minViableUsd.toFixed(2)}). Do not match Amazon that low — quote the floor or skip the job.`,
    };
  }

  return {
    strategy: "undercut_max_profit",
    amazonListingUsd: amazon,
    undercutPriceUsd,
    costFloorUsd: costs.costTotalUsd,
    minViableUsd,
    recommendedUsd: undercutPriceUsd,
    savingsVsAmazonUsd: round2(amazon - undercutPriceUsd),
    savingsVsAmazonPercent: round2(((amazon - undercutPriceUsd) / amazon) * 100),
    grossProfitUsd: round2(undercutPriceUsd - costs.costTotalUsd),
    marginPercent: marginForAmount(undercutPriceUsd, costs.costTotalUsd),
    viable: true,
    message: `Best profit while undercutting Amazon by ${round2(undercutPct * 100)}%${undercutExtra > 0 ? ` + $${undercutExtra.toFixed(2)}` : ""}.`,
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

  const tiers: QuoteTier[] = [
    tier(
      "floor",
      "Cost floor",
      competitive.minViableUsd,
      costs.costTotalUsd,
      `Min viable at ${round2(input.minMargin * 100)}% margin — never go below.`,
    ),
  ];

  if (competitive.undercutPriceUsd !== null) {
    tiers.push(
      tier(
        "undercut",
        "Undercut",
        competitive.undercutPriceUsd,
        costs.costTotalUsd,
        "Amazon listing minus your undercut — max profit while still cheaper.",
      ),
    );
  }

  if (competitive.amazonListingUsd !== null) {
    tiers.push(
      tier(
        "amazon",
        "Amazon list",
        competitive.amazonListingUsd,
        costs.costTotalUsd,
        "Competitor Amazon buy-box / list price (do not exceed if you want to undercut).",
      ),
    );
  } else {
    tiers.push(
      tier(
        "target",
        "Target margin",
        amountForMargin(costs.costTotalUsd, input.targetMargin),
        costs.costTotalUsd,
        "Fallback when no Amazon product ASIN is set.",
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

  // Prefer explicit competitive recommendation amount on the chosen tier.
  const recommendedTier: QuoteTier = {
    ...recommended,
    amountUsd: competitive.recommendedUsd,
    marginPercent: competitive.marginPercent,
    grossProfitUsd: competitive.grossProfitUsd,
  };

  const hubspotLabor = round2(costs.laborUsd + costs.machineUsd + costs.failureBufferUsd);

  return {
    costs,
    competitive,
    tiers,
    recommended: recommendedTier,
    hubspotFields: {
      print_material_cost: costs.materialUsd,
      print_labor_cost: hubspotLabor,
      print_packaging_cost: costs.packagingUsd,
      print_actual_shipping_cost: costs.shippingUsd,
      suggested_amount: competitive.recommendedUsd,
    },
  };
}

export const DEFAULT_INPUTS: PricingInputs = {
  resinMassG: 85,
  resinVolumeMl: 0,
  bottlePriceUsd: 28,
  bottleMassG: 1000,
  bottleVolumeMl: null,
  competitorPriceUsd: 0,
  undercutPercent: 0.05,
  undercutExtraUsd: 0,
  laborMinutes: 45,
  laborRatePerHour: 35,
  printHours: 6,
  machineRatePerHour: 2.5,
  packagingUsd: 4,
  shippingUsd: 8,
  failureRate: 0.08,
  minMargin: 0.25,
  targetMargin: 0.4,
};

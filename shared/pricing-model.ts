/**
 * Quote pricing matrix for resin print jobs.
 *
 * Aligns with Print Operations profit math:
 *   gross = amount - material - labor - packaging - shipping
 *   margin% = (gross / amount) * 100
 *
 * Machine time is rolled into labor for HubSpot fields, but tracked
 * separately here so quotes reflect printer amortization.
 */

export interface PricingInputs {
  /** Resin used in grams (from slicer / CTB). */
  resinMassG: number;
  /** Optional volume; used when mass is 0 and $/ml is known. */
  resinVolumeMl: number;
  /** Live or manual bottle economics. */
  bottlePriceUsd: number;
  bottleMassG: number;
  bottleVolumeMl: number | null;
  /** Pure hands-on minutes (post-process, packing, QA). */
  laborMinutes: number;
  laborRatePerHour: number;
  /** Machine print hours (amortization + electricity proxy). */
  printHours: number;
  machineRatePerHour: number;
  packagingUsd: number;
  shippingUsd: number;
  /** Extra material+machine buffer for failed plates (0–1). */
  failureRate: number;
  /** Target / stretch margin fractions (0–1). */
  targetMargin: number;
  stretchMargin: number;
  floorMargin: number;
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

export interface QuoteTier {
  id: "floor" | "target" | "stretch";
  label: string;
  amountUsd: number;
  marginPercent: number;
  grossProfitUsd: number;
  rationale: string;
}

export interface MarketBand {
  id: string;
  label: string;
  lowUsd: number;
  highUsd: number;
  basis: string;
}

export interface PricingResult {
  costs: CostBreakdown;
  tiers: QuoteTier[];
  recommended: QuoteTier;
  marketBands: MarketBand[];
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
  const failureBufferUsd =
    (materialUsd + machineUsd) * clamp(input.failureRate, 0, 1);
  const packagingUsd = Math.max(0, input.packagingUsd);
  const shippingUsd = Math.max(0, input.shippingUsd);
  const costTotalUsd = materialUsd + laborUsd + machineUsd + failureBufferUsd + packagingUsd + shippingUsd;

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

export function marketBandsForJob(input: PricingInputs, costs: CostBreakdown): MarketBand[] {
  const mass = input.resinMassG > 0 ? input.resinMassG : input.resinVolumeMl * 1.1;
  const hours = Math.max(input.printHours, 0.25);

  // Published hobby/mini resin commission bands (USD), used as external anchors.
  const perGramLow = mass * 0.12;
  const perGramHigh = mass * 0.45;
  const perHourLow = hours * 8;
  const perHourHigh = hours * 25;

  return [
    {
      id: "per_gram",
      label: "Market · resin mass",
      lowUsd: round2(perGramLow + costs.packagingUsd + costs.shippingUsd),
      highUsd: round2(perGramHigh + costs.packagingUsd + costs.shippingUsd),
      basis: "$0.12–$0.45 / g resin (commission-shop ranges) + pack/ship",
    },
    {
      id: "per_hour",
      label: "Market · machine time",
      lowUsd: round2(perHourLow + costs.materialUsd + costs.packagingUsd + costs.shippingUsd),
      highUsd: round2(perHourHigh + costs.materialUsd + costs.packagingUsd + costs.shippingUsd),
      basis: "$8–$25 / print-hour + material + pack/ship",
    },
  ];
}

export function generatePricing(input: PricingInputs): PricingResult {
  const costs = computeCosts(input);
  const floorM = clamp(input.floorMargin, 0, 0.9);
  const targetM = clamp(input.targetMargin, 0, 0.9);
  const stretchM = clamp(input.stretchMargin, 0, 0.9);

  const tiers: QuoteTier[] = (
    [
      {
        id: "floor" as const,
        label: "Floor",
        amountUsd: amountForMargin(costs.costTotalUsd, floorM),
        marginPercent: round2(floorM * 100),
        grossProfitUsd: 0,
        rationale: "Minimum sustainable quote — covers costs with a thin buffer.",
      },
      {
        id: "target" as const,
        label: "Target",
        amountUsd: amountForMargin(costs.costTotalUsd, targetM),
        marginPercent: round2(targetM * 100),
        grossProfitUsd: 0,
        rationale: "Matches Print Operations healthy-margin target (default 40%).",
      },
      {
        id: "stretch" as const,
        label: "Stretch",
        amountUsd: amountForMargin(costs.costTotalUsd, stretchM),
        marginPercent: round2(stretchM * 100),
        grossProfitUsd: 0,
        rationale: "Premium / rush / complex geometry pricing.",
      },
    ] satisfies QuoteTier[]
  ).map((tier) => ({
    ...tier,
    grossProfitUsd: round2(tier.amountUsd - costs.costTotalUsd),
  }));

  const recommended = tiers.find((t) => t.id === "target") ?? tiers[1];
  const bands = marketBandsForJob(input, costs);

  // HubSpot labor field absorbs machine time so existing profit calc stays unchanged.
  const hubspotLabor = round2(costs.laborUsd + costs.machineUsd + costs.failureBufferUsd);

  return {
    costs,
    tiers,
    recommended,
    marketBands: bands,
    hubspotFields: {
      print_material_cost: costs.materialUsd,
      print_labor_cost: hubspotLabor,
      print_packaging_cost: costs.packagingUsd,
      print_actual_shipping_cost: costs.shippingUsd,
      suggested_amount: recommended.amountUsd,
    },
  };
}

export const DEFAULT_INPUTS: PricingInputs = {
  resinMassG: 85,
  resinVolumeMl: 0,
  bottlePriceUsd: 28,
  bottleMassG: 1000,
  bottleVolumeMl: null,
  laborMinutes: 45,
  laborRatePerHour: 35,
  printHours: 6,
  machineRatePerHour: 2.5,
  packagingUsd: 4,
  shippingUsd: 8,
  failureRate: 0.08,
  floorMargin: 0.25,
  targetMargin: 0.4,
  stretchMargin: 0.55,
};

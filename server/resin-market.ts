import { round2 } from "../shared/pricing-model.js";

export const DEFAULT_RESIN_NAME = "ELEGOO ABS-Like 3.0 Space Grey";
export const DEFAULT_RESIN_ASIN = "B0D6Y6JV42";
export const DEFAULT_BOTTLE_MASS_G = 1000;
export const AMAZON_FETCH_TIMEOUT_MS = 10_000;
export const AMAZON_PRICE_CACHE_MS = 6 * 60 * 60 * 1000;

export interface MarketResinPrice {
  asin: string;
  name: string;
  bottlePriceUsd: number;
  bottleMassG: number;
  source: "amazon" | "manual" | "fallback";
  fetchedAt: string | null;
  cached: boolean;
  url: string;
  warning?: string;
}

let cache: {
  price: number;
  fetchedAtMs: number;
  asin: string;
} | null = null;

export function parseAmazonProductPrice(html: string): number | null {
  const priceToPay = html.match(/"priceToPay"\s*:\s*\{[^}]*"amount"\s*:\s*([0-9]+(?:\.[0-9]+)?)/i);
  if (priceToPay) {
    const amount = Number(priceToPay[1]);
    if (Number.isFinite(amount) && amount > 0 && amount < 10_000) return round2(amount);
  }

  const display = html.match(/"displayPrice"\s*:\s*"\$?([0-9]+(?:\.[0-9]+)?)"/i);
  if (display) {
    const amount = Number(display[1]);
    if (Number.isFinite(amount) && amount > 0 && amount < 10_000) return round2(amount);
  }

  const coreIdx = html.search(/corePriceDisplay_desktop|corePrice_feature_div|priceToPay/i);
  if (coreIdx >= 0) {
    const window = html.slice(coreIdx, coreIdx + 2_500);
    const offscreen = window.match(/a-offscreen[^>]*>\s*\$([0-9]+(?:\.[0-9]+)?)/i);
    if (offscreen) {
      const amount = Number(offscreen[1]);
      if (Number.isFinite(amount) && amount > 0 && amount < 10_000) return round2(amount);
    }
  }

  return null;
}

export async function fetchAmazonResinPrice(options?: {
  asin?: string;
  fetchImpl?: typeof fetch;
  force?: boolean;
}): Promise<MarketResinPrice> {
  const asin = (options?.asin ?? DEFAULT_RESIN_ASIN).trim().toUpperCase();
  const url = `https://www.amazon.com/dp/${asin}`;
  const fetchImpl = options?.fetchImpl ?? fetch;
  const now = Date.now();

  if (
    !options?.force &&
    cache &&
    cache.asin === asin &&
    now - cache.fetchedAtMs < AMAZON_PRICE_CACHE_MS
  ) {
    return {
      asin,
      name: DEFAULT_RESIN_NAME,
      bottlePriceUsd: cache.price,
      bottleMassG: DEFAULT_BOTTLE_MASS_G,
      source: "amazon",
      fetchedAt: new Date(cache.fetchedAtMs).toISOString(),
      cached: true,
      url,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AMAZON_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent":
          "Mozilla/5.0 (compatible; TabletopPricingMatrix/1.0; +https://github.com/usercondition/TabletopPricingMatrix)",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) {
      throw new Error(`Amazon returned HTTP ${response.status}`);
    }
    const html = await response.text();
    if (/enter the characters you see|robot check|api-services-support@amazon\.com/i.test(html)) {
      throw new Error("Amazon blocked the live price request");
    }
    const price = parseAmazonProductPrice(html);
    if (price === null) {
      throw new Error("Could not parse Amazon buy-box price");
    }
    cache = { price, fetchedAtMs: now, asin };
    return {
      asin,
      name: DEFAULT_RESIN_NAME,
      bottlePriceUsd: price,
      bottleMassG: DEFAULT_BOTTLE_MASS_G,
      source: "amazon",
      fetchedAt: new Date(now).toISOString(),
      cached: false,
      url,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Amazon fetch failed";
    const fallback = cache?.asin === asin ? cache.price : 28;
    return {
      asin,
      name: DEFAULT_RESIN_NAME,
      bottlePriceUsd: fallback,
      bottleMassG: DEFAULT_BOTTLE_MASS_G,
      source: cache?.asin === asin ? "amazon" : "fallback",
      fetchedAt: cache?.asin === asin ? new Date(cache.fetchedAtMs).toISOString() : null,
      cached: Boolean(cache?.asin === asin),
      url,
      warning: `${message}. Using ${cache?.asin === asin ? "cached" : "fallback"} bottle price $${fallback.toFixed(2)}.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

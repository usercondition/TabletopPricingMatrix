import { round2 } from "../shared/pricing-model.js";

export const DEFAULT_RESIN_NAME = "ELEGOO ABS-Like 3.0 Space Grey";
export const DEFAULT_RESIN_ASIN = "B0D6Y6JV42";
export const DEFAULT_BOTTLE_MASS_G = 1000;
export const AMAZON_FETCH_TIMEOUT_MS = 10_000;
export const AMAZON_PRICE_CACHE_MS = 6 * 60 * 60 * 1000;

export interface AmazonListingPrice {
  asin: string;
  title: string | null;
  priceUsd: number | null;
  source: "amazon" | "manual" | "fallback" | "unavailable";
  fetchedAt: string | null;
  cached: boolean;
  url: string;
  warning?: string;
}

type CacheEntry = { price: number; title: string | null; fetchedAtMs: number };
const cache = new Map<string, CacheEntry>();

export function parseAsin(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  const fromUrl = raw.match(/(?:dp|gp\/product|asin)\/([A-Z0-9]{10})/i);
  if (fromUrl) return fromUrl[1].toUpperCase();
  const bare = raw.match(/\b([A-Z0-9]{10})\b/i);
  if (bare && /^[A-Z0-9]{10}$/i.test(bare[1])) return bare[1].toUpperCase();
  return null;
}

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

export function parseAmazonProductTitle(html: string): string | null {
  const meta = html.match(/id="productTitle"[^>]*>\s*([^<]+)\s*</i);
  if (meta) return meta[1].replace(/\s+/g, " ").trim().slice(0, 160) || null;
  const og = html.match(/property="og:title"\s+content="([^"]+)"/i);
  if (og) return og[1].replace(/\s+/g, " ").trim().slice(0, 160) || null;
  return null;
}

export async function fetchAmazonListing(options: {
  asinOrUrl: string;
  fetchImpl?: typeof fetch;
  force?: boolean;
  fallbackPrice?: number;
  label?: string;
}): Promise<AmazonListingPrice> {
  const asin = parseAsin(options.asinOrUrl);
  const url = asin ? `https://www.amazon.com/dp/${asin}` : options.asinOrUrl.trim();
  if (!asin) {
    return {
      asin: "",
      title: null,
      priceUsd: options.fallbackPrice ?? null,
      source: "unavailable",
      fetchedAt: null,
      cached: false,
      url,
      warning: "Enter a valid Amazon ASIN or product URL.",
    };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const now = Date.now();
  const hit = cache.get(asin);
  if (!options.force && hit && now - hit.fetchedAtMs < AMAZON_PRICE_CACHE_MS) {
    return {
      asin,
      title: hit.title,
      priceUsd: hit.price,
      source: "amazon",
      fetchedAt: new Date(hit.fetchedAtMs).toISOString(),
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
    if (!response.ok) throw new Error(`Amazon returned HTTP ${response.status}`);
    const html = await response.text();
    if (/enter the characters you see|robot check|api-services-support@amazon\.com/i.test(html)) {
      throw new Error("Amazon blocked the live price request");
    }
    const price = parseAmazonProductPrice(html);
    if (price === null) throw new Error("Could not parse Amazon buy-box price");
    const title = parseAmazonProductTitle(html);
    cache.set(asin, { price, title, fetchedAtMs: now });
    return {
      asin,
      title,
      priceUsd: price,
      source: "amazon",
      fetchedAt: new Date(now).toISOString(),
      cached: false,
      url,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Amazon fetch failed";
    if (hit) {
      return {
        asin,
        title: hit.title,
        priceUsd: hit.price,
        source: "amazon",
        fetchedAt: new Date(hit.fetchedAtMs).toISOString(),
        cached: true,
        url,
        warning: `${message}. Using cached $${hit.price.toFixed(2)}.`,
      };
    }
    const fallback = options.fallbackPrice;
    return {
      asin,
      title: options.label ?? null,
      priceUsd: fallback ?? null,
      source: fallback !== undefined ? "fallback" : "unavailable",
      fetchedAt: null,
      cached: false,
      url,
      warning:
        fallback !== undefined
          ? `${message}. Using fallback $${fallback.toFixed(2)}.`
          : `${message}. Enter the Amazon price manually.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAmazonResinPrice(options?: {
  asin?: string;
  fetchImpl?: typeof fetch;
  force?: boolean;
}): Promise<{
  asin: string;
  name: string;
  bottlePriceUsd: number;
  bottleMassG: number;
  source: AmazonListingPrice["source"];
  fetchedAt: string | null;
  cached: boolean;
  url: string;
  warning?: string;
}> {
  const listing = await fetchAmazonListing({
    asinOrUrl: options?.asin ?? DEFAULT_RESIN_ASIN,
    fetchImpl: options?.fetchImpl,
    force: options?.force,
    fallbackPrice: 28,
    label: DEFAULT_RESIN_NAME,
  });
  return {
    asin: listing.asin || DEFAULT_RESIN_ASIN,
    name: listing.title || DEFAULT_RESIN_NAME,
    bottlePriceUsd: listing.priceUsd ?? 28,
    bottleMassG: DEFAULT_BOTTLE_MASS_G,
    source: listing.source,
    fetchedAt: listing.fetchedAt,
    cached: listing.cached,
    url: listing.url,
    warning: listing.warning,
  };
}

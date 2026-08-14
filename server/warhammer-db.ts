import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "warhammer");
const DB_PATH = process.env.WARHAMMER_DB_FILE || path.join(DATA_DIR, "catalog.db");
const SEED_PATH = path.join(DATA_DIR, "seed.json");

export interface WarhammerUnit {
  id: string;
  name: string;
  faction: string;
  game: string;
  sku: string | null;
  productUrl: string | null;
  amazonAsin: string | null;
  gwPriceUsd: number;
  gwPriceGbp: number | null;
  modelCount: number | null;
  notes: string | null;
  source: string;
  priceUpdatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WarhammerSeedRow {
  id: string;
  name: string;
  faction: string;
  game?: string;
  sku?: string | null;
  productUrl?: string | null;
  amazonAsin?: string | null;
  gwPriceUsd: number;
  gwPriceGbp?: number | null;
  modelCount?: number | null;
  notes?: string | null;
  source?: string;
}

let db: Database.Database | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

export function getWarhammerDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      faction TEXT NOT NULL,
      game TEXT NOT NULL DEFAULT '40k',
      sku TEXT,
      product_url TEXT,
      amazon_asin TEXT,
      gw_price_usd REAL NOT NULL,
      gw_price_gbp REAL,
      model_count INTEGER,
      notes TEXT,
      source TEXT NOT NULL DEFAULT 'seed_rrp_usd',
      price_updated_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_units_name ON units(name);
    CREATE INDEX IF NOT EXISTS idx_units_faction ON units(faction);
    CREATE INDEX IF NOT EXISTS idx_units_game ON units(game);
    CREATE INDEX IF NOT EXISTS idx_units_sku ON units(sku);
  `);
  return db;
}

function mapRow(row: Record<string, unknown>): WarhammerUnit {
  return {
    id: String(row.id),
    name: String(row.name),
    faction: String(row.faction),
    game: String(row.game),
    sku: row.sku == null ? null : String(row.sku),
    productUrl: row.product_url == null ? null : String(row.product_url),
    amazonAsin: row.amazon_asin == null ? null : String(row.amazon_asin),
    gwPriceUsd: Number(row.gw_price_usd),
    gwPriceGbp: row.gw_price_gbp == null ? null : Number(row.gw_price_gbp),
    modelCount: row.model_count == null ? null : Number(row.model_count),
    notes: row.notes == null ? null : String(row.notes),
    source: String(row.source),
    priceUpdatedAt: row.price_updated_at == null ? null : String(row.price_updated_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function upsertUnits(rows: WarhammerSeedRow[]): number {
  const database = getWarhammerDb();
  const stamp = nowIso();
  const stmt = database.prepare(`
    INSERT INTO units (
      id, name, faction, game, sku, product_url, amazon_asin,
      gw_price_usd, gw_price_gbp, model_count, notes, source,
      price_updated_at, created_at, updated_at
    ) VALUES (
      @id, @name, @faction, @game, @sku, @productUrl, @amazonAsin,
      @gwPriceUsd, @gwPriceGbp, @modelCount, @notes, @source,
      @priceUpdatedAt, @createdAt, @updatedAt
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      faction = excluded.faction,
      game = excluded.game,
      sku = excluded.sku,
      product_url = excluded.product_url,
      amazon_asin = excluded.amazon_asin,
      gw_price_usd = excluded.gw_price_usd,
      gw_price_gbp = excluded.gw_price_gbp,
      model_count = excluded.model_count,
      notes = excluded.notes,
      source = excluded.source,
      price_updated_at = excluded.price_updated_at,
      updated_at = excluded.updated_at
  `);

  const tx = database.transaction((items: WarhammerSeedRow[]) => {
    let n = 0;
    for (const item of items) {
      stmt.run({
        id: item.id,
        name: item.name,
        faction: item.faction,
        game: item.game || "40k",
        sku: item.sku ?? null,
        productUrl: item.productUrl ?? null,
        amazonAsin: item.amazonAsin ?? null,
        gwPriceUsd: item.gwPriceUsd,
        gwPriceGbp: item.gwPriceGbp ?? null,
        modelCount: item.modelCount ?? null,
        notes: item.notes ?? null,
        source: item.source || "seed_rrp_usd",
        priceUpdatedAt: stamp,
        createdAt: stamp,
        updatedAt: stamp,
      });
      n += 1;
    }
    return n;
  });

  return tx(rows);
}

function countUnits(): number {
  const row = getWarhammerDb().prepare("SELECT COUNT(*) AS c FROM units").get() as
    | { c: number }
    | undefined;
  return Number(row?.c ?? 0);
}

export function seedWarhammerDb(force = false): { seeded: number; total: number; path: string } {
  getWarhammerDb();
  const count = countUnits();
  if (count > 0 && !force) {
    return { seeded: 0, total: count, path: DB_PATH };
  }
  if (!fs.existsSync(SEED_PATH)) {
    throw new Error(`Warhammer seed missing at ${SEED_PATH}`);
  }
  const raw = fs.readFileSync(SEED_PATH, "utf8");
  const rows = JSON.parse(raw) as WarhammerSeedRow[];
  const seeded = upsertUnits(rows);
  return { seeded, total: countUnits(), path: DB_PATH };
}

export function searchWarhammerUnits(query: string, limit = 25): WarhammerUnit[] {
  seedWarhammerDb(false);
  const database = getWarhammerDb();
  const q = query.trim().toLowerCase();
  const lim = Math.max(1, Math.min(100, limit));
  if (!q) {
    const rows = database
      .prepare(
        `SELECT * FROM units ORDER BY faction ASC, name ASC LIMIT ?`,
      )
      .all(lim) as Record<string, unknown>[];
    return rows.map(mapRow);
  }
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const rows = database
    .prepare(
      `SELECT * FROM units
       WHERE lower(name) LIKE ? OR lower(faction) LIKE ? OR lower(sku) LIKE ? OR lower(ifnull(notes,'')) LIKE ?
       ORDER BY
         CASE WHEN lower(name) LIKE ? THEN 0 ELSE 1 END,
         faction ASC, name ASC
       LIMIT ?`,
    )
    .all(like, like, like, like, `${q}%`, lim) as Record<string, unknown>[];
  return rows.map(mapRow);
}

export function getWarhammerUnit(id: string): WarhammerUnit | null {
  seedWarhammerDb(false);
  const row = getWarhammerDb().prepare(`SELECT * FROM units WHERE id = ?`).get(id) as
    | Record<string, unknown>
    | undefined;
  return row ? mapRow(row) : null;
}

export function listFactions(): Array<{ faction: string; count: number }> {
  seedWarhammerDb(false);
  return getWarhammerDb()
    .prepare(
      `SELECT faction, COUNT(*) AS count FROM units GROUP BY faction ORDER BY faction ASC`,
    )
    .all() as Array<{ faction: string; count: number }>;
}

export function warhammerStats(): {
  total: number;
  factions: number;
  path: string;
  disclaimer: string;
} {
  seedWarhammerDb(false);
  const total = countUnits();
  const factionsRow = getWarhammerDb()
    .prepare("SELECT COUNT(DISTINCT faction) AS c FROM units")
    .get() as { c: number } | undefined;
  const factions = Number(factionsRow?.c ?? 0);
  return {
    total,
    factions,
    path: DB_PATH,
    disclaimer:
      "Unofficial snapshot of published Games Workshop RRP-style USD prices for personal quoting. Not affiliated with Games Workshop. Verify against current store prices before selling.",
  };
}

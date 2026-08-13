import test from "node:test";
import assert from "node:assert/strict";
import {
  getWarhammerUnit,
  searchWarhammerUnits,
  seedWarhammerDb,
  warhammerStats,
} from "../server/warhammer-db.js";

test("warhammer seed loads units", () => {
  const seeded = seedWarhammerDb(true);
  assert.ok(seeded.total >= 100);
  const stats = warhammerStats();
  assert.equal(stats.total, seeded.total);
  assert.ok(stats.factions > 10);
});

test("warhammer search finds intercessors", () => {
  seedWarhammerDb(false);
  const hits = searchWarhammerUnits("intercessor", 10);
  assert.ok(hits.length >= 1);
  assert.ok(hits.some((u) => /intercessor/i.test(u.name)));
  assert.ok(hits[0].gwPriceUsd > 0);
});

test("warhammer get by id", () => {
  const unit = getWarhammerUnit("sm-intercessors");
  assert.ok(unit);
  assert.equal(unit.faction, "Space Marines");
  assert.ok(unit.gwPriceUsd >= 40);
});

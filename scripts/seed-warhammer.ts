import { seedWarhammerDb } from "../server/warhammer-db.js";

const result = seedWarhammerDb(true);
console.log(`Warhammer DB seeded: ${result.seeded} upserted, ${result.total} total @ ${result.path}`);

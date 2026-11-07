/**
 * export-data.js
 * --------------
 * Dump every collection from THIS machine's MongoDB into JSON files under
 * server/seed-data/. Commit those files to git so any other machine can rebuild
 * the same data with `npm run seed:import`.
 *
 * Types (ObjectId, Date, etc.) are preserved using Extended JSON (EJSON), so the
 * imported data is byte-for-byte the same as the source.
 *
 * Usage (PowerShell):
 *   cd C:\Project\LIS\server
 *   npm run seed:export
 *   npm run seed:export -- --only samples,petitions   # just a few collections
 *   npm run seed:export -- --source "mongodb://host:27017/LIS-DB"
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { EJSON } = require('bson');

function getArg(name) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1] && !process.argv[idx + 1].startsWith('--')) {
    return process.argv[idx + 1];
  }
  return undefined;
}

const SOURCE_URI = getArg('source') || process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';
const ONLY = (getArg('only') || '').split(',').map(s => s.trim()).filter(Boolean);
const OUT_DIR = path.join(__dirname, 'seed-data');

function dbNameFromUri(uri) {
  const m = uri.match(/\/([^/?]+)(\?|$)/);
  return m ? m[1] : null;
}

// collection ที่ไม่ต้อง export ลง seed-data/: เป็น log ล้วน กู้คืนไปก็ไม่มีประโยชน์
// แต่ auto-sync.ps1 จะ commit ไฟล์ใหม่ให้ทุกชั่วโมง (Node-RED ยิงนาทีละครั้ง)
// productionintegrationrequests = ข้อมูลฝากชั่วคราวจาก production หมดอายุเองใน 2 วัน
const SKIP_COLLECTIONS = ['apirequestlogs', 'productionintegrationrequests'];

// ONLY (จาก --only) ชนะ skip list เสมอ เผื่ออยากดัมพ์ log จริงๆ
function selectCollections(names, only = [], skip = SKIP_COLLECTIONS) {
  return names
    .filter((n) => !n.startsWith('system.'))
    .filter((n) => (only.length ? only.includes(n) : !skip.includes(n)));
}

async function main() {
  const dbName = dbNameFromUri(SOURCE_URI);
  if (!dbName) {
    console.error('❌ Could not read the database name from the source URI.');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  console.log('📤 Exporting MongoDB data to JSON');
  console.log(`   SOURCE: ${SOURCE_URI}`);
  console.log(`   OUT:    ${OUT_DIR}`);
  if (ONLY.length) console.log(`   ONLY:   ${ONLY.join(', ')}`);
  console.log('');

  const client = new MongoClient(SOURCE_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    await client.connect();
    const db = client.db(dbName);

    const cols = selectCollections(
      (await db.listCollections({ type: 'collection' }).toArray()).map((c) => c.name),
      ONLY,
    );

    const manifest = [];
    for (const name of cols) {
      const docs = await db.collection(name).find({}).toArray();
      const indexes = (await db.collection(name).indexes()).filter(ix => ix.name !== '_id_');
      const file = `${name}.json`;
      const payload = { collection: name, indexes, count: docs.length, documents: docs };
      // relaxed:false keeps full type fidelity ($oid, $date, ...)
      fs.writeFileSync(path.join(OUT_DIR, file), EJSON.stringify(payload, { relaxed: false }, 2));
      manifest.push({ collection: name, file, count: docs.length });
      console.log(`  ✅ ${name}: ${docs.length} doc(s) → seed-data/${file}`);
    }

    fs.writeFileSync(
      path.join(OUT_DIR, '_manifest.json'),
      JSON.stringify({ database: dbName, exportedCollections: manifest }, null, 2)
    );

    const totalDocs = manifest.reduce((s, m) => s + m.count, 0);
    console.log('');
    console.log(`🎉 Exported ${manifest.length} collection(s), ${totalDocs} document(s). Commit server/seed-data/ to git.`);
  } catch (err) {
    console.error('❌ Export failed:', err.message);
    process.exitCode = 1;
  } finally {
    await client.close().catch(() => {});
  }
}

// รันเฉพาะตอนถูกเรียกเป็น script — require จากเทสต้องไม่ไปต่อ MongoDB จริง
if (require.main === module) main();

module.exports = { SKIP_COLLECTIONS, selectCollections };

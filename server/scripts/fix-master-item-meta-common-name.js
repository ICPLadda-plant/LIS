// ซ่อม MasterItemMeta ที่ฟอร์ม "แก้ไข Item" รุ่นเก่าเขียนทับผิดช่อง:
//   - itemType ควรเป็น "ชื่อสามัญ" (แบบที่ Sync Kg/ลัง เขียน) แต่บางแถวกลายเป็นรหัสสูตร เช่น EC, GR, W/V
//   - description ควรเป็น "ขนาดบรรจุ" แต่บางแถวกลายเป็นชื่อสามัญ (ฟอร์มเติม item_name2 ไว้ในช่องรายละเอียด)
// ค่าที่ถูกต้องเอามาจาก ERP (common_name / item_name3) ของ item_no เดียวกัน
//
// Usage (จากโฟลเดอร์ server/):
//   node scripts/fix-master-item-meta-common-name.js          # dry-run: รายงานอย่างเดียว
//   node scripts/fix-master-item-meta-common-name.js --commit  # backup เอกสารเดิมเป็น JSON แล้วค่อยเขียน
'use strict';

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
const mongoose = require('mongoose');
const MasterItemMeta = require('../models/MasterItemMeta');

const COMMIT = process.argv.includes('--commit');
const URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/LIS-DB';
const WEBHOOK_URLS = [
  process.env.MASTER_ITEMS_WEBHOOK_URL || 'https://n8n-plant.icpladda.com/webhook/API/Item-production',
  process.env.MASTER_ITEMS_LDI_WEBHOOK_URL || 'https://n8n-plant.icpladda.com/webhook/api/item-product-ldi',
];
// ตรงกับ CLASSIFICATION_TYPES ใน routes/masterItems.js
const TYPE_CODES = new Set(['SG', 'ULV', 'EC', 'EW', 'SC', 'SL', 'ME', 'ZC', 'W/V', 'W/W', 'WP', 'WDG', 'WG', 'GR', 'ST', 'GB', 'SP', 'DS', 'DP']);

const text = (value) => String(value ?? '').trim();
const same = (a, b) => text(a).replace(/\s+/g, ' ').toUpperCase() === text(b).replace(/\s+/g, ' ').toUpperCase();

async function fetchErpItems() {
  const byItemNo = new Map();
  for (const url of WEBHOOK_URLS) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`ERP webhook ${url} ตอบ ${res.status}`);
    const payload = await res.json();
    const rows = Array.isArray(payload) ? payload : (payload.data || payload.items || payload.rows || []);
    for (const row of rows) {
      const itemNo = text(row.item_no).toUpperCase();
      if (itemNo && !byItemNo.has(itemNo)) byItemNo.set(itemNo, row);
    }
  }
  return byItemNo;
}

function planFix(meta, erp) {
  const update = {};
  const erpCommonName = text(erp?.common_name || erp?.item_name2);
  if (TYPE_CODES.has(text(meta.itemType).toUpperCase())) {
    update.itemType = erpCommonName;
  }
  const description = text(meta.description);
  if (description && (same(description, erpCommonName) || same(description, meta.itemType))) {
    update.description = text(erp?.item_name3);
  }
  return update;
}

async function main() {
  const erpByItemNo = await fetchErpItems();
  await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });
  const metas = await MasterItemMeta.find({ deletedAt: null }).lean();

  const fixes = [];
  for (const meta of metas) {
    const erp = erpByItemNo.get(text(meta.itemNo).toUpperCase());
    const update = planFix(meta, erp);
    if (Object.keys(update).length === 0) continue;
    fixes.push({ meta, update, inErp: !!erp });
  }

  for (const { meta, update, inErp } of fixes) {
    const parts = Object.entries(update).map(([key, value]) => `${key}: "${meta[key]}" → "${value}"`);
    console.log(`  ${meta.itemNo}${inErp ? '' : ' (ไม่พบใน ERP)'} | ${parts.join(' | ')}`);
  }
  const typeCount = fixes.filter((f) => 'itemType' in f.update).length;
  const descCount = fixes.filter((f) => 'description' in f.update).length;
  const missing = fixes.filter((f) => !f.inErp).length;
  console.log(`\nmeta ทั้งหมด ${metas.length} | ต้องแก้ ${fixes.length} รายการ (ชื่อสามัญ ${typeCount}, ขนาดบรรจุ ${descCount}) | ไม่พบใน ERP ${missing}`);

  if (!COMMIT) {
    console.log('DRY-RUN — ยังไม่เขียน. รันซ้ำด้วย --commit เพื่อ backup แล้วเขียนจริง');
  } else if (fixes.length > 0) {
    const backupDir = path.join(__dirname, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `master-item-meta-before-fix-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(backupFile, JSON.stringify(fixes.map((f) => f.meta), null, 2));
    console.log(`backup เอกสารเดิม ${fixes.length} รายการ → ${backupFile}`);
    const result = await MasterItemMeta.bulkWrite(fixes.map(({ meta, update }) => ({
      updateOne: { filter: { _id: meta._id }, update: { $set: update } },
    })));
    console.log(`เขียนแล้ว ${result.modifiedCount || 0} รายการ`);
  }
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });


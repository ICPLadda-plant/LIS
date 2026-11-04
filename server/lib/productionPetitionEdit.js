const { normalizePetitionItems } = require('./petitionSubmissionRules');

// แก้ไขคำขอจาก Production System หลังส่งเข้า LIS แล้ว
// สร้างรายการให้รูปแบบเดียวกับตอนสร้างใบคำร้อง (ProductionPetitionNewPage → makeInitialItemsFromQuery)

const SUFFIX_PREFIXES = ['Item: ', 'MF: ', 'Priority: '];

function petitionReceived(petition) {
  return Boolean(petition?.qcReceivedAt || petition?.labReceivedAt || petition?.receivedAt);
}

// ยังไม่มีใครรับตัวอย่าง = ฝ่ายผลิตแก้ได้ทั้งใบ
function canEditWholePetition(petition) {
  return !petitionReceived(petition) && ['deliveringQC', 'sampleSent'].includes(petition?.status);
}

function text(value) {
  return String(value ?? '').trim();
}

function quantityLabel(qty, unit) {
  return [text(qty), text(unit)].filter(Boolean).join(' ');
}

function qtyList(value) {
  return (Array.isArray(value) ? value : []).map(text).filter((qty) => Number(qty) > 0);
}

function flag(value, fallback) {
  if (typeof value === 'boolean') return value;
  const v = text(value).toLowerCase();
  if (['1', 'true'].includes(v)) return true;
  if (['0', 'false'].includes(v)) return false;
  return fallback;
}

// หมายเหตุรายการ = "<หมายเหตุจากผลิต> | Item: .. | MF: .. | Priority: .."
function itemNoteWith(note, suffix) {
  return [text(note), ...suffix].filter(Boolean).join(' | ');
}

function replaceProductionNote(itemNote, note) {
  // อ่านท้ายข้อความย้อนกลับตามลำดับ Priority → MF → Item (หมายเหตุผลิตเองก็อาจขึ้นต้นด้วย "MF: ")
  const parts = String(itemNote ?? '').split(' | ').map((part) => part.trim()).filter(Boolean);
  let start = parts.length;
  for (let p = SUFFIX_PREFIXES.length - 1; p >= 0 && start > 0; p -= 1) {
    if (parts[start - 1].startsWith(SUFFIX_PREFIXES[p])) start -= 1;
  }
  return itemNoteWith(note, parts.slice(start));
}

function buildEditedItems(existingItems, rows, { note, priority, department, petitionNo } = {}) {
  const previous = Array.isArray(existingItems) ? existingItems : [];
  const items = (rows || []).map((row, index) => {
    const old = previous[index] || {};
    const unit = text(row.unit);
    const qcLabel = quantityLabel(row.qty, unit);
    const sendToQc = flag(row.sendToQc, true);
    const sendToLab = flag(row.sendToLab, false);
    // Production ส่งน้ำหนักรายชิ้นของแต่ละฝั่งมา (qcQtys / labQtys) → ระบุฝั่งของแต่ละตัวอย่าง
    const qcQtys = sendToQc ? qtyList(row.qcQtys) : [];
    const labQtys = sendToLab ? qtyList(row.labQtys) : [];
    const portions = [...qcQtys.map((qty) => [qty, 'qc']), ...labQtys.map((qty) => [qty, 'lab'])];
    const labQty = Number(row.labQty);
    const split = sendToQc && sendToLab && labQty > 0 && qcLabel;
    const labelQuantities = portions.length
      ? portions.map(([qty]) => quantityLabel(qty, unit))
      : split ? [qcLabel, quantityLabel(row.labQty, unit)] : (qcLabel ? [qcLabel] : []);
    const labelQuantitySides = portions.length ? portions.map(([, side]) => side) : [];
    const productionDate = text(row.productionDate) || null;
    return {
      ...old,
      seq: index + 1,
      sampleName: text(row.sampleName),
      commonName: text(row.commonName),
      itemNo: text(row.itemNo) || undefined,
      batchNo: text(row.batchNo),
      lotNo: text(row.lotNo),
      productionDate,
      packageUnit: text(row.packsize),
      sendToQc,
      sendToLab,
      sampleQuantity: portions.length || (split ? 2 : 1),
      labelQuantity: labelQuantities.join(', '),
      labelQuantities,
      labelQuantitySides,
      // ว/ด/ป บนป้าย = วันที่ส่งของ Production; ไม่มีค่า (เวอร์ชันเดิม) ใช้วันที่ผลิต
      labelSampledDate: text(row.requestDate) || productionDate || '',
      // หมายเหตุแยกตามรายการ; Production รุ่นเดิมไม่ส่ง row.note จึงใช้หมายเหตุของคำขอ
      note: itemNoteWith(row.note !== undefined && row.note !== null ? row.note : note, [
        text(row.itemNo) ? `Item: ${text(row.itemNo)}` : '',
        text(row.mfNo) ? `MF: ${text(row.mfNo)}` : '',
        text(priority) ? `Priority: ${text(priority)}` : '',
      ]),
      sampleId: old.sampleId && old.seq === index + 1 ? old.sampleId : undefined,
    };
  });
  return normalizePetitionItems(items, { department, petitionNo });
}

// mirror src/lib/petitionRouting.ts routeTargetsFromSendTargets
// แก้หมายเหตุอย่างเดียว: itemNotes = [{ seq, sampleName, batchNo, note }] จับคู่ตาม Batch + ชื่อตัวอย่าง แล้วจึงลำดับ
// (LIS อาจรวม QC/Lab ของ batch เดียวกันเป็นรายการเดียว จึงรวมหมายเหตุที่ไม่ซ้ำกัน)
function applyItemNotes(items, itemNotes, fallbackNote) {
  const list = Array.isArray(itemNotes) ? itemNotes : [];
  const key = (it) => `${text(it.batchNo).toLowerCase()}|${text(it.sampleName).toLowerCase()}`;
  return (items || []).map((item, index) => {
    if (!list.length) return { ...item, note: replaceProductionNote(item.note, fallbackNote) };
    let matched = list.filter((n) => key(n) === key(item));
    if (!matched.length) matched = list.filter((n) => Number(n.seq) === Number(item.seq ?? index + 1));
    if (!matched.length) return item;
    const note = Array.from(new Set(matched.map((n) => text(n.note)).filter(Boolean))).join(' / ');
    return { ...item, note: replaceProductionNote(item.note, note) };
  });
}

function routeTargetsForItems(items) {
  if (!items.length || items.some((item) => item.sendToQc !== false)) return [];
  return items.some((item) => item.sendToLab === true) ? ['lab'] : [];
}

module.exports = {
  applyItemNotes,
  buildEditedItems,
  canEditWholePetition,
  petitionReceived,
  replaceProductionNote,
  routeTargetsForItems,
};


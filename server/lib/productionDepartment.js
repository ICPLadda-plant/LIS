'use strict';

// mirror ของ src/lib/productionDepartment.ts — "ผลิต 01" กับ "ผลิต 1" คือสายเดียวกัน
const PRODUCTION_PREFIX_RX = /^\s*(?:ผลิต|prod(?:uction)?\b)/i;
const PRODUCTION_LINE_RX = /^\s*(?:ผลิต|prod(?:uction)?)\s*0*(\d+)\s*$/i;

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isProductionDepartment(department) {
  return PRODUCTION_PREFIX_RX.test(String(department || ''));
}

function productionLineLabel(department) {
  const text = String(department || '').trim();
  if (!isProductionDepartment(text)) return null;
  const line = text.match(PRODUCTION_LINE_RX);
  return line ? `ผลิต ${Number(line[1])}` : text;
}

/** regex สำหรับค้นแผนกผู้ยื่นที่ตรงกับสายผลิตนี้ รวมทุกรูปแบบการเขียนเลขสาย */
function productionLineQueryRegex(label) {
  const text = String(label || '').trim();
  const line = text.match(PRODUCTION_LINE_RX);
  if (line) return new RegExp(`^\\s*(?:ผลิต|prod(?:uction)?)\\s*0*${Number(line[1])}\\s*$`, 'i');
  return new RegExp(`^\\s*${escapeRegex(text)}\\s*$`, 'i');
}

module.exports = {
  PRODUCTION_PREFIX_RX,
  isProductionDepartment,
  productionLineLabel,
  productionLineQueryRegex,
};

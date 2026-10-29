'use strict';

// ปริมาณในขวด (mg/ml/g) เก็บละเอียดสุด 6 ตำแหน่งทศนิยม
// กันเศษทศนิยมจากการบวกลบหลายครั้ง (เช่น 60 - 10.1 - 49.9 = 1e-14) ที่ทำให้ขวดไม่ถูกตั้งเป็น "หมด"
const QUANTITY_DECIMALS = 6;
const EMPTY_REMAINING_EPSILON = 1e-6;

function normalizeQuantity(value) {
  const n = Number(value);
  if (value == null || !Number.isFinite(n)) return value;
  if (Math.abs(n) < EMPTY_REMAINING_EPSILON) return 0;
  return Number(n.toFixed(QUANTITY_DECIMALS));
}

module.exports = { normalizeQuantity, EMPTY_REMAINING_EPSILON };

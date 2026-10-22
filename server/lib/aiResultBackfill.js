'use strict';

function numberValue(value) {
  if (value === '' || value == null) return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function fieldSubstance(label) {
  const parts = String(label).split('::');
  return parts.length > 1 ? parts.slice(1).join('::').trim().toLowerCase() : '';
}

function densityFromResult(result, substance = '') {
  const records = [result?.values, ...(Array.isArray(result?.entries) ? result.entries : [])].filter(Boolean);
  let fallback = null;
  for (const record of records) {
    for (const [label, raw] of Object.entries(record)) {
      if (!isDensityLabel(label)) continue;
      const value = numberValue(raw);
      if (value == null || value <= 0) continue;
      const keySubstance = fieldSubstance(label);
      if (substance && keySubstance === substance) return value;
      if (!keySubstance && fallback == null) fallback = value;
      if (!substance && fallback == null) fallback = value;
    }
  }
  return fallback;
}

function formatCalculatedAi(value) {
  const absolute = Math.abs(value);
  if (absolute === 0 || absolute >= 1) return value.toFixed(2);
  const leadingDecimalZeros = Math.max(0, Math.ceil(-Math.log10(absolute)) - 1);
  return value.toFixed(leadingDecimalZeros + 3);
}

// รองรับ "Density", "ค่าถพ.", "ค่า ถพ.", "ค่า ถ.พ." และแบบรายสาร
function isDensityLabel(label) {
  const text = String(label).trim();
  return /^(?:density|ค่า\s*ถ\.?\s*พ\.?)\s*(?:::|$)/i.test(text) && !/__source$/i.test(text);
}

// %AI ที่เคยคำนวณด้วย ถพ. = 1 จะเท่ากับ Sample Average (หลังปัดทศนิยม)
function wasCalculatedWithoutDensity(aiValue, average) {
  const stored = numberValue(aiValue);
  if (stored == null) return false;
  return stored === average || String(aiValue).trim() === formatCalculatedAi(average);
}

function correctedAiValues(values, densityResult) {
  const next = { ...(values || {}) };
  const changes = [];
  const averageLabels = Object.keys(values || {}).filter((label) => /^%?\s*sample\s*(average|avg|mean|เฉลี่ย)(?:::|$)/i.test(label.trim()));
  for (const aiLabel of Object.keys(values || {})) {
    if (!/^%?\s*ai(?:\s*[-—:]|$|::)/i.test(aiLabel.trim())) continue;
    const substance = fieldSubstance(aiLabel);
    // ใช้ค่าเฉลี่ยของสารเดียวกันก่อน ถ้าไม่มีใช้ค่าเฉลี่ยรวม
    const averageLabel = averageLabels.find((label) => fieldSubstance(label) === substance)
      || averageLabels.find((label) => !fieldSubstance(label));
    if (!averageLabel) continue;
    const average = numberValue(values[averageLabel]);
    if (average == null) continue;
    const density = densityFromResult(densityResult, substance);
    if (density == null || density === 1) continue;
    if (!wasCalculatedWithoutDensity(next[aiLabel], average)) continue;
    const corrected = formatCalculatedAi(average * density);
    if (String(next[aiLabel] ?? '') === corrected) continue;
    changes.push({ field: aiLabel, before: next[aiLabel], after: corrected, average, density });
    next[aiLabel] = corrected;
  }
  return { values: next, changes };
}

module.exports = { correctedAiValues, densityFromResult, formatCalculatedAi, isDensityLabel };

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
      if (!/^(density|ค่าถพ\.)(?:::|$)/i.test(label.trim()) || /__source$/i.test(label)) continue;
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

function correctedAiValues(values, densityResult) {
  const next = { ...(values || {}) };
  const changes = [];
  for (const [label, rawAverage] of Object.entries(values || {})) {
    if (!/^%?\s*sample\s*(average|avg|mean|เฉลี่ย)(?:::|$)/i.test(label.trim())) continue;
    const average = numberValue(rawAverage);
    if (average == null) continue;
    const substance = fieldSubstance(label);
    const density = densityFromResult(densityResult, substance);
    if (density == null) continue;
    const aiLabel = Object.keys(values || {}).find((candidate) => {
      if (!/^%?\s*ai(?:\s*[-—:]|$|::)/i.test(candidate.trim())) return false;
      return fieldSubstance(candidate) === substance;
    });
    if (!aiLabel) continue;
    const corrected = formatCalculatedAi(average * density);
    if (String(next[aiLabel] ?? '') === corrected) continue;
    changes.push({ field: aiLabel, before: next[aiLabel], after: corrected, average, density });
    next[aiLabel] = corrected;
  }
  return { values: next, changes };
}

module.exports = { correctedAiValues, densityFromResult, formatCalculatedAi };

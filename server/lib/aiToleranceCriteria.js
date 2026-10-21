const AI_TOLERANCE_CRITERIA = [
  { percent: '0.005', criteria: '0.005% ± 0.00125' },
  { percent: '0.125', criteria: '0.125% ± 0.01875' },
  { percent: '0.25', criteria: '0.25% ± 0.0375' },
  { percent: '0.3', criteria: '0.3% ± 0.075' },
  { percent: '0.5', criteria: '0.5% ± 0.075' },
  { percent: '1', formulation: 'SG', criteria: '1% ± 0.25' },
  { percent: '1', criteria: '1% ± 0.15' },
  { percent: '1.5', criteria: '1.5% ± 0.375' },
  { percent: '1.8', criteria: '1.8% ± 0.27' },
  { percent: '2', formulation: 'GR', criteria: '2% ± 0.50' },
  { percent: '2', criteria: '2% ± 0.30' },
  { percent: '2.5', criteria: '2.5% ± 0.375' },
  { percent: '2.85', criteria: '2.85% ± 0.285' },
  { percent: '3', criteria: '3% ± 0.30' },
  { percent: '3.5', criteria: '3.5% ± 0.35' },
  { percent: '3.76', criteria: '3.76% ± 0.376' },
  { percent: '4', criteria: '4% ± 0.40' },
  { percent: '5', criteria: '5% ± 0.50' },
  { percent: '6', criteria: '6% ± 0.60' },
  { percent: '6.2', criteria: '6.2% ± 0.62' },
  { percent: '6.9', criteria: '6.9% ± 0.69' },
  { percent: '7.52', criteria: '7.52% ± 0.75' },
  { percent: '8', criteria: '8% ± 0.80' },
  { percent: '9', criteria: '9% ± 0.90' },
  { percent: '9.3', criteria: '9.3% ± 0.90' },
  { percent: '10', criteria: '10% ± 1.00' },
  { percent: '10.8', criteria: '10.8% ± 0.65' },
  { percent: '11', criteria: '11% ± 0.66' },
  { percent: '11.6', criteria: '11.6% ± 0.70' },
  { percent: '12', criteria: '12% ± 0.72' },
  { percent: '12.5', criteria: '12.5% ± 0.75' },
  { percent: '13.2', criteria: '13.2% ± 0.79' },
  { percent: '15', criteria: '15% ± 0.90' },
  { percent: '16', criteria: '16% ± 0.96' },
  { percent: '18', criteria: '18% ± 1.08' },
  { percent: '20', criteria: '20% ± 1.20' },
  { percent: '22', criteria: '22% ± 1.32' },
  { percent: '24', criteria: '24% ± 1.44' },
  { percent: '25', criteria: '25% ± 1.50' },
  { percent: '27', criteria: '27% ± 1.62' },
  { percent: '27.5', criteria: '27.5% ± 1.37' },
  { percent: '27.6', criteria: '27.6% ± 1.38' },
  { percent: '27.84', criteria: '27.84% ± 1.39' },
  { percent: '30', criteria: '30% ± 1.50' },
  { percent: '33', criteria: '33% ± 1.65' },
  { percent: '34', criteria: '34% ± 1.70' },
  { percent: '35', criteria: '35% ± 1.75' },
  { percent: '36', criteria: '36% ± 1.80' },
  { percent: '37.3', criteria: '37.3% ± 1.86' },
  { percent: '40', criteria: '40% ± 2.00' },
  { percent: '42', criteria: '42% ± 2.10' },
  { percent: '43', criteria: '43% ± 2.15' },
  { percent: '45', criteria: '45% ± 2.25' },
  { percent: '45.2', criteria: '45.2% ± 2.26' },
  { percent: '46.8', criteria: '46.8% ± 2.34' },
  { percent: '48', criteria: '48% ± 2.40' },
  { percent: '50', criteria: '50% ± 2.50' },
  { percent: '60', criteria: '60% ± 2.50' },
  { percent: '62', criteria: '62% ± 2.50' },
  { percent: '64', criteria: '64% ± 2.50' },
  { percent: '66.55', criteria: '66.55% ± 2.50' },
  { percent: '66.8', criteria: '66.8% ± 2.50' },
  { percent: '70', criteria: '70% ± 2.50' },
  { percent: '72', criteria: '72% ± 2.50' },
  { percent: '72.2', criteria: '72.2% ± 2.50' },
  { percent: '75', criteria: '75% ± 2.50' },
  { percent: '77', criteria: '77% ± 2.50' },
  { percent: '79.2', criteria: '79.2% ± 2.50' },
  { percent: '80', criteria: '80% ± 2.50' },
  { percent: '80.8', criteria: '80.8% ± 2.50' },
  { percent: '83', criteria: '83% ± 2.50' },
  { percent: '84', criteria: '84% ± 2.50' },
  { percent: '85', criteria: '85% ± 2.50' },
  { percent: '90', criteria: '90% ± 2.50' },
  { percent: '95', criteria: '95% ± 2.50' },
];

function normalizePercent(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : String(value || '').trim();
}

function decimalPlaces(value) {
  return value.includes('.') ? value.split('.')[1].length : 0;
}

function formatRangeCenter(value, precision) {
  return value.toFixed(precision).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
}

function plusMinusAiCriteriaFromRange(criteria) {
  const source = String(criteria || '').trim();
  if (!source) return null;
  let converted = false;
  const normalized = source.replace(
    /(-?\d+(?:\.\d+)?)\s*%?\s*[-–—]\s*(-?\d+(?:\.\d+)?)\s*%?(?:\s*W\s*\/\s*[WV])?/gi,
    (match, lowerText, upperText) => {
      const lower = Number(lowerText);
      const upper = Number(upperText);
      if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper < lower) return match;
      const sourcePrecision = Math.max(decimalPlaces(lowerText), decimalPlaces(upperText));
      const scale = 10 ** sourcePrecision;
      const lowerScaled = Math.round(lower * scale);
      const upperScaled = Math.round(upper * scale);
      const precision = sourcePrecision + (Math.abs(upperScaled - lowerScaled) % 2 ? 1 : 0);
      const center = (lower + upper) / 2;
      const tolerance = (upper - lower) / 2;
      converted = true;
      return `${formatRangeCenter(center, precision)}% ± ${tolerance.toFixed(precision)}`;
    },
  );
  return converted ? normalized : null;
}

function textAfterMatchedPercent(value, match) {
  return value.slice((match.index || 0) + match[0].length).trim().toUpperCase();
}

function aiPercentFromCommonName(commonName) {
  const match = String(commonName || '').match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? normalizePercent(match[1]) : null;
}

function aiToleranceCriteriaForCommonName(commonName) {
  const source = String(commonName || '');
  const percentPattern = /(\d+(?:\.\d+)?)\s*%/g;
  const criteria = [];
  let match;
  while ((match = percentPattern.exec(source)) !== null) {
    const percent = normalizePercent(match[1]);
    const afterPercent = textAfterMatchedPercent(source, match);
    const specific = AI_TOLERANCE_CRITERIA.find((item) => (
      item.percent === percent && item.formulation && new RegExp(`\\b${item.formulation}\\b`, 'i').test(afterPercent)
    ));
    const fallback = AI_TOLERANCE_CRITERIA.find((item) => item.percent === percent && !item.formulation);
    const selected = specific || fallback;
    if (selected && !criteria.includes(selected.criteria)) criteria.push(selected.criteria);
  }
  return criteria.length ? criteria.join(' / ') : null;
}

function resolveAiToleranceCriteria(commonName, fallbackCriteria) {
  return aiToleranceCriteriaForCommonName(commonName)
    || plusMinusAiCriteriaFromRange(fallbackCriteria)
    || String(fallbackCriteria || '').trim()
    || null;
}

function isAiContentTestItem(testItem) {
  return /(?:%\s*AI|AI\s*content|active\s*ingredient)/i.test(String(testItem || ''));
}

module.exports = {
  AI_TOLERANCE_CRITERIA,
  aiPercentFromCommonName,
  aiToleranceCriteriaForCommonName,
  isAiContentTestItem,
  plusMinusAiCriteriaFromRange,
  resolveAiToleranceCriteria,
};

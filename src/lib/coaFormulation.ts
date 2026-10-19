const GR_WP_SP_FORMULATIONS = new Set(["WG", "WP", "ST", "GR", "DS", "SP", "SG", "GB"]);

function formulationSuffix(commonName?: string): string {
  return commonName?.trim().toUpperCase().match(/\b([A-Z]{2,3})$/)?.[1] || "";
}

export function isGrWpSpCommonName(commonName?: string): boolean {
  return GR_WP_SP_FORMULATIONS.has(formulationSuffix(commonName));
}

export function aiContentTestItemForCommonName(commonName?: string): string {
  return `%AI content (${isGrWpSpCommonName(commonName) ? "W/W" : "W/V"})`;
}

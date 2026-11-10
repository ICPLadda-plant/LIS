// ดึงรูปจากระบบ Product ID (GET /product-id/api/v1/lis/media-index) เพื่อเติมใน master item
// - ไม่ได้ตั้ง PRODUCT_ID_MEDIA_URL = ปิดฟีเจอร์ คืน {} ทันที (ไม่ยิง network)
// - cache 5 นาที, timeout 3 วินาที
// - Product ID ล่ม/ช้า/ตอบผิดรูปแบบ → ใช้ cache เดิม (ถ้ามี) หรือ {} เพื่อไม่ให้ /master-items พัง

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 3000;

function createProductMediaClient({
  getUrl = () => process.env.PRODUCT_ID_MEDIA_URL,
  getApiKey = () => process.env.PRODUCT_ID_API_KEY,
  fetchImpl = (...args) => fetch(...args),
  ttlMs = DEFAULT_TTL_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  now = () => Date.now(),
  logger = console,
} = {}) {
  let cache = null; // { items, at }
  let inflight = null;

  async function load(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = { Accept: 'application/json' };
      const apiKey = String(getApiKey() || '').trim();
      if (apiKey) headers['X-API-Key'] = apiKey;
      const response = await fetchImpl(url, { headers, signal: controller.signal });
      if (!response.ok) throw new Error('Product ID media-index HTTP ' + response.status);
      const payload = await response.json();
      const items = payload && typeof payload.items === 'object' && !Array.isArray(payload.items) ? payload.items : null;
      if (!items) throw new Error('Product ID media-index ตอบรูปแบบไม่ถูกต้อง');
      cache = { items, at: now() };
      return items;
    } finally {
      clearTimeout(timer);
    }
  }

  async function getIndex() {
    const url = String(getUrl() || '').trim();
    if (!url) return {};
    if (cache && now() - cache.at < ttlMs) return cache.items;
    if (!inflight) {
      inflight = load(url)
        .catch((err) => {
          logger.warn('[productMedia] ' + (err.name === 'AbortError' ? 'timeout' : err.message));
          return cache ? cache.items : {};
        })
        .finally(() => { inflight = null; });
    }
    return inflight;
  }

  function mediaFor(index, itemNo) {
    const list = index && itemNo ? index[String(itemNo).trim()] : null;
    return Array.isArray(list) ? list : [];
  }

  return { getIndex, mediaFor, clear: () => { cache = null; } };
}

const defaultClient = createProductMediaClient();

module.exports = { createProductMediaClient, defaultClient };

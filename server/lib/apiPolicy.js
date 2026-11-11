// ทะเบียนกลางของ "API ที่ระบบภายนอกเรียก" — middleware (lib/apiGuard.js) และหน้า
// ตั้งค่า (GET /api-keys/meta) อ่านจากไฟล์นี้ไฟล์เดียว
//
// ⚠️ ห้ามใส่ route ที่ SPA เรียก: หน้าเว็บไม่มี API key ใส่แล้วเปิดโหมด enforce
// เมื่อไหร่หน้าเว็บดับทันที

const POLICY_MODES = ['off', 'audit', 'enforce'];

const API_SCOPES = [
  { id: 'integration:write', label: 'รับคำขอจากระบบ production' },
  { id: 'temphum:write', label: 'ส่งค่าอุณหภูมิ/ความชื้น (Node-RED)' },
  { id: 'line:ingest', label: 'ส่ง event LINE ผ่าน n8n' },
];

const API_POLICIES = [
  {
    id: 'production-integration',
    // PUT = production แก้ไขคำขอ (PUT /petitions/:petitionNo) ต้องผ่าน guard ด้วย ไม่งั้นผู้เรียกที่ใช้
    // X-API-Key จะไม่ได้ req.apiKey แล้วโดน 401 ส่วน GET ห้ามใส่ เพราะหน้าเว็บเรียก GET /petitions/:token
    methods: ['POST', 'PUT'],
    prefix: '/production-integration',
    scope: 'integration:write',
    label: 'สร้างคำขอจากระบบ production',
    defaultMode: 'audit',
    legacyEnv: 'PRODUCTION_INTEGRATION_TOKEN',
  },
  {
    id: 'temphum-push',
    methods: ['POST'],
    prefix: '/temphum',
    exact: true,
    scope: 'temphum:write',
    label: 'Node-RED push อุณหภูมิ/ความชื้น',
    defaultMode: 'audit',
    legacyEnv: null,
  },
  {
    id: 'line-ingest',
    methods: ['POST'],
    prefix: '/line/ingest',
    scope: 'line:ingest',
    label: 'n8n ส่ง event LINE เข้า LIS',
    defaultMode: 'audit',
    legacyEnv: 'LINE_INGEST_SECRET',
  },
];

// '/LIS/api/temphum?x=1' → '/temphum' (mountApi ผูก router ไว้ทั้ง /api และ /LIS/api)
// ⚠️ ต้อง lowercase ก่อนเทียบเสมอ: Express route แบบ default เทียบ path แบบไม่สนตัวพิมพ์
// (case-insensitive) ดังนั้น POST /LIS/api/TEMPHUM ก็ยังไปถึง route เดิม — ถ้า normalizePath
// เทียบแบบ case-sensitive (ของเดิม) matchPolicy จะคืน null ทำให้ guard มองไม่เห็น request นี้
// เลย (ไม่ต้องมี key, ไม่ rate limit, ไม่ log แม้ใน enforce mode) prefix ในทะเบียนเป็นตัวเล็กหมด
// อยู่แล้ว lowercase จึงทำให้ "match มากขึ้น" เท่านั้น ไม่มีทางไป match route ของ SPA โดยไม่ตั้งใจ
function normalizePath(url) {
  let path = String(url || '').split('?')[0].toLowerCase();
  if (path.startsWith('/lis/')) path = path.slice(4);
  if (path === '/api') path = '/';
  else if (path.startsWith('/api/')) path = path.slice(4);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path || '/';
}

function matchPolicy(policies, method, url) {
  const path = normalizePath(url);
  const verb = String(method || '').toUpperCase();
  return (
    (policies || []).find((p) => {
      if (!p.methods.includes(verb)) return false;
      if (p.exact) return path === p.prefix;
      return path === p.prefix || path.startsWith(`${p.prefix}/`);
    }) || null
  );
}

// path ที่โชว์ในหน้า UI เช่น 'POST /LIS/api/temphum' หรือ 'POST /LIS/api/production-integration/*'
// (ต่อท้าย /* ให้ policy แบบ prefix เพื่อสื่อว่าคุมทุก sub-path ไม่ใช่แค่ path ตรงตัว)
function policyPublicPath(policy) {
  const suffix = policy.exact ? '' : '/*';
  return `${policy.methods.join('/')} /LIS/api${policy.prefix}${suffix}`;
}

module.exports = {
  POLICY_MODES,
  API_SCOPES,
  API_POLICIES,
  normalizePath,
  matchPolicy,
  policyPublicPath,
};

const {
  API_SCOPES,
  API_POLICIES,
  normalizePath,
  matchPolicy,
  policyPublicPath,
} = require('./apiPolicy');

describe('normalizePath', () => {
  test('ตัด prefix /api และ /LIS/api ได้ทั้งคู่', () => {
    expect(normalizePath('/api/temphum')).toBe('/temphum');
    expect(normalizePath('/LIS/api/temphum')).toBe('/temphum');
  });

  test('ตัด query string และ trailing slash', () => {
    expect(normalizePath('/LIS/api/line/ingest?key=abc')).toBe('/line/ingest');
    expect(normalizePath('/api/temphum/')).toBe('/temphum');
  });

  test('path ที่ไม่ได้ขึ้นต้นด้วย /api ปล่อยไว้ตามเดิม', () => {
    expect(normalizePath('/uploads/x.png')).toBe('/uploads/x.png');
  });
});

describe('matchPolicy', () => {
  test('POST /temphum ตรง policy temphum-push', () => {
    const p = matchPolicy(API_POLICIES, 'POST', '/LIS/api/temphum');
    expect(p?.id).toBe('temphum-push');
    expect(p?.scope).toBe('temphum:write');
  });

  test('GET /temphum ไม่ถูกคุม (หน้าเว็บใช้อยู่)', () => {
    expect(matchPolicy(API_POLICIES, 'GET', '/api/temphum')).toBeNull();
  });

  test('exact policy ไม่จับ sub-path', () => {
    expect(matchPolicy(API_POLICIES, 'POST', '/api/temphum/bulk')).toBeNull();
  });

  test('prefix policy จับ sub-path ได้', () => {
    const p = matchPolicy(API_POLICIES, 'POST', '/api/production-integration/petitions');
    expect(p?.id).toBe('production-integration');
  });

  test('route ที่หน้าเว็บใช้ต้องไม่ถูกคุม', () => {
    for (const path of ['/api/petitions', '/api/stock/standards', '/api/qc-results', '/api/api-keys']) {
      expect(matchPolicy(API_POLICIES, 'GET', path)).toBeNull();
      expect(matchPolicy(API_POLICIES, 'POST', path)).toBeNull();
    }
  });

  test('ทุก policy อ้าง scope ที่มีจริงในทะเบียน และเริ่มที่โหมด audit', () => {
    const scopeIds = API_SCOPES.map((s) => s.id);
    for (const p of API_POLICIES) {
      expect(scopeIds).toContain(p.scope);
      expect(p.defaultMode).toBe('audit');
    }
  });

  // C1: Express route แบบ case-insensitive โดย default — matchPolicy ต้อง match ด้วยไม่ว่า
  // ตัวพิมพ์จะเป็นแบบไหน ไม่งั้น POST /LIS/api/TEMPHUM จะหลุดพ้น policy ไปเงียบๆ แม้ Express จะ
  // ส่งไป route เดิมก็ตาม (guard มองไม่เห็น = ไม่ต้องมี key, ไม่ rate limit, ไม่ log)
  test('ตัวพิมพ์ใหญ่-เล็กของ path ไม่มีผลกับการ match (กัน bypass ด้วย casing)', () => {
    for (const url of ['/LIS/api/TEMPHUM', '/api/TempHum', '/API/TEMPHUM', '/api/temphum']) {
      const p = matchPolicy(API_POLICIES, 'POST', url);
      expect(p?.id).toBe('temphum-push');
    }
  });

  test('production-integration match ได้ทั้งตัวพิมพ์ใหญ่และเล็ก', () => {
    const p = matchPolicy(API_POLICIES, 'POST', '/api/Production-Integration/petitions');
    expect(p?.id).toBe('production-integration');
  });

  test('path ของ SPA ที่สะกดตัวใหญ่ปนก็ยังไม่ถูกคุม', () => {
    expect(matchPolicy(API_POLICIES, 'GET', '/api/Petitions')).toBeNull();
    expect(matchPolicy(API_POLICIES, 'POST', '/api/Petitions')).toBeNull();
  });
});

// M12: policyPublicPath ต่อ /* ให้ policy แบบ prefix (ไม่ใช่ exact) เพื่อสื่อว่าคุมทุก sub-path
describe('policyPublicPath', () => {
  test('policy แบบ exact ไม่มี /* ต่อท้าย', () => {
    const p = API_POLICIES.find((x) => x.id === 'temphum-push');
    expect(policyPublicPath(p)).toBe('POST /LIS/api/temphum');
  });

  test('policy แบบ prefix มี /* ต่อท้าย เพื่อสื่อว่าคุมทุก sub-path', () => {
    const p = API_POLICIES.find((x) => x.id === 'production-integration');
    expect(policyPublicPath(p)).toBe('POST/PUT /LIS/api/production-integration/*');
  });
});

describe('production-integration PUT', () => {
  test('PUT แก้ไขคำขอผ่าน guard เพื่อให้ X-API-Key ใช้ได้ ส่วน GET ของหน้าเว็บไม่ถูกคุม', () => {
    expect(matchPolicy(API_POLICIES, 'PUT', '/LIS/api/production-integration/petitions/P-2611-0001')?.id).toBe('production-integration');
    expect(matchPolicy(API_POLICIES, 'GET', '/LIS/api/production-integration/petitions/abcdefghijklmnop')).toBeNull();
  });
});

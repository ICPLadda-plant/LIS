import { test, expect, type Page } from '@playwright/test';
import HTMLtoDOCX from '@turbodocx/html-to-docx';

// ครบลูปหน้า "จัดการเอกสาร" (/documents) กับ dev server จริง (:8000) + API จริง (:3001)
// ต้องรัน npm run dev และ server ต้องตั้ง ALLOW_DEV_STATUS=true (ผู้ใช้ dev *.dev@icpladda.com)
const BASE = 'http://localhost:8000/LIS';
const API = 'http://localhost:3001/api';
const DEV = { 'x-lis-user': 'e2e.dev@icpladda.com' };
const STAMP = 'E2E-' + Date.now();

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.afterAll(async ({ request }) => {
  // ลบเอกสารทดสอบทุกตัวที่ชื่อขึ้นต้นด้วย STAMP
  const res = await request.get(API + '/documents', { headers: DEV });
  const list = ((await res.json()) as { data: Array<{ id: string; title: string }> }).data;
  for (const d of list.filter((x) => x.title.includes(STAMP) || x.title.startsWith('แม่แบบ ') && x.title.includes(STAMP))) {
    await request.delete(API + '/documents/' + d.id, { headers: DEV });
  }
});

test('สร้าง แก้ บันทึก เปิดใหม่ กรอกฟอร์ม ส่งออก และลบเอกสาร', async ({ page }) => {
  const errors = trackErrors(page);
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(BASE + '/documents');

  await expect(page.getByText(/เอกสารในระบบ \(\d+ รายการ\)/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('ใบรับรองผลการวิเคราะห์ (Certificate of Analysis)')).toBeVisible();

  await page.getByRole('button', { name: 'สร้างเอกสาร' }).click();
  // แผงข้อมูลเอกสาร + role จริงจาก server (จุดที่เคยพัง roles.map)
  await expect(page.getByText('ข้อมูลเอกสาร')).toBeVisible();
  const meta = page.locator('fieldset'); // แผงข้อมูลเอกสาร (กันชนปุ่มของ DevRoleSwitcher)
  await expect(meta.getByRole('button', { name: 'QC Staff' }).first()).toBeVisible({ timeout: 10000 });

  const title = STAMP + ' ใบตรวจรับ';
  await page.getByLabel('ชื่อเอกสาร').fill(title);
  await page.getByLabel('รหัสเอกสาร').fill('FM-E2E-01');
  await page.getByLabel('ขนาดกระดาษ').selectOption('A4 แนวนอน');
  await page.getByLabel('สถานะเอกสาร').selectOption('ใช้งาน');
  await meta.getByRole('button', { name: 'QC Staff' }).first().click();
  await expect(meta.getByRole('button', { name: 'QC Staff' }).first()).toHaveAttribute('aria-pressed', 'true');

  const editor = page.getByLabel('เนื้อหาเอกสาร');
  await expect(editor).toHaveAttribute('style', /297mm/);
  await editor.click();
  await page.keyboard.type('หัวข้อทดสอบ ');
  await page.getByRole('button', { name: 'ตัวหนา' }).click();
  await page.keyboard.type('ตัวหนา');
  await page.getByRole('button', { name: 'ตัวหนา' }).click();

  await page.getByRole('tab', { name: 'แทรก' }).click();
  page.once('dialog', (d) => d.accept('ชื่อผู้รับ'));
  await page.getByRole('button', { name: 'ช่องข้อความ', exact: true }).click();
  page.once('dialog', (d) => d.accept('ผ่าน'));
  await page.getByRole('button', { name: 'ช่องติ๊ก' }).click();
  await page.getByRole('button', { name: 'แทรกตาราง 3×3' }).click();
  await expect(editor.locator('[data-ff]')).toHaveCount(2);
  await expect(editor.locator('table')).toHaveCount(1);

  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByText('บันทึกแล้ว').first()).toBeVisible();

  // กลับรายการ แล้วเปิดใหม่ ค่าต้องอยู่ครบ
  await page.getByRole('button', { name: 'รายการเอกสาร' }).click();
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await expect(row).toContainText('A4 แนวนอน');
  await expect(row).toContainText('ใช้งาน');
  await expect(row).toContainText('QC Staff');
  await row.getByRole('button', { name: title }).click();
  await expect(page.getByLabel('รหัสเอกสาร')).toHaveValue('FM-E2E-01');
  await expect(editor.locator('b, strong, [style*="bold"]').first()).toContainText('ตัวหนา');
  await expect(editor.locator('[data-ff]')).toHaveCount(2);

  // โหมดกรอกแบบฟอร์ม
  await page.getByRole('button', { name: 'กรอกแบบฟอร์ม' }).click();
  const name = page.getByLabel('ชื่อผู้รับ');
  await name.fill('สมหญิง ใจดี');
  await expect(name).toHaveAttribute('value', 'สมหญิง ใจดี');
  await page.getByLabel('ผ่าน').check();
  await page.getByRole('button', { name: 'กลับไปแก้ฟอร์ม' }).click();
  await expect(editor.locator('[data-ff]')).toHaveCount(2);

  // ส่งออก .docx
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ส่งออก .docx' }).click();
  const file = await dl;
  expect(file.suggestedFilename()).toBe(title + '.docx');
  const buf = await file.createReadStream().then(async (s) => {
    const chunks: Buffer[] = [];
    for await (const c of s) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  });
  expect(buf.subarray(0, 2).toString()).toBe('PK'); // zip = docx จริง

  // ลบ
  await page.getByRole('button', { name: 'รายการเอกสาร' }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'ลบเอกสาร' }).click();
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('นำเข้าไฟล์ Word แล้วตารางมาครบ', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto(BASE + '/documents');
  await expect(page.getByText(/เอกสารในระบบ/)).toBeVisible({ timeout: 20000 });

  const docx = (await HTMLtoDOCX(
    '<p>ตารางแสดงเกณฑ์</p><table><tr><td>Acetochlor 50% EC</td><td>49.51-52.60</td></tr><tr><td>Ametryn 50% SC</td><td>42.58-46.27</td></tr></table>',
  )) as Buffer;
  await page.locator('input[type=file][accept=".docx"]').setInputFiles({
    name: STAMP + ' เกณฑ์.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(docx),
  });
  await expect(page.getByText(/นำเข้าแล้ว/).first()).toBeVisible({ timeout: 15000 });
  const editor = page.getByLabel('เนื้อหาเอกสาร');
  await expect(editor.locator('table tr')).toHaveCount(2);
  await expect(editor).toContainText('Acetochlor 50% EC');
  // เส้นตารางต้องแสดง
  const border = await editor.locator('td').first().evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(border).toBe('solid');
  await page.getByRole('button', { name: 'รายการเอกสาร' }).click();
  await expect(page.getByRole('row').filter({ hasText: STAMP + ' เกณฑ์' })).toContainText('นำเข้า Word');
  expect(errors).toEqual([]);
});

test('แก้ฟอร์มใบคำขอรับบริการ แล้วหน้าพิมพ์คำร้องใช้แม่แบบพร้อมข้อมูลจริง', async ({ page, request }) => {
  const errors = trackErrors(page);
  const lr = await request.get(API + '/lab-requests?limit=1', { headers: DEV });
  const items = ((await lr.json()) as { items: Array<{ petitionId: string }> }).items ?? [];
  test.skip(items.length === 0, 'ไม่มีคำร้องที่มี lab request ใน DB');
  const petitionId = items[0].petitionId;

  // ไม่ให้ชนแม่แบบจริงของผู้ใช้ที่อาจมีอยู่
  const existing = await request.get(API + '/documents?templateFor=FM-QP-07-04-001', { headers: DEV });
  test.skip(((await existing.json()) as { data: unknown[] }).data.length > 0, 'มีแม่แบบ FM-QP-07-04-001 อยู่แล้ว ไม่แตะของจริง');

  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(BASE + '/documents');
  await expect(page.getByText(/เอกสารในระบบ/)).toBeVisible({ timeout: 20000 });
  await page.getByRole('row').filter({ hasText: 'FM-QP-07-04-001' }).getByRole('button', { name: 'แก้ฟอร์มนี้' }).click();
  await expect(page.getByText(/สร้างแม่แบบแล้ว/).first()).toBeVisible();
  await page.getByLabel('ชื่อเอกสาร').fill('แม่แบบ ' + STAMP);
  const editor = page.getByLabel('เนื้อหาเอกสาร');
  await expect(editor.locator('[data-fv="petitionNo"]')).toHaveCount(1);
  await expect(editor.locator('tr[data-fv-repeat="items"]')).toHaveCount(1);
  await editor.locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' ' + STAMP);
  await page.getByLabel('สถานะเอกสาร').selectOption('ใช้งาน');
  await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
  await expect(page.getByText('บันทึกแล้ว').first()).toBeVisible();

  await page.route('**/api/print/config', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }));
  const pRes = await request.get(API + '/petitions/' + petitionId, { headers: DEV });
  const pBody = (await pRes.json()) as { data?: { petitionNo?: string }; petitionNo?: string };
  const petitionNo = pBody.data?.petitionNo ?? pBody.petitionNo ?? '';
  expect(petitionNo).not.toBe('');
  await page.goto(BASE + '/petition/' + petitionId); // หน้ารายละเอียดคำร้องที่ใช้งานจริง (Timeline)
  await expect(page.getByRole('heading', { name: petitionNo }).first()).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: /ใบคำขอรับบริการ/ }).first().click();
  const printed = page.locator('.doc-template-print');
  await expect(printed).toBeVisible({ timeout: 15000 });
  await expect(printed).toContainText(STAMP);
  await expect(printed).toContainText(petitionNo); // ตัวแปรเลขที่คำร้องถูกเติมข้อมูลจริง
  await expect(printed.locator('[data-fv-repeat]')).toHaveCount(0);
  await expect(printed.locator('tr')).not.toHaveCount(1); // หัวตาราง + แถวตัวอย่างจริง
  await expect(page.locator('.pr-page1')).toHaveCount(1); // แผ่นที่ไม่มีแม่แบบยังพิมพ์จากฟอร์มเดิม
  await expect(page.locator('.pr-page2')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('ผู้ใช้ที่ไม่มีสิทธิ์: ไม่เห็นเอกสารที่จำกัด และเปิดเอกสารสาธารณะแบบอ่านอย่างเดียว', async ({ page, request }) => {
  const errors = trackErrors(page);
  const QC = 'wathathorn.s@icpladda.com'; // ผู้ใช้จริง role qc-staff
  const hidden = await request.post(API + '/documents', { headers: DEV, data: { title: STAMP + ' เฉพาะ Lab Head', html: '<p>ลับ</p>', viewers: ['lab-head'], managers: ['lab-head'] } });
  const open = await request.post(API + '/documents', { headers: DEV, data: { title: STAMP + ' ทุกคนเห็น', html: '<p>สาธารณะ</p>', managers: ['lab-head'] } });
  expect(hidden.status()).toBe(201);
  expect(open.status()).toBe(201);

  // ส่งคำขอ /documents ในฐานะ qc-staff จริง
  await page.route('**/api/documents**', (route) => route.continue({ headers: { ...route.request().headers(), 'x-lis-user': QC } }));
  await page.goto(BASE + '/documents');
  await expect(page.getByText(/เอกสารในระบบ/)).toBeVisible({ timeout: 20000 });
  const pub = page.getByRole('row').filter({ hasText: STAMP + ' ทุกคนเห็น' });
  await expect(pub).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: STAMP + ' เฉพาะ Lab Head' })).toHaveCount(0);
  await expect(pub.getByRole('button', { name: 'ลบเอกสาร' })).toHaveCount(0);
  await pub.getByRole('button', { name: STAMP + ' ทุกคนเห็น' }).click();
  await expect(page.getByText('อ่านอย่างเดียว')).toBeVisible();
  await expect(page.getByRole('button', { name: 'บันทึก', exact: true })).toHaveCount(0);
  await expect(page.getByRole('toolbar')).toHaveCount(0);
  await expect(page.getByLabel('เนื้อหาเอกสาร')).toHaveAttribute('contenteditable', 'false');
  expect(errors).toEqual([]);
});

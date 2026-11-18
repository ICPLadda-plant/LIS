const { buildUsagePeriods, matchPetitions, petitionSubstanceKeys } = require('./standardPetitionUsage');

describe('standardPetitionUsage', () => {
  const units = [
    { _id: 'b', qrId: 'B', withdrawnDate: '2026-02-01' },
    { _id: 'a', qrId: 'A', withdrawnDate: '2026-01-01' },
    { _id: 'c', qrId: 'C', withdrawnDate: null },
  ];

  test('ขวดเดิมหมดเมื่อเบิกขวดถัดไป ขวดล่าสุดยังใช้อยู่ และขวดที่ยังไม่เบิกไม่มีช่วง', () => {
    const periods = buildUsagePeriods(units);
    expect(periods.map((p) => p.qrId)).toEqual(['A', 'B']);
    expect(periods[0].end.toISOString()).toBe(new Date('2026-02-01').toISOString());
    expect(periods[1].end).toBeNull();
  });

  test('แยกสารผสมด้วย + และใช้คำแรกตัวพิมพ์เล็ก', () => {
    const keys = petitionSubstanceKeys({ items: [{ commonName: 'AZOXYSTROBIN 20% + Difenoconazole 12.5% SC' }] });
    expect([...keys]).toEqual(['azoxystrobin', 'difenoconazole']);
  });

  test('จับคู่ใบนำส่งตามสารและช่วงวัน โดยวันสิ้นสุดไม่นับรวม', () => {
    const [a] = buildUsagePeriods(units);
    const petitions = [
      { petitionNo: 'P1', labReceivedAt: '2026-01-10', items: [{ commonName: 'Difenoconazole 25% EC' }] },
      { petitionNo: 'P2', labReceivedAt: '2026-02-01', items: [{ commonName: 'Difenoconazole 25% EC' }] },
      { petitionNo: 'P3', labReceivedAt: '2026-01-15', items: [{ commonName: 'Abamectin 1.8% EC' }] },
      { petitionNo: 'P4', createdAt: '2026-01-20', items: [{ commonName: 'X + DIFENOCONAZOLE' }] },
    ];
    const res = matchPetitions(a, petitions, 'Difenoconazole', ['P9']);
    expect(res.map((r) => [r.petitionNo, r.source])).toEqual([['P9', 'withdraw'], ['P1', 'inferred'], ['P4', 'inferred']]);
  });
});

import { describe, it, expect } from "vitest";
import { buildLabReportPages, buddhistDate } from "@/lib/labReport";
import type { Petition } from "@/types/petition.types";
import type { LabRequest } from "@/types/labRequest.types";
import type { ApprovalItemGroup } from "@/lib/qcApprovalRows";

const petition = {
  _id: "pt1",
  petitionNo: "P-2606-0018",
  dept: "production",
  submittedBy: { name: "สมชาย" },
  items: [
    {
      seq: 1,
      sampleName: "Gly",
      commonName: "Glyphosate",
      batchNo: "26RD-001",
      sampleId: "S1",
      condition: "normal",
      productionDate: "2026-01-10T00:00:00.000Z",
      submissionNo: "SUB-1",
      labelManufacturer: "ICP",
    },
    {
      seq: 2,
      sampleName: "Para",
      commonName: "Paraquat",
      batchNo: "26RD-002",
      sampleId: "S2",
      condition: "defective",
    },
  ],
  labReceivedAt: "2026-01-11T00:00:00.000Z",
  firstResultAt: "2026-01-12T00:00:00.000Z",
  labCompletedBy: "นุชจรินทร์",
  labApprovedAt: "2026-01-15T00:00:00.000Z",
  labApprovedBy: "นคร",
} as unknown as Petition;

const labRequests = [
  {
    _id: "lr1",
    labRequestNo: "LR-001",
    petitionId: "pt1",
    petitionNo: "P-2606-0018",
    batchNo: "26RD-001",
    sampleSeq: 1,
    reportCustomerName: "",
    requester: { fullName: "คุณเอ", department: "RD", email: "a@x.com", phone: "012" },
  },
] as unknown as LabRequest[];

const groups: ApprovalItemGroup[] = [
  {
    seq: 1,
    sampleName: "Gly",
    batchNo: "26RD-001",
    sampleId: "S1",
    commonName: "Glyphosate",
    unmatched: false,
    params: [
      {
        parameterId: "p1",
        parameterName: "ปริมาณสาร",
        scope: "lab",
        hasPhases: false,
        rows: [
          { key: "k1", label: "Glyphosate", unit: "%w/v", value: "48.2", standardText: "45.5-50.5", abnormal: false, note: "", phase: 1 },
        ],
      },
      {
        parameterId: "p2",
        parameterName: "pH (QC)",
        scope: "qc",
        hasPhases: false,
        rows: [
          { key: "k2", label: "pH", value: "7", standardText: "6-8", abnormal: false, note: "", phase: 1 },
        ],
      },
    ],
  },
];

describe("buddhistDate", () => {
  it("แปลงเป็น พ.ศ. dd/mm/yyyy", () => {
    expect(buddhistDate("2026-01-15T00:00:00.000Z")).toBe("15/01/2569");
  });
  it("ค่าว่าง → ''", () => {
    expect(buddhistDate(undefined)).toBe("");
    expect(buddhistDate(null)).toBe("");
  });
});

describe("buildLabReportPages", () => {
  const pages = buildLabReportPages(petition, labRequests, groups);

  it("สร้าง 1 หน้าต่อ 1 item", () => {
    expect(pages).toHaveLength(2);
  });

  it("map ข้อมูลลูกค้า/ตัวอย่าง หน้าแรกถูกต้อง", () => {
    const p = pages[0];
    expect(p.reportNo).toBe("LR-001");
    expect(p.reportDate).toBe("15/01/2569");
    expect(p.customer.name).toBe("คุณเอ"); // reportCustomerName ว่าง → requester.fullName
    expect(p.customer.company).toBe("บริษัท ไอ ซี พี ลัดดา จำกัด");
    expect(p.customer.department).toBe("RD");
    expect(p.customer.email).toBe("a@x.com");
    expect(p.sample.name).toBe("Glyphosate");
    expect(p.sample.sampleNo).toBe("S1");
    expect(p.sample.receivedDate).toBe("11/01/2569");
    expect(p.sample.reportedDate).toBe("15/01/2569");
    expect(p.sample.condition).toBe("ปกติ");
    expect(p.analystName).toBe("นุชจรินทร์");
    expect(p.labHeadName).toBe("นคร");
  });

  it("แถวผลกรองเฉพาะ scope=lab และใช้วิธีทดสอบตาม FM-QP-07-01-002", () => {
    const p = pages[0];
    expect(p.rows).toHaveLength(1); // qc row ถูกตัดออก
    expect(p.rows[0]).toEqual({
      testItem: "Glyphosate (%w/v)",
      result: "48.2",
      criteria: "45.5-50.5",
      method: "HPLC\nJ. Henriet and H.H. Povlsen. 1988. Analysis of Technical and Formulated Pesticides. CIPAC Handbook. Vol. D. P. 100-105.",
    });
  });

  it("แถวที่ไม่ใช่สารออกฤทธิ์ยังแสดงวิธีทดสอบเป็น '-'", () => {
    const [page] = buildLabReportPages(petition, labRequests, [
      { ...groups[0], params: [{ ...groups[0].params[0], parameterName: "ความหนาแน่น", rows: [{ ...groups[0].params[0].rows[0], label: "Density" }] }] },
    ]);
    expect(page.rows[0].method).toBe("-");
  });

  it("prints only the head reviewer range and keeps the percent unit for label tolerance criteria", () => {
    const labelToleranceGroups: ApprovalItemGroup[] = [
      {
        ...groups[0],
        params: [
          {
            ...groups[0].params[0],
            rows: [
              {
                ...groups[0].params[0].rows[0],
                standardText: "ผ่าน 48.13–51.88 · เกณฑ์กรม 47.50–52.50 %",
              },
            ],
          },
        ],
      },
    ];
    const out = buildLabReportPages(petition, labRequests, labelToleranceGroups);
    expect(out[0].rows[0].criteria).toBe("47.50–52.50 %");
  });

  it("item ที่ไม่มี group → rows ว่าง + fallback ลูกค้า", () => {
    const p = pages[1];
    expect(p.rows).toHaveLength(0);
    expect(p.customer.name).toBe("สมชาย"); // ไม่มี labRequest → submittedBy.name
    expect(p.customer.department).toBe("แผนกผลิต"); // PETITION_DEPT_LABELS[production]
    expect(p.sample.condition).toBe("บกพร่อง");
  });

  it("ชื่อในข้อมูลลูกค้าใช้ชื่อผู้ขอบริการ ไม่ใช้ชื่อบริษัทผู้ส่งตัวอย่าง", () => {
    const lr2 = [{ ...labRequests[0], reportCustomerName: "ICP Ladda Co., LTD." }] as unknown as LabRequest[];
    const out = buildLabReportPages(petition, lr2, groups);
    expect(out[0].customer.name).toBe("คุณเอ");
    expect(out[0].customer.company).toBe("ICP Ladda Co., LTD.");
  });

  it("สภาพตัวอย่างใช้ค่าลักษณะจาก parameter กายภาพ", () => {
    const physicalGroups: ApprovalItemGroup[] = [
      {
        ...groups[0],
        params: [
          ...groups[0].params,
          {
            parameterId: "physical",
            parameterName: "กายภาพ",
            scope: "qc",
            hasPhases: false,
            rows: [
              { key: "physical__appearance", label: "ลักษณะ", value: "ของเหลวใส", standardText: "", abnormal: false, note: "", phase: 1 },
              { key: "physical__color", label: "สี", value: "สีส้ม", standardText: "", abnormal: false, note: "", phase: 1 },
            ],
          },
        ],
      },
    ];
    const out = buildLabReportPages(petition, labRequests, physicalGroups);
    expect(out[0].sample.condition).toBe("ของเหลวใส สีส้ม");
    expect(out[0].rows).toHaveLength(1);
  });
});

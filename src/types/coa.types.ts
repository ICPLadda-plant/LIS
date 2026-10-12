export type CoaStatus =
  | "requested"
  | "draft"
  | "pendingApproval"
  | "approved"
  | "printed"
  | "revisionDraft"
  | "pendingRevisionApproval"
  | "reissued"
  | "cancelled"
  | "superseded"
  | "rejected";

export type CoaPerson = { name?: string; email?: string; role?: string };

export type CoaFormSelection = {
  itemSeq: number;
  resultKeys?: string[];
  aiKey?: string;
  appearanceKey?: string;
  appearanceSource?: string;
  appearanceSpecification?: string;
  appearanceResult?: "Conform" | "Not conform" | "";
  densityKey?: string;
};

export type CoaSourceResult = {
  key: string;
  itemSeq: number;
  kind: "ai" | "appearance" | "density" | "result";
  label: string;
  result: string;
  suggestedEnglish?: string;
  testItem?: string;
  criteria?: string;
  unit?: string;
};

export type CoaSampleSnapshot = {
  itemSeq: number;
  sampleName?: string;
  commonName?: string;
  batchNo?: string;
  lotNo?: string;
  productionDate?: string;
  sampleId?: string;
  condition?: string;
  manufacturer?: string;
};

export type CoaResultSnapshot = {
  itemSeq: number;
  testItem?: string;
  result?: string;
  criteria?: string;
  method?: string;
  unit?: string;
};

export type CoaTrendSnapshot = {
  itemSeq: number;
  sampleName?: string;
  commonName?: string;
  aiLabelPercent?: number;
  aiResultPercent?: number;
  aiResultText?: string;
};

export type CoaAuditLogEntry = {
  _id: string;
  event: string;
  actor?: CoaPerson;
  note?: string;
  createdAt: string;
};

export type ExternalCoaRequestSnapshot = {
  companySource?: string;
  saleName?: string;
  saleOrderNo?: string;
  line?: number;
  saleOrderDate?: string;
  itemNo?: string;
  appearance?: string;
  packingSize?: string;
  quantity?: number;
  outstandingQty?: number;
  unit?: string;
  pendingStatus?: string;
  pendingStatusDetail?: string;
  shipmentDate?: string;
  remark?: string;
};

export type CoaDocument = {
  sourceType?: "lab" | "erpManual";
  externalRequestId?: string;
  _id: string;
  coaNo?: string | null;
  coaYear?: number;
  sequence?: number;
  revision: number;
  status: CoaStatus;
  entryMode?: "source" | "manual";
  petitionId?: string;
  petitionNoSnapshot?: string;
  selectedItemSeqs: number[];
  sourceCoaId?: string;
  supersededByCoaId?: string;
  customerSnapshot?: { name?: string; company?: string; department?: string; email?: string; phone?: string };
  sampleSnapshots: CoaSampleSnapshot[];
  resultSnapshots: CoaResultSnapshot[];
  trendSnapshots?: CoaTrendSnapshot[];
  formSelections?: CoaFormSelection[];
  remark?: string;
  approval?: {
    submittedBy?: CoaPerson;
    submittedAt?: string;
    approvedBy?: CoaPerson;
    approvedAt?: string;
    rejectedBy?: CoaPerson;
    rejectedAt?: string;
    rejectReason?: string;
  };
  cancel?: { cancelledBy?: CoaPerson; cancelledAt?: string; reason?: string };
  print?: { printCount?: number; lastPrintedAt?: string; lastPrintedBy?: CoaPerson };
  audit?: CoaAuditLogEntry[];
  createdBy?: CoaPerson;
  updatedBy?: CoaPerson;
  createdAt?: string;
  updatedAt?: string;
  externalCoaRequest?: ExternalCoaRequestSnapshot;
};

export type ManualCoaInput = {
  externalRequestId: string;
  sample: CoaSampleSnapshot;
  results: CoaResultSnapshot[];
  remark?: string;
  _user?: unknown;
};

export type CoaErpAutofill = {
  externalRequestId: string;
  source: {
    petitionNo?: string;
    customerSnapshot?: CoaDocument["customerSnapshot"];
    externalCoaRequest?: CoaDocument["externalCoaRequest"];
  };
  sample: CoaSampleSnapshot;
  results: CoaResultSnapshot[];
  match: {
    petitionId: string;
    petitionNo?: string;
    itemSeq: number;
    batchNo?: string;
    matchKind: "exact" | "close" | "none";
    batchScore: number;
  } | null;
  candidates: Array<{
    petitionId: string;
    petitionNo?: string;
    itemSeq: number;
    sampleName?: string;
    commonName?: string;
    batchNo?: string;
    batchScore: number;
    matchKind: "exact" | "close" | "none";
    labApprovedAt?: string | null;
  }>;
  stockCandidates: Array<{ lotNo: string; productionDate: string; quantity: number; itemNo: string }>;
  mfCandidates: Array<{ batchNo: string; productionDate: string; itemNo: string }>;
  form: { template: "standard" | "grWpSp" | "liquid" | "bromadiolone0005"; aiCriteria: string; needsDensity: boolean };
  warnings: string[];
  dataSources: { erp: boolean; stock: boolean; mf: boolean; lab: boolean; density: boolean };
};

export type CoaLabAiLookup = {
  batchNo: string;
  commonName: string;
  ai: {
    testItem?: string;
    result?: string;
    criteria?: string;
    method?: string;
    unit?: string;
  } | null;
  analysisDate: string;
  match: {
    petitionId: string;
    petitionNo?: string;
    itemSeq: number;
    batchNo?: string;
  } | null;
};

export type EligibleCoaPetition = {
  _id: string;
  petitionNo: string;
  labApprovedAt?: string;
  submittedBy?: { name?: string; email?: string };
  items: Array<{
    seq: number;
    sampleName?: string;
    commonName?: string;
    batchNo?: string;
    lotNo?: string;
    productionDate?: string;
    activeCoa?: {
      coaId: string;
      coaNo: string;
      revision: number;
      petitionNo?: string;
      commonName?: string;
      batchNo?: string;
      productionDate?: string;
    } | null;
  }>;
};

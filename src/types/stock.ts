export type StockTier = "primary" | "supplier" | "working";

export interface StandardTier {
  qty: number;
  sizeMg: number | string | null;
  exp: string;
}

export interface StandardPrimary extends StandardTier {
  ordered: number;
  usesPerBottle: number | string | null;
  pricePerUnit: number;
  totalPrice: number | string;
}

export interface StockStandardItem {
  _id: string;
  code: string;
  name: string;
  barcodes?: string[];
  primary: StandardPrimary;
  supplier: StandardTier;
  working: StandardTier;
  usagePerUseMg: number | string | null;
  frequency: string;
  openShelfLife?: OpenShelfLife;
  storageTemp: string;
  status: string;
  expiryStatus: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StockSolventItem {
  _id: string;
  name: string;
  barcodes?: string[];
  sizeLiter: number;
  qty: number;
  price: number;
  note: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StockGlasswareItem {
  _id: string;
  name: string;
  barcodes?: string[];
  qty: number;
  pricePerPiece: number;
  note: string;
  createdAt?: string;
  updatedAt?: string;
}

export type StockItemType = "standard" | "solvent" | "glassware";
export type StockAction = "create" | "update" | "delete" | "deduct" | "receive" | "withdraw" | "discard";
export type DeductionResolutionReason = "empty" | "ineffective" | "other" | "expired";

export interface DeductionResolution {
  reason: DeductionResolutionReason;
  note?: string;
  resolvedAt?: string;
  resolvedBy?: { email?: string; name?: string };
}

export interface StockTransactionItem {
  _id: string;
  itemType: StockItemType;
  itemId: string;
  itemCode?: string;
  itemName?: string;
  action: StockAction;
  tier?: StockTier | null;
  beforeQty?: number | null;
  afterQty?: number | null;
  delta?: number | null;
  volumeDelta?: number | null;
  weights?: number[];
  instrumentId?: string;
  instrumentName?: string;
  instrumentGroup?: "gc" | "hplc" | null;
  qrId?: string;
  unit?: string;
  volumeUnit?: string;
  sampleId?: string;
  note?: string;
  deductionResolution?: DeductionResolution;
  photoUrls?: string[];
  userEmail?: string;
  userName?: string;
  createdAt: string;
}

export type ShelfUnit = "day" | "week" | "month";
export interface OpenShelfLife {
  value: number;
  unit: ShelfUnit;
}

export type StockUnitKind = "sealed" | "working";
export type StockUnitSource = "primary" | "supply" | "";
export type StockUnitStatus = "active" | "empty" | "discarded";

export interface StockUnitVolume {
  initial: number;
  remaining: number;
  unit: "ml" | "mg" | "g";
}

export interface StockUnitItem {
  _id: string;
  qrId: string;
  itemCode: string;
  itemName: string;
  itemType?: StockItemType;
  itemId?: string;
  kind: StockUnitKind;
  source?: StockUnitSource;
  type?: "primary" | "supplier" | "working" | "";
  parentId?: string | null;
  lotNo?: string;
  purity?: string | number | null;
  lotBottleNo?: number | null;
  labelCode?: string;
  labelRunNo?: number | null;
  labelRunYear?: number | null;
  exp?: string | null;
  frequencyDue?: string | null;
  volume: StockUnitVolume;
  status: StockUnitStatus;
  receivedDate?: string | null;
  withdrawnDate?: string | null;
  petitionUsage?: {
    start: string | null;
    end: string | null;
    petitions: { petitionNo: string; petitionId?: string; source: "withdraw" | "inferred"; date: string | null }[];
    computedAt?: string;
  };
  discardedAt?: string | null;
  discardedBy?: { email?: string; name?: string };
  discardReason?: string;
  createdBy?: { email?: string; name?: string };
  photoUrls?: string[];
  createdAt?: string;
  updatedAt?: string;
}

/** 1 แถวของแท็บ "กำลังใช้งานอยู่" — การเบิก standard ที่ยังไม่ปิด (มาจาก GET /stock/standards/in-use) */
export interface StandardInUseItem {
  _id: string;
  itemCode: string;
  itemName: string;
  qrId: string;
  weights: number[];
  totalMg: number;
  instrumentGroup: "gc" | "hplc" | null;
  note: string;
  withdrawnAt: string;
  frequency: string;
  /** null = สารนี้ยังไม่ได้ตั้งความถี่ (ไม่มีวันครบกำหนด, ไม่แจ้งเตือน) */
  dueAt: string | null;
  userEmail: string;
  userName: string;
}

export interface StandardsInUseResponse {
  serverTime: string;
  items: StandardInUseItem[];
}

export interface SixMonthMedicineStockItem {
  companySource: string;
  commonName?: string;
  itemName?: string;
  itemNo: string;
  locationCode: string;
  binCode: string;
  lotNo: string;
  registeringDate: string;
  unit: string;
  stockQty: number;
  stockQtyBase: number;
  ageMonths: number;
}

export interface SixMonthMedicineStockResponse {
  serverTime: string;
  referenceMonth: string;
  items: SixMonthMedicineStockItem[];
}

export type StockPublicScanItem =
  | {
      kind: "standard";
      qrId: string;
      itemCode: string;
      itemName: string;
      type?: "primary" | "supplier" | "working" | "";
      lotNo?: string;
      lotBottleNo?: number | null;
      labelCode?: string;
      exp?: string | null;
      volume: StockUnitVolume;
      status: StockUnitStatus;
      photoUrls?: string[];
      updatedAt?: string;
    }
  | {
      kind: "solvent";
      id: string;
      qrId: string;
      name: string;
      sizeLiter: number;
      qty: number;
      lotNo?: string;
      lotBottleNo?: number | null;
      exp?: string | null;
      volume?: StockUnitVolume;
      status?: StockUnitStatus;
      note?: string;
      latestReceiveNote?: string;
      photoUrls?: string[];
      updatedAt?: string;
    };

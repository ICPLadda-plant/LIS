import type { DailyCheckRecord, EnvCheckRecord, EquipmentCheckRecord } from "./api";
import { BALANCE_SCALES } from "./balanceControlChart";
import { getDailyCheckPeriod, type DailyCheckPeriod } from "./dailyCheckPeriod";
import { getRoomBySlug } from "./dailyCheckRooms";
import { EQUIPMENT_ROOM_SLUGS } from "./roomEquipment";

export const ENVIRONMENT_RECORD_ROOM_SLUG = "environment";

export type DailyCheckRecordStatus = "normal" | "abnormal";

export type DailyCheckRecordReading = {
  key: string;
  label: string;
  value: number | string;
  unit: string;
};

export type DailyCheckRecordRow = Omit<EquipmentCheckRecord, "readings"> & {
  roomName?: string;
  readings: DailyCheckRecordReading[];
};

export type DailyCheckRecordFilters = {
  room?: string;
  instrumentId?: string;
  status?: DailyCheckRecordStatus | "all";
  period?: DailyCheckPeriod | "all";
};

export type DailyCheckRecordRoomOption = {
  value: string;
  label: string;
};

export type DailyCheckRecordInput = {
  equipmentRecords?: EquipmentCheckRecord[];
  balanceRecords?: DailyCheckRecord[];
  envRecords?: EnvCheckRecord[];
};

const BALANCE_ROOM_NAME = "ห้องเครื่องชั่ง";
const ENVIRONMENT_ROOM_NAME = "อุณหภูมิ/ความชื้น";

export const DAILY_CHECK_RECORD_ROOM_OPTIONS: DailyCheckRecordRoomOption[] = [
  { value: ENVIRONMENT_RECORD_ROOM_SLUG, label: ENVIRONMENT_ROOM_NAME },
  { value: "balance", label: BALANCE_ROOM_NAME },
  ...EQUIPMENT_ROOM_SLUGS.map((slug) => ({
    value: slug,
    label: getRoomBySlug(slug)?.label ?? slug,
  })),
];

const rowId = (prefix: string, id: string | undefined, fallback: string) =>
  `${prefix}-${id || fallback}`;

const fixed = (value: number | undefined, digits: number) =>
  Number.isFinite(value) ? value!.toFixed(digits) : "";

const textValue = (value: unknown) => (value == null ? "" : String(value));

const normalizeEquipmentRecord = (record: EquipmentCheckRecord): DailyCheckRecordRow => ({
  ...record,
  _id: rowId("equipment", record._id, `${record.roomSlug}-${record.instrumentId}-${record.checkedAt}`),
  roomName: getRoomBySlug(record.roomSlug)?.label ?? record.roomSlug,
});

const normalizeBalanceRecord = (record: DailyCheckRecord): DailyCheckRecordRow => {
  const primaryWeight = BALANCE_SCALES.find((scale) => scale.id === record.scaleId)?.primaryCalibrationWeight ?? 100;
  return ({
  _id: rowId("balance", record._id, `${record.scaleId}-${record.checkedAt}`),
  roomSlug: "balance",
  roomName: BALANCE_ROOM_NAME,
  instrumentId: record.scaleId,
  instrumentName: record.scaleName,
  brand: record.model,
  status: record.status === "pass" ? "normal" : "abnormal",
  readings: [
    ...record.weights100.map((value, index) => ({
      key: `weight100-${index + 1}`,
      label: `${primaryWeight}g #${index + 1}`,
      value: textValue(value),
      unit: "g",
    })),
    { key: "avg100", label: `เฉลี่ย ${primaryWeight}g`, value: fixed(record.avg100, 4), unit: "g" },
    ...record.weights10.map((value, index) => ({
      key: `weight10-${index + 1}`,
      label: `10g #${index + 1}`,
      value: textValue(value),
      unit: "g",
    })),
    { key: "avg10", label: "เฉลี่ย 10g", value: fixed(record.avg10, 4), unit: "g" },
  ],
  note: undefined,
  recorder: record.recorder,
  recorderId: record.recorderId,
  recorderEmail: record.recorderEmail,
  date: record.date,
  period: record.period,
  checkedAt: record.checkedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  });
};

const normalizeEnvRecord = (record: EnvCheckRecord): DailyCheckRecordRow => ({
  _id: rowId("env", record._id, `${record.room}-${record.checkedAt}`),
  roomSlug: ENVIRONMENT_RECORD_ROOM_SLUG,
  roomName: ENVIRONMENT_ROOM_NAME,
  instrumentId: `env:${record.room}`,
  instrumentName: `${ENVIRONMENT_ROOM_NAME} (${record.roomName})`,
  status: record.status === "pass" ? "normal" : "abnormal",
  readings: [
    { key: "temperature", label: "อุณหภูมิ", value: textValue(record.temperature), unit: "°C" },
    { key: "humidity", label: "ความชื้น", value: textValue(record.humidity), unit: "%RH" },
  ],
  note: record.note,
  recorder: record.recorder,
  recorderId: record.recorderId,
  recorderEmail: record.recorderEmail,
  date: record.date,
  period: record.period,
  checkedAt: record.checkedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

export const normalizeDailyCheckRecordRows = ({
  equipmentRecords = [],
  balanceRecords = [],
  envRecords = [],
}: DailyCheckRecordInput): DailyCheckRecordRow[] => {
  const rows = [
    ...equipmentRecords.map(normalizeEquipmentRecord),
    ...balanceRecords.map(normalizeBalanceRecord),
    ...envRecords.map(normalizeEnvRecord),
  ];
  return rows.sort((a, b) => (a.checkedAt < b.checkedAt ? 1 : a.checkedAt > b.checkedAt ? -1 : 0));
};

export const filterDailyCheckRecordRows = (
  rows: DailyCheckRecordRow[],
  { room, instrumentId, status, period }: DailyCheckRecordFilters,
): DailyCheckRecordRow[] =>
  rows.filter((row) => {
    if (room && room !== "all" && row.roomSlug !== room) return false;
    if (instrumentId && instrumentId !== "all" && row.instrumentId !== instrumentId) return false;
    if (status && status !== "all" && row.status !== status) return false;
    if (period && period !== "all") {
      const recordPeriod = row.period ?? getDailyCheckPeriod(row.checkedAt);
      if (recordPeriod !== period) return false;
    }
    return true;
  });

export const dailyCheckRecordInstrumentLabel = (row: Pick<DailyCheckRecordRow, "instrumentId" | "instrumentName">) =>
  row.instrumentId.startsWith("env:") ? row.instrumentName : `${row.instrumentName} (${row.instrumentId})`;

export const getDailyCheckRecordInstrumentOptions = (
  rows: DailyCheckRecordRow[],
  room: string,
): DailyCheckRecordRoomOption[] => {
  if (!room || room === "all") return [];
  const byId = new Map<string, string>();
  rows.forEach((row) => {
    if (row.roomSlug !== room) return;
    byId.set(row.instrumentId, dailyCheckRecordInstrumentLabel(row));
  });
  return Array.from(byId, ([value, label]) => ({ value, label })).sort((a, b) =>
    a.label.localeCompare(b.label, "th"),
  );
};

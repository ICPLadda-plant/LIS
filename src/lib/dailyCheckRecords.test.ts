import { describe, expect, it } from "vitest";
import type { DailyCheckRecord, EnvCheckRecord, EquipmentCheckRecord } from "./api";
import {
  ENVIRONMENT_RECORD_ROOM_SLUG,
  filterDailyCheckRecordRows,
  getDailyCheckRecordInstrumentOptions,
  normalizeDailyCheckRecordRows,
} from "./dailyCheckRecords";

const equipmentRecord = (over: Partial<EquipmentCheckRecord> = {}): EquipmentCheckRecord => ({
  _id: "eq-1",
  roomSlug: "analysis",
  instrumentId: "LD-003",
  instrumentName: "GC 7890A",
  status: "normal",
  readings: [{ key: "temp", label: "อุณหภูมิ", value: 25, unit: "°C" }],
  note: "",
  recorder: "สมชาย",
  date: "2026-09-04",
  checkedAt: "2026-09-04T02:00:00.000Z",
  ...over,
});

const balanceRecord = (over: Partial<DailyCheckRecord> = {}): DailyCheckRecord => ({
  _id: "bal-1",
  scaleId: "scale-1",
  scaleName: "เครื่องชั่ง 1",
  model: "Balance A",
  weights100: ["100.0001", "100.0002", "100.0003"],
  weights10: ["10.0001", "10.0002", "10.0003"],
  avg100: 100.0002,
  avg10: 10.0002,
  status100: "pass",
  status10: "pass",
  status: "pass",
  recorder: "สมชาย",
  date: "2026-09-04",
  checkedAt: "2026-09-04T03:00:00.000Z",
  ...over,
});

const envRecord = (over: Partial<EnvCheckRecord> = {}): EnvCheckRecord => ({
  _id: "env-1",
  room: "sample-prep",
  roomName: "ห้องเตรียมตัวอย่าง",
  temperature: 22.9,
  humidity: 60.3,
  tempMin: 15,
  tempMax: 25,
  humidityMax: 70,
  tempStatus: "pass",
  humidityStatus: "pass",
  status: "pass",
  note: "",
  recorder: "สมหญิง",
  date: "2026-09-04",
  checkedAt: "2026-09-04T04:00:00.000Z",
  ...over,
});

describe("daily check record rows", () => {
  it("normalizes equipment, balance, and environment records into one newest-first list", () => {
    const rows = normalizeDailyCheckRecordRows({
      equipmentRecords: [equipmentRecord()],
      balanceRecords: [balanceRecord()],
      envRecords: [envRecord({ humidityStatus: "fail", status: "fail", note: "ชื้นสูง" })],
    });

    expect(rows.map((row) => row._id)).toEqual(["env-env-1", "balance-bal-1", "equipment-eq-1"]);
    expect(rows[0]).toMatchObject({
      roomSlug: ENVIRONMENT_RECORD_ROOM_SLUG,
      roomName: "อุณหภูมิ/ความชื้น",
      instrumentId: "env:sample-prep",
      instrumentName: "อุณหภูมิ/ความชื้น (ห้องเตรียมตัวอย่าง)",
      status: "abnormal",
      note: "ชื้นสูง",
    });
    expect(rows[0].readings).toEqual([
      { key: "temperature", label: "อุณหภูมิ", value: "22.9", unit: "°C" },
      { key: "humidity", label: "ความชื้น", value: "60.3", unit: "%RH" },
    ]);
    expect(rows[1]).toMatchObject({
      roomSlug: "balance",
      roomName: "ห้องเครื่องชั่ง",
      instrumentId: "scale-1",
      instrumentName: "เครื่องชั่ง 1",
      status: "normal",
    });
    expect(rows[1].readings).toContainEqual({ key: "avg100", label: "เฉลี่ย 500g", value: "100.0002", unit: "g" });
  });

  it("filters normalized rows by room, instrument, status, and period", () => {
    const rows = normalizeDailyCheckRecordRows({
      equipmentRecords: [equipmentRecord({ period: "morning" })],
      balanceRecords: [balanceRecord({ period: "afternoon" })],
      envRecords: [envRecord({ status: "fail" })],
    });

    expect(filterDailyCheckRecordRows(rows, { room: "balance" }).map((row) => row._id)).toEqual(["balance-bal-1"]);
    expect(filterDailyCheckRecordRows(rows, { room: ENVIRONMENT_RECORD_ROOM_SLUG }).map((row) => row._id)).toEqual(["env-env-1"]);
    expect(filterDailyCheckRecordRows(rows, { instrumentId: "LD-003" }).map((row) => row._id)).toEqual(["equipment-eq-1"]);
    expect(filterDailyCheckRecordRows(rows, { status: "abnormal" }).map((row) => row._id)).toEqual(["env-env-1"]);
    expect(filterDailyCheckRecordRows(rows, { period: "afternoon" }).map((row) => row._id)).toEqual(["balance-bal-1"]);
  });

  it("derives instrument options from rows for the selected records room", () => {
    const rows = normalizeDailyCheckRecordRows({
      equipmentRecords: [equipmentRecord()],
      balanceRecords: [balanceRecord()],
      envRecords: [envRecord()],
    });

    expect(getDailyCheckRecordInstrumentOptions(rows, "balance")).toEqual([
      { value: "scale-1", label: "เครื่องชั่ง 1 (scale-1)" },
    ]);
    expect(getDailyCheckRecordInstrumentOptions(rows, ENVIRONMENT_RECORD_ROOM_SLUG)).toEqual([
      { value: "env:sample-prep", label: "อุณหภูมิ/ความชื้น (ห้องเตรียมตัวอย่าง)" },
    ]);
  });
});

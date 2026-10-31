import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  TrendingUp,
  Gauge,
  Users,
  Database,
  Activity,
  History,
} from "lucide-react";

export type TabDef = {
  key: string; // Radix Tabs value
  label: string; // shown in the page tab bar AND the matrix
  icon?: LucideIcon; // optional trigger icon
  adminOnly?: boolean; // always admin-gated; not role-configurable, hidden from matrix
};

export const DENY_PREFIX = "deny:";

// key = parent nav path (must match NAV_ITEMS path). Order = tab bar order.
export const TAB_REGISTRY: Record<string, TabDef[]> = {
  "/stock": [
    { key: "standard", label: "Standards" },
    { key: "solvent", label: "สารเคมี" },
    { key: "glassware", label: "เครื่องแก้ว" },
    { key: "history", label: "ประวัติ" },
  ],
  "/settings": [
    { key: "environment", label: "ห้องตรวจสภาพแวดล้อม" },
    { key: "printers", label: "เครื่องพิมพ์เอกสาร" },
    { key: "doc-numbers", label: "รหัสเอกสาร" },
    { key: "instruments", label: "เครื่องมือ/API" },
    { key: "dashboard", label: "แดชบอร์ด" },
    { key: "line", label: "LINE", adminOnly: true },
    { key: "api-keys", label: "API Key", adminOnly: true },
  ],
  "/report": [
    { key: "dashboard", label: "Dashboard ภาพรวม", icon: LayoutDashboard },
    { key: "trend", label: "%AI", icon: TrendingUp },
    { key: "oee", label: "OEE เครื่องวิเคราะห์", icon: Gauge },
    { key: "workload", label: "Workload บุคลากร", icon: Users },
  ],
  "/admin-data": [
    { key: "database", label: "ฐานข้อมูลผลลัพธ์", icon: Database },
    { key: "activelog", label: "Active Log", icon: Activity },
    { key: "auditlog", label: "Audit Log", icon: History },
  ],
  // server ตรวจ deny token เดียวกันที่ server/lib/qcApprovalAccess.js (อนุมัติรายรายการ / Final Result)
  "/qc-approval": [
    { key: "qc", label: "ผล QC" },
    { key: "lab", label: "ผล Lab" },
  ],
};

export const tabPath = (parent: string, key: string) => `${parent}/${key}`;
export const denyToken = (parent: string, key: string) =>
  `${DENY_PREFIX}${tabPath(parent, key)}`;

export const tabsFor = (parent: string): TabDef[] => TAB_REGISTRY[parent] ?? [];

export const configurableTabsFor = (parent: string): TabDef[] =>
  tabsFor(parent).filter((t) => !t.adminOnly);

export const isTabDenied = (
  permissions: string[],
  parent: string,
  key: string,
): boolean => permissions.includes(denyToken(parent, key));

export const PAGES_WITH_TABS = Object.keys(TAB_REGISTRY);

import {
  ClipboardList,
  Clock,
  Database,
  FileBarChart,
  FileCheck2,
  FileText,
  FlaskConical,
  Gauge,
  Home,
  LockKeyhole,
  Monitor,
  Network,
  Package,
  Scale,
  ScanLine,
  Settings,
  SlidersHorizontal,
  ShieldCheck,
  UserCheck,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  icon: LucideIcon;
  label: string;
  path: string;
};

export const LAB_ASSIGN_PATH = "/petition/assign";

export const NAV_ITEMS: NavItem[] = [
  { icon: ShieldCheck, label: "Validation", path: "/validation" },
  { icon: Home, label: "หน้าแรก", path: "/home" },
  { icon: FileText, label: "รายการคำร้อง", path: "/petition" },
  { icon: FlaskConical, label: "เงื่อนไขส่ง Lab", path: "/lab-send-conditions" },
  { icon: ClipboardList, label: "ผลวิเคราะห์", path: "/record-results" },
  { icon: ClipboardList, label: "ผลวิเคราะห์ Lab", path: "/lab-results" },
  { icon: FileCheck2, label: "ออกเอกสาร COA", path: "/coa" },
  { icon: FileText, label: "แบบฟอร์มเปล่า", path: "/blank-form" },
  { icon: ClipboardList, label: "การเบิก stock", path: "/stock-deduction" },
  { icon: Scale, label: "Daily Check", path: "/daily-check" },
  { icon: Network, label: "Virtual Lab", path: "/virtual-lab" },
  { icon: Clock, label: "Standard Time", path: "/standard-time" },
  { icon: FileBarChart, label: "รายงานสรุป", path: "/report" },
  { icon: ShieldCheck, label: "อนุมัติผล QC", path: "/qc-approval" },
  { icon: ShieldCheck, label: "อนุมัติผล Lab", path: "/lab-approval" },
  { icon: FlaskConical, label: "การทดสอบ QC", path: "/qc-testing" },
  { icon: FlaskConical, label: "การทดสอบ Lab", path: "/lab-testing" },
  { icon: Gauge, label: "ผล Density", path: "/density-results" },
  { icon: UserCheck, label: "Assign Lab", path: "/petition/assign" },
  { icon: Package, label: "Stock Management", path: "/stock" },
  { icon: Database, label: "Master Item", path: "/master-items" },
  { icon: FlaskConical, label: "Simple Method", path: "/simple-method" },
  { icon: FileText, label: "Full spec", path: "/full-spec" },
  { icon: Wrench, label: "รายการเครื่อง", path: "/machines" },
  { icon: Database, label: "Admin Data", path: "/admin-data" },
  { icon: SlidersHorizontal, label: "พารามิเตอร์ตรวจสอบ", path: "/parameter-settings" },
  { icon: LockKeyhole, label: "Access Control", path: "/access-control" },
  { icon: Settings, label: "ตั้งค่าระบบ", path: "/settings" },
];

export const PAGE_ITEMS: NavItem[] = [
  ...NAV_ITEMS,
  { icon: FileText, label: "New Petition", path: "/petitions/new" },
  { icon: ClipboardList, label: "Analysis Result Detail", path: "/record-results/:id" },
  { icon: ClipboardList, label: "รายละเอียดผล Lab", path: "/lab-results/:id" },
  { icon: ScanLine, label: "Scanner", path: "/scanner" },
  { icon: FlaskConical, label: "QC Testing Detail", path: "/qc-testing/:id" },
  { icon: FlaskConical, label: "Lab Testing Detail", path: "/lab-testing/:id" },
  { icon: Monitor, label: "Lab Queue TV", path: "/queue/lab" },
  { icon: Monitor, label: "QC Queue TV", path: "/queue/qc" },
  { icon: FileCheck2, label: "รายละเอียด COA", path: "/coa/:id" },
];

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { formatDateTime } from "@/lib/dateTime";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Database, Search, Download, Activity, History, ExternalLink } from "lucide-react";
import { useSamples } from "@/context/SampleContext";
import { doneSamples } from "@/data/mockData";
import { usePetitionAuditLogList } from "@/hooks/usePetition";
import {
  PETITION_AUDIT_EVENT_LABELS,
  PETITION_STATUS_CONFIG,
  type PetitionAuditEvent,
  type PetitionStatus,
} from "@/types/petition.types";
import { useAccessibleTabs } from "@/hooks/useAccessibleTabs";
import { rankSearchResults } from "@/lib/searchRanking";

const EVENT_VARIANT: Record<PetitionAuditEvent, "gray-soft" | "primary-soft" | "yellow-soft" | "blue-soft" | "green-soft" | "red-soft"> = {
  created: "primary-soft",
  statusChanged: "blue-soft",
  assigned: "yellow-soft",
  reviewed: "green-soft",
  updated: "gray-soft",
  deleted: "red-soft",
  received: "primary-soft",
  resultEntered: "green-soft",
  resultUpdated: "yellow-soft",
};

function statusLabel(status?: string) {
  if (!status) return null;
  return PETITION_STATUS_CONFIG[status as PetitionStatus]?.label ?? status;
}

// Mock Active Log data
const activeLogData = [
  { id: "LOG-001", sampleId: "LAB-2602-002", drugName: "2,4-D Dimethylamine 72% SL", instrument: "HPLC-01", firstInjection: "2026-02-07 08:15:22", lastInjection: "2026-02-07 11:42:18", totalInjections: 12, runtime: "3h 27m" },
  { id: "LOG-002", sampleId: "LAB-2602-006", drugName: "Metalaxyl 25% WP", instrument: "GC-01", firstInjection: "2026-02-06 09:05:10", lastInjection: "2026-02-06 13:18:45", totalInjections: 8, runtime: "4h 13m" },
  { id: "LOG-003", sampleId: "LAB-2602-009", drugName: "Lambda-Cyhalothrin 2.5% EC", instrument: "HPLC-03", firstInjection: "2026-02-06 10:30:00", lastInjection: "2026-02-06 14:55:30", totalInjections: 15, runtime: "4h 25m" },
  { id: "LOG-004", sampleId: "LAB-2602-011", drugName: "Propiconazole 25% EC", instrument: "GC-03", firstInjection: "2026-02-05 08:00:15", lastInjection: "2026-02-05 12:22:50", totalInjections: 10, runtime: "4h 22m" },
];

const AdminData = () => {
  const navigate = useNavigate();
  const { approvals } = useSamples();
  const [search, setSearch] = useState("");
  const [logSearch, setLogSearch] = useState("");
  const { data: auditData, loading: auditLoading, error: auditError } = usePetitionAuditLogList({ page: 1, limit: 10 });
  const { tabs, defaultKey } = useAccessibleTabs("/admin-data");

  // Only show QC-approved records (complete results)
  const approvedRecords = doneSamples
    .filter(s => {
      const approval = approvals[s.id];
      return approval?.qcStatus === "approved" || approval?.qcStatus === "rejected";
    })
    .map(s => ({
      ...s,
      qcResult: approvals[s.id]?.qcStatus === "approved" ? "ผ่าน" : "ไม่ผ่าน",
      qcNote: approvals[s.id]?.qcNote,
    }));

  const filtered = rankSearchResults(approvedRecords.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase()) ||
    r.id.toLowerCase().includes(search.toLowerCase()) ||
    (r.receiver || "").toLowerCase().includes(search.toLowerCase())
  ), search, (record) => ({
    primary: [record.id || record.name],
    secondary: [record.name, record.receiver],
  }));

  const filteredLogs = rankSearchResults(activeLogData.filter(l =>
    l.sampleId.toLowerCase().includes(logSearch.toLowerCase()) ||
    l.drugName.toLowerCase().includes(logSearch.toLowerCase()) ||
    l.instrument.toLowerCase().includes(logSearch.toLowerCase())
  ), logSearch, (log) => ({
    primary: [log.sampleId, log.instrument],
    secondary: [log.drugName],
  }));

  const handleExport = () => {
    const headers = ["Sample ID", "ชื่อยา", "วันที่", "เวลา", "ผู้วิเคราะห์", "เครื่องมือ", "Density", "%AI", "Result", "QC", "หมายเหตุ QC"];
    const rows = filtered.map(r => [
      r.id, r.name, r.date, r.time, r.receiver || "", r.instrument || "",
      r.density ?? "", r.aiPercent ?? "", r.preResult ?? "", r.qcResult, r.qcNote || ""
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `LIS_Database_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  const handleExportLogs = () => {
    const headers = ["Log ID", "Sample ID", "ชื่อยา", "เครื่องมือ", "เข็มแรก", "เข็มสุดท้าย", "จำนวนเข็ม", "Runtime"];
    const rows = filteredLogs.map(l => [
      l.id, l.sampleId, l.drugName, l.instrument, l.firstInjection, l.lastInjection, l.totalInjections, l.runtime
    ]);
    const csv = [headers, ...rows].map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `LIS_ActiveLog_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <AppLayout>
        <PageHeader
          className="mb-6"
          title={
            <span className="inline-flex items-center gap-2">
              <Database className="w-6 h-6" />
              Admin - ฐานข้อมูลตัวอย่าง
            </span>
          }
          description="ข้อมูลที่ออก Final Result แล้ว สำหรับการวิเคราะห์แบบ Data Driven"
        />

        <Tabs key={defaultKey} defaultValue={defaultKey}>
          <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
            <TabsList className="mb-4 w-max">
              {tabs.map((t) => (
                <TabsTrigger key={t.key} value={t.key} className="gap-1.5">
                  {t.icon && <t.icon className="w-4 h-4" />}
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <TabsContent value="database">
            <Card>
              <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <CardTitle className="text-base">ผลลัพธ์ที่ออก Final Result แล้ว ({filtered.length} รายการ)</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="ค้นหา..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 w-full sm:w-60" />
                  </div>
                  <Button variant="outline" onClick={handleExport} className="gap-2">
                    <Download className="w-4 h-4" />Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                  <Table className="min-w-[600px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Sample ID</TableHead>
                        <TableHead>ชื่อยา</TableHead>
                        <TableHead className="hidden md:table-cell">วันที่</TableHead>
                        <TableHead className="hidden xl:table-cell">เวลา</TableHead>
                        <TableHead className="hidden lg:table-cell">ผู้วิเคราะห์</TableHead>
                        <TableHead className="hidden lg:table-cell">เครื่องมือ</TableHead>
                        <TableHead className="hidden xl:table-cell">Density</TableHead>
                        <TableHead className="hidden md:table-cell">%AI</TableHead>
                        <TableHead className="hidden md:table-cell">Result</TableHead>
                        <TableHead>QC</TableHead>
                        <TableHead className="hidden lg:table-cell">หมายเหตุ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filtered.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={11} className="text-center text-muted-foreground py-8 table-cell">ยังไม่มีข้อมูลที่ออก Final Result</TableCell>
                        </TableRow>
                      ) : filtered.map(r => (
                        <TableRow key={r.id}>
                          <TableCell className="font-semibold text-primary">{r.id}</TableCell>
                          <TableCell>{r.name}</TableCell>
                          <TableCell className="hidden md:table-cell">{r.date}</TableCell>
                          <TableCell className="hidden xl:table-cell">{r.time}</TableCell>
                          <TableCell className="hidden lg:table-cell">{r.receiver || "-"}</TableCell>
                          <TableCell className="hidden lg:table-cell">{r.instrument || "-"}</TableCell>
                          <TableCell className="hidden xl:table-cell">{r.density ?? "-"}</TableCell>
                          <TableCell className="hidden md:table-cell">{r.aiPercent != null ? `${r.aiPercent}%` : "-"}</TableCell>
                          <TableCell className="hidden md:table-cell">{r.preResult != null ? `${r.preResult}%` : "-"}</TableCell>
                          <TableCell>
                            <Badge className={r.qcResult === "ผ่าน" ? "bg-emerald-100 text-emerald-700" : "bg-destructive/10 text-destructive"}>
                              {r.qcResult}
                            </Badge>
                          </TableCell>
                          <TableCell className="hidden lg:table-cell text-xs text-muted-foreground max-w-[150px] truncate">{r.qcNote || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activelog">
            <Card>
              <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Active Injection Log</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">บันทึกเวลาการฉีดตัวอย่างจากเครื่อง GC/HPLC (เข็มแรก - เข็มสุดท้าย)</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input placeholder="ค้นหา..." value={logSearch} onChange={e => setLogSearch(e.target.value)} className="pl-9 w-full sm:w-60" />
                  </div>
                  <Button variant="outline" onClick={handleExportLogs} className="gap-2">
                    <Download className="w-4 h-4" />Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                  <Table className="min-w-[600px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="hidden md:table-cell">Log ID</TableHead>
                        <TableHead>Sample ID</TableHead>
                        <TableHead>ชื่อยา</TableHead>
                        <TableHead className="hidden lg:table-cell">เครื่องมือ</TableHead>
                        <TableHead className="hidden xl:table-cell">เวลาฉีดเข็มแรก</TableHead>
                        <TableHead className="hidden xl:table-cell">เวลาฉีดเข็มสุดท้าย</TableHead>
                        <TableHead className="hidden md:table-cell">จำนวนเข็ม</TableHead>
                        <TableHead>Runtime</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredLogs.map(l => (
                        <TableRow key={l.id}>
                          <TableCell className="hidden md:table-cell font-semibold text-primary">{l.id}</TableCell>
                          <TableCell>{l.sampleId}</TableCell>
                          <TableCell>{l.drugName}</TableCell>
                          <TableCell className="hidden lg:table-cell"><Badge variant="outline">{l.instrument}</Badge></TableCell>
                          <TableCell className="hidden xl:table-cell text-xs">{l.firstInjection}</TableCell>
                          <TableCell className="hidden xl:table-cell text-xs">{l.lastInjection}</TableCell>
                          <TableCell className="hidden md:table-cell text-center font-semibold">{l.totalInjections}</TableCell>
                          <TableCell><Badge className="bg-accent text-accent-foreground">{l.runtime}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="auditlog">
            <Card>
              <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">ประวัติการเปลี่ยนสถานะ (10 รายการล่าสุด)</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">บันทึกการทำรายการของคำร้องทั้งหมด</p>
                </div>
                <Button variant="outline" onClick={() => navigate("/auditlog")} className="gap-2">
                  <ExternalLink className="w-4 h-4" />ดูทั้งหมด
                </Button>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto -mx-3 sm:mx-0 px-3 sm:px-0">
                  <Table className="min-w-[600px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="hidden md:table-cell">วันที่</TableHead>
                        <TableHead>เลขที่คำร้อง</TableHead>
                        <TableHead>เหตุการณ์</TableHead>
                        <TableHead className="hidden md:table-cell">สถานะ</TableHead>
                        <TableHead className="hidden lg:table-cell">ผู้ทำรายการ</TableHead>
                        <TableHead className="hidden lg:table-cell">หมายเหตุ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {auditLoading && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">กำลังโหลด audit log...</TableCell>
                        </TableRow>
                      )}
                      {!auditLoading && auditError && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-destructive py-8">โหลด audit log ไม่สำเร็จ: {auditError}</TableCell>
                        </TableRow>
                      )}
                      {!auditLoading && !auditError && auditData && auditData.items.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="text-center text-muted-foreground py-8">ยังไม่มีรายการ audit log</TableCell>
                        </TableRow>
                      )}
                      {!auditLoading && !auditError && auditData?.items.map((entry) => {
                        const from = statusLabel(entry.fromStatus);
                        const to = statusLabel(entry.toStatus);
                        return (
                          <TableRow
                            key={entry._id}
                            className="cursor-pointer"
                            onClick={() => navigate(`/petition/${entry.petitionId}`)}
                          >
                            <TableCell className="hidden md:table-cell text-muted-foreground whitespace-nowrap text-xs">
                              {formatDateTime(entry.createdAt)}
                            </TableCell>
                            <TableCell className="font-semibold text-primary">{entry.petitionNo}</TableCell>
                            <TableCell>
                              <Badge variant={EVENT_VARIANT[entry.event]}>
                                {PETITION_AUDIT_EVENT_LABELS[entry.event]}
                              </Badge>
                            </TableCell>
                            <TableCell className="hidden md:table-cell">
                              {to ? (
                                <span className="text-sm">
                                  {from && from !== to ? (
                                    <>
                                      <span className="text-muted-foreground">{from}</span>
                                      <span className="mx-1 text-muted-foreground">→</span>
                                      <span className="font-medium">{to}</span>
                                    </>
                                  ) : (
                                    <span className="font-medium">{to}</span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted-foreground">-</span>
                              )}
                            </TableCell>
                            <TableCell className="hidden lg:table-cell">{entry.actor || "system"}</TableCell>
                            <TableCell className="hidden lg:table-cell max-w-[360px] truncate text-muted-foreground text-xs">{entry.note || "-"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
    </AppLayout>
  );
};

export default AdminData;

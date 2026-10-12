import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Package, RefreshCw, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";

import AppLayout from "@/components/lis/AppLayout";
import PageHeader from "@/components/lis/PageHeader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { rankSearchResults } from "@/lib/searchRanking";
import { buildMfGapMedicineRows, type MfGapMedicineRow } from "@/lib/mfGapMedicines";
import { MF_CURRENT_API_URL, MF_HISTORICAL_API_URL } from "@/lib/mfItemDates";
import { formatDate as formatDisplayDate } from "@/lib/dateTime";

type MedicineKindFilter = "all" | "rm" | "fg";

async function fetchOptionalJson(url: string): Promise<unknown> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return [];
    return response.json();
  } catch {
    return [];
  }
}

async function fetchMfGapMedicines(): Promise<MfGapMedicineRow[]> {
  const [masterItemsResponse, historical, current] = await Promise.all([
    api.get<unknown>("/master-items"),
    fetchOptionalJson(MF_HISTORICAL_API_URL),
    fetchOptionalJson(MF_CURRENT_API_URL),
  ]);

  return buildMfGapMedicineRows(masterItemsResponse.data.data, historical, current);
}

function formatDate(value: string): string {
  return formatDisplayDate(value, value || "-");
}

function itemKind(itemNo: string): "RM" | "FG" | "" {
  const normalized = itemNo.trim().toUpperCase();
  if (normalized.startsWith("R")) return "RM";
  if (normalized.startsWith("F")) return "FG";
  return "";
}

export default function MfGapMedicinesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<MedicineKindFilter>("all");
  const { data = [], isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["mf-gap-medicines"],
    queryFn: fetchMfGapMedicines,
    staleTime: 5 * 60 * 1000,
  });

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matches = data.filter((item) => {
      const kind = itemKind(item.itemNo);
      const matchesKind = kindFilter === "all"
        || (kindFilter === "rm" && kind === "RM")
        || (kindFilter === "fg" && kind === "FG");
      if (!matchesKind) return false;
      if (!query) return true;
      return [item.itemNo, item.itemName, item.commonName, item.category]
        .some((value) => value.toLowerCase().includes(query));
    });
    return rankSearchResults(matches, query, (item) => ({
      primary: [item.itemNo],
      secondary: [item.itemName, item.commonName, item.category],
    }));
  }, [data, kindFilter, search]);

  const errorMessage = error instanceof Error ? error.message : "โหลดข้อมูลไม่สำเร็จ";

  return (
    <AppLayout>
      <div className="space-y-4">
        <PageHeader
          title="List ยา MF ≥ 30 วัน"
          description="รายการยาและวัตถุดิบที่ MF_Lasted - MF_Before ตั้งแต่ 30 วันขึ้นไป"
          onBack={() => navigate(-1)}
          actions={(
            <Button size="sm" variant="outline" onClick={() => void refetch()} disabled={isFetching}>
              <RefreshCw className={`mr-1 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              รีเฟรช
            </Button>
          )}
        />

        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>โหลดข้อมูลไม่สำเร็จ</AlertTitle>
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden">
          <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-5 w-5" />
              รายการเข้าเงื่อนไข
              <Badge variant="outline">{filtered.length}</Badge>
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as MedicineKindFilter)}>
                <SelectTrigger aria-label="ประเภทสินค้า" className="h-9 w-full sm:w-28">
                  <SelectValue placeholder="ทั้งหมด" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทั้งหมด</SelectItem>
                  <SelectItem value="rm">RM</SelectItem>
                  <SelectItem value="fg">FG</SelectItem>
                </SelectContent>
              </Select>
              <div className="relative min-w-[220px] flex-1">
                <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="ค้นหา item / ชื่อยา / common name"
                  className="h-9 w-full pl-8 sm:w-80"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-3 px-3 sm:mx-0 sm:px-0">
              <Table className="min-w-[900px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Item No</TableHead>
                    <TableHead>ชื่อยา</TableHead>
                    <TableHead>Common Name</TableHead>
                    <TableHead>ประเภท</TableHead>
                    <TableHead>MF_Before</TableHead>
                    <TableHead>MF_Lasted</TableHead>
                    <TableHead className="text-right">ส่วนต่าง (วัน)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableRow><TableCell colSpan={7} className="py-6 text-center">กำลังโหลด...</TableCell></TableRow>
                  ) : filtered.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">ไม่มีข้อมูล</TableCell></TableRow>
                  ) : filtered.map((item) => (
                    <TableRow key={`${item.itemNo}-${item.mfBefore}-${item.mfLasted}`}>
                      <TableCell className="font-medium">{item.itemNo || "-"}</TableCell>
                      <TableCell>{item.itemName || "-"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{item.commonName || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{itemKind(item.itemNo) || item.category || "-"}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDate(item.mfBefore)}</TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDate(item.mfLasted)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="secondary">{item.mfGapDays.toLocaleString()} วัน</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}

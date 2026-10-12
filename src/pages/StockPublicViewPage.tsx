import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, FlaskConical, History, Package, RotateCw } from "lucide-react";

import PageHeader from "@/components/lis/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { deductionAmount } from "@/lib/stockDeduction";
import { formatStockQuantity, formatStockQuantityWithUnit } from "@/lib/stockQuantity";
import { parseScannedQrId } from "@/lib/stockUnit";
import { formatDate, formatDateTime } from "@/lib/dateTime";
import type { StockPublicScanItem, StockTransactionItem } from "@/types/stock";

function formatLotBottleLabel(value?: number | null) {
  const bottleNo = Number(value);
  return Number.isInteger(bottleNo) && bottleNo > 0 ? `ขวดที่ ${bottleNo}` : "";
}

function stockName(item: StockPublicScanItem) {
  return item.kind === "standard" ? item.itemName : item.name;
}

function stockDescription(item: StockPublicScanItem) {
  if (item.kind === "standard") {
    const lotBottleLabel = formatLotBottleLabel(item.lotBottleNo);
    return (item.itemCode || "-") + " · Lot " + (item.lotNo || "-") + (lotBottleLabel ? " · " + lotBottleLabel : "") + " · EXP " + formatDate(item.exp);
  }
  return "สารเคมี · ขนาด " + (item.sizeLiter || "-") + " L · คงเหลือ " + (item.qty ?? "-") + " ขวด";
}

function remainingText(item: StockPublicScanItem) {
  if (item.kind === "standard") {
    return formatStockQuantityWithUnit(item.volume?.remaining, item.volume?.unit);
  }
  return String(item.qty ?? "-") + " ขวด";
}

function transactionAmountText(transaction: StockTransactionItem) {
  const amount = deductionAmount(transaction);
  if (amount.text !== "-") return amount;
  const delta = transaction.delta;
  if (delta == null) return amount;
  return { text: `${delta > 0 ? "+" : ""}${formatStockQuantity(delta)}${transaction.unit ? ` ${transaction.unit}` : ""}` };
}

function transactionQueryParams(item?: StockPublicScanItem | null) {
  if (!item) return null;
  if (item.kind === "standard") return { qrId: item.qrId, limit: 20 };
  if (item.qrId && item.qrId !== item.id) return { itemType: "solvent", qrId: item.qrId, limit: 20 };
  return { itemType: "solvent", itemId: item.id, limit: 20 };
}

function borrowPath(qrId: string) {
  return "/stock-deduction?qrId=" + encodeURIComponent(qrId);
}

const DISCARDED_STANDARD_MESSAGE = "ขวดนี้ได้แจ้งทิ้งไปแล้ว ห้ามใช้";

export default function StockPublicViewPage() {
  const [searchParams] = useSearchParams();
  const rawQrId = searchParams.get("qrId") || searchParams.get("id") || "";
  const qrId = parseScannedQrId(rawQrId);

  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ["stock", "public", qrId],
    queryFn: () => api.getPublicStockItem(qrId),
    enabled: Boolean(qrId),
    retry: false,
  });

  const isDiscardedStandard = data?.kind === "standard" && data.status === "discarded";
  const canBorrow = Boolean(qrId && data && !isDiscardedStandard);
  const transactionParams = transactionQueryParams(data);
  const {
    data: transactions = [],
    isLoading: transactionsLoading,
    error: transactionsError,
  } = useQuery({
    queryKey: ["stock", "public", "transactions", transactionParams],
    queryFn: () => api.getStockTransactions(transactionParams!),
    enabled: Boolean(transactionParams && !isDiscardedStandard),
    retry: false,
  });

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl space-y-5">
        <PageHeader
          title={
            <span className="inline-flex items-center gap-2">
              {data?.kind === "solvent" ? <FlaskConical className="h-6 w-6" /> : <Package className="h-6 w-6" />}
              ข้อมูล Stock
            </span>
          }
          description="ดูข้อมูลจาก QR ข้างขวดได้โดยไม่ต้องล็อกอิน"
          actions={
            canBorrow ? (
              <Button asChild>
                <Link to={borrowPath(qrId)}>
                  เบิก stock <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            ) : null
          }
        />

        {!qrId && (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground">ไม่พบ qrId จาก QR ที่สแกน</CardContent>
          </Card>
        )}

        {qrId && isLoading && (
          <Card>
            <CardContent className="space-y-3 p-6">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-28 w-full" />
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        )}

        {qrId && error && !isLoading && (
          <Card>
            <CardContent className="space-y-4 p-6 text-center">
              <div className="text-lg font-semibold text-destructive">ไม่พบรายการ stock จาก QR นี้</div>
              <p className="text-sm text-muted-foreground">กรุณาตรวจสอบ QR หรือสแกนใหม่อีกครั้ง</p>
              <Button type="button" variant="outline" onClick={() => refetch()} disabled={isFetching}>
                <RotateCw className="mr-1 h-4 w-4" /> โหลดอีกครั้ง
              </Button>
            </CardContent>
          </Card>
        )}

        {data && (
          <div className={isDiscardedStandard ? "grid gap-5" : "grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]"}>
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{data.kind === "standard" ? "STD" : "สารเคมี"}</Badge>
                  {data.kind === "standard" ? <Badge variant="secondary">{data.type || "primary"}</Badge> : null}
                  {data.kind === "standard" ? <Badge variant={data.status === "active" ? "default" : "destructive"}>{data.status}</Badge> : null}
                </div>
                <CardTitle className="leading-snug">{stockName(data)}</CardTitle>
                {!isDiscardedStandard ? <p className="text-sm text-muted-foreground">{stockDescription(data)}</p> : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {isDiscardedStandard ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm font-semibold text-destructive">
                    {DISCARDED_STANDARD_MESSAGE}
                  </div>
                ) : (
                  <>
                    <div className="rounded-lg border bg-background p-4">
                      <div className="text-xs text-muted-foreground">คงเหลือ</div>
                      <div className="mt-1 text-3xl font-bold tabular-nums">{remainingText(data)}</div>
                    </div>

                    {data.kind === "standard" ? (
                      <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <Detail label="Code" value={data.itemCode || "-"} />
                        <Detail label="ประเภท" value={data.type || "primary"} />
                        <Detail label="Lot No" value={data.lotNo || "-"} />
                        {formatLotBottleLabel(data.lotBottleNo) ? <Detail label="ลำดับขวดใน Lot" value={formatLotBottleLabel(data.lotBottleNo)} /> : null}
                        <Detail label="EXP" value={formatDate(data.exp)} />
                        <Detail label="ปริมาณเริ่มต้น" value={String(data.volume?.initial ?? "-") + (data.volume?.unit ? " " + data.volume.unit : "")} />
                      </dl>
                    ) : (
                      <dl className="grid gap-3 text-sm sm:grid-cols-2">
                        <Detail label="ชื่อสารเคมี" value={data.name} />
                        <Detail label="ขนาด/ขวด" value={String(data.sizeLiter || "-") + " L"} />
                        <Detail label="คงเหลือ" value={String(data.qty ?? "-") + " ขวด"} />
                        <Detail label="หมายเหตุ" value={data.note || data.latestReceiveNote || "-"} />
                      </dl>
                    )}

                    <Button asChild className="w-full sm:w-auto">
                      <Link to={borrowPath(qrId)}>
                        ไปหน้าเบิก stock <ArrowRight className="ml-1 h-4 w-4" />
                      </Link>
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>

            {!isDiscardedStandard ? (
              <TransactionHistoryCard
                item={data}
                transactions={transactions}
                isLoading={transactionsLoading}
                error={transactionsError}
              />
            ) : null}
          </div>
        )}
      </div>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words font-medium">{value}</dd>
    </div>
  );
}

function TransactionHistoryCard({
  item,
  transactions,
  isLoading,
  error,
}: {
  item: StockPublicScanItem;
  transactions: StockTransactionItem[];
  isLoading: boolean;
  error: unknown;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <History className="h-5 w-5" /> {item.kind === "standard" ? "ประวัติขวดนี้" : "ประวัติสารเคมีนี้"}
          <Badge variant="outline">{transactions.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="rounded-lg border border-dashed bg-muted/50 p-5 text-center text-sm text-muted-foreground">กำลังโหลดประวัติ...</div>
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-5 text-center text-sm text-destructive">โหลดประวัติไม่ได้</div>
        ) : transactions.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/50 p-5 text-center text-sm text-muted-foreground">ยังไม่มี transaction ของรายการนี้</div>
        ) : (
          <div className="space-y-3">
            {transactions.map((transaction) => {
              const amount = transactionAmountText(transaction);
              return (
                <div key={transaction._id} className="rounded-lg border bg-background p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="outline">{transaction.action}</Badge>
                    <span className="text-xs text-muted-foreground">{formatDateTime(transaction.createdAt)}</span>
                  </div>
                  <div className="mt-2 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-semibold">{amount.text}</div>
                      {amount.sub ? <div className="text-xs text-muted-foreground">{amount.sub}</div> : null}
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{transaction.userName || transaction.userEmail || "-"}</div>
                      {transaction.note ? <div className="mt-1 break-words">{transaction.note}</div> : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

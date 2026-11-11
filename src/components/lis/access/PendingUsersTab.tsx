import { useMemo, useState } from "react";
import { Check, Clock3, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AppUser, Role } from "./types";

export const DEFAULT_APPROVAL_ROLE_ID = "viewer";

// Viewer คือ role พื้นฐานของผู้ใช้ทั่วไป แสดงเป็น "ผู้ใช้งาน" ให้ admin เข้าใจตรงกัน
export function approvalRoleLabel(role: Role) {
  return role.id === DEFAULT_APPROVAL_ROLE_ID ? `ผู้ใช้งาน (${role.name})` : role.name;
}

function formatRequestedAt(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

interface PendingUsersTabProps {
  users: AppUser[];
  roles: Role[];
  onApprove: (userId: string, roleId: string) => Promise<void>;
  onReject: (userId: string) => Promise<void>;
}

export default function PendingUsersTab({ users, roles, onApprove, onReject }: PendingUsersTabProps) {
  const [selectedRole, setSelectedRole] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);

  // admin ไม่ใช่ตัวเลือกตอนยืนยัน — ต้องตั้งจากแท็บผู้ใช้โดยตั้งใจเท่านั้น
  const roleOptions = useMemo(() => {
    const options = roles.filter((role) => role.id !== "admin");
    return [...options].sort((a, b) => {
      if (a.id === DEFAULT_APPROVAL_ROLE_ID) return -1;
      if (b.id === DEFAULT_APPROVAL_ROLE_ID) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [roles]);
  const defaultRoleId = roleOptions.some((role) => role.id === DEFAULT_APPROVAL_ROLE_ID)
    ? DEFAULT_APPROVAL_ROLE_ID
    : roleOptions[0]?.id ?? DEFAULT_APPROVAL_ROLE_ID;

  const run = async (userId: string, action: () => Promise<void>) => {
    setBusyId(userId);
    try {
      await action();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="text-base">ผู้ใช้รอเข้าระบบ</CardTitle>
        <p className="text-sm text-muted-foreground">
          บัญชี Microsoft ขององค์กรที่เข้าสู่ระบบครั้งแรก เลือกบทบาทแล้วกดยืนยันเพื่อให้เริ่มใช้งานได้ ผู้ที่เข้าผ่านระบบ Production จะได้รับการยืนยันอัตโนมัติ
        </p>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ผู้ใช้</TableHead>
                <TableHead className="hidden md:table-cell">แผนก · ตำแหน่ง</TableHead>
                <TableHead className="hidden lg:table-cell">ขอเข้าระบบเมื่อ</TableHead>
                <TableHead className="w-56">บทบาท</TableHead>
                <TableHead className="w-48 text-right">การดำเนินการ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                    <div className="flex flex-col items-center gap-2">
                      <Clock3 className="h-5 w-5" aria-hidden="true" />
                      ไม่มีผู้ใช้รอยืนยัน
                    </div>
                  </TableCell>
                </TableRow>
              ) : users.map((u) => {
                const roleId = selectedRole[u.id] ?? defaultRoleId;
                const busy = busyId === u.id;
                return (
                  <TableRow key={u.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar className="h-8 w-8"><AvatarFallback>{(u.name || u.email).slice(0, 1)}</AvatarFallback></Avatar>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{u.name || u.email}</p>
                          <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                        </div>
                        <Badge variant="outline" className="ml-1 hidden shrink-0 sm:inline-flex">รอยืนยัน</Badge>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm">{u.department || "—"} · {u.position || "—"}</TableCell>
                    <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">{formatRequestedAt(u.createdAt)}</TableCell>
                    <TableCell>
                      <Select
                        value={roleId}
                        disabled={busy}
                        onValueChange={(value) => setSelectedRole((current) => ({ ...current, [u.id]: value }))}
                      >
                        <SelectTrigger className="h-9 w-full" aria-label={`บทบาทของ ${u.email}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roleOptions.map((role) => (
                            <SelectItem key={role.id} value={role.id}>{approvalRoleLabel(role)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5"
                          disabled={busy}
                          onClick={() => void run(u.id, () => onReject(u.id))}
                        >
                          <X className="h-4 w-4" /> ปฏิเสธ
                        </Button>
                        <Button
                          size="sm"
                          className="gap-1.5"
                          disabled={busy}
                          onClick={() => void run(u.id, () => onApprove(u.id, roleId))}
                        >
                          <Check className="h-4 w-4" /> ยืนยัน
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

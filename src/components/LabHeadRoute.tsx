import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { normalizeRoles } from '@/lib/roles';

/** หน้าที่เปิดได้เฉพาะหัวหน้า Lab / admin — คนอื่นถูกพาไปหน้าการทดสอบ Lab */
export default function LabHeadRoute({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user) return <>{children}</>;
  const allowed = normalizeRoles(user).some((r) => r === 'admin' || r === 'lab-head');
  return allowed ? <>{children}</> : <Navigate to="/lab-testing" replace />;
}

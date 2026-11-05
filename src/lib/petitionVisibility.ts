import type { ParameterItem } from '@/lib/api';
import { isAssignedTo } from '@/lib/assignment';
import { getPetitionCategory, itemGroupKey, matchParametersForItem } from '@/lib/petitionTestItems';
import { shouldSendItemToLab } from '@/lib/petitionRouting';
import { isProductionDepartment } from '@/lib/productionDepartment';
import { normalizeRoles } from '@/lib/roles';
import type { Petition } from '@/types/petition.types';

const norm = (value?: string | null) => (value ?? '').trim().toLowerCase();

const RECEIVED_STATUSES = new Set<Petition['status']>([
  'sampleSent',
  'pendingReview',
  'inProgress',
  'success',
  'approved',
]);

export type PetitionVisibilityUser = {
  email?: string;
  name?: string;
  employeeId?: string;
  department?: string;
  role?: string;
  roles?: string[];
};

export const petitionHasLabItems = (petition: Petition) =>
  petition.items.some((item) => shouldSendItemToLab(item));

export const petitionHasLabReadableItem = (
  petition: Petition,
  labParams: ParameterItem[],
  membership?: Map<string, string[]>,
) =>
  petition.items.some(
    (item) =>
      shouldSendItemToLab(item) &&
      matchParametersForItem(
        item,
        labParams,
        membership?.get(itemGroupKey(item)) ?? [],
        { petitionCategory: getPetitionCategory(petition) },
      ).length > 0,
  );

export function isOwnSubmission(
  petition: Petition,
  user: Pick<PetitionVisibilityUser, 'employeeId' | 'name' | 'email'> | null,
): boolean {
  if (!user) return false;
  const userName = norm(user.name);
  const submitterName = norm(petition.submittedBy?.name);
  return !!(userName && submitterName && userName === submitterName);
}

export function isLabRole(role: string): boolean {
  return role === 'lab' || role.startsWith('lab-') || role.startsWith('lab_');
}

export function isQcRole(role: string): boolean {
  return role === 'qc' || role.startsWith('qc-') || role.startsWith('qc_');
}

export function canSeePetition(
  petition: Petition,
  user: PetitionVisibilityUser | null,
): boolean {
  if (!user) return false;
  const roles = normalizeRoles(user);
  if (roles.includes('admin')) return true;
  if (isOwnSubmission(petition, user)) return true;
  // แผนกผลิตเห็นคำร้องของฝ่ายผลิตทุกสาย แม้ไม่ได้เป็นผู้ยื่นเอง
  if (isProductionDepartment(user.department) && isProductionDepartment(petition.submittedBy?.department)) return true;
  if (isAssignedTo(petition.assignedTo, user)) return true;
  if (RECEIVED_STATUSES.has(petition.status)) {
    if (roles.some(isLabRole) && petitionHasLabItems(petition)) return true;
    if (roles.some(isQcRole)) return true;
  }
  return false;
}

export function canUserCreatePetition(
  user: { role?: string; roles?: string[] } | null | undefined,
  canAccessNewPetition: boolean,
): boolean {
  if (!canAccessNewPetition) return false;
  return normalizeRoles(user).length > 0;
}

export type UserStatus = "active" | "inactive";
export type UserApprovalStatus = "pending" | "approved" | "rejected";

export type AppUser = {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleIds: string[];
  department: string;
  position: string;
  employeeId: string;
  status: UserStatus;
  approvalStatus?: UserApprovalStatus;
  createdAt?: string | null;
  lastActive: string;
};

export type RoleFamily = "" | "lab" | "qc";

export type Role = {
  id: string;
  name: string;
  description: string;
  locked?: boolean;
  family?: RoleFamily;
};

export type AccessGroup = {
  id: string;
  name: string;
  description: string;
  paths: string[];
  locked?: boolean;
  sortOrder?: number;
};

export type EmployeeDirectoryEntry = {
  employeeId: string;
  name: string;
  department: string;
  position: string;
  email: string;
};

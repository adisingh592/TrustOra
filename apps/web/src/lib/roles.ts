export const ACCOUNT_ROLES = ["CLIENT", "FREELANCER"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === "string" && (ACCOUNT_ROLES as readonly string[]).includes(value);
}

export function accountRoleLabel(role: AccountRole): string {
  return role === "CLIENT" ? "Client" : "Freelancer";
}

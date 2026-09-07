export const ROLES = ["owner", "manager", "operator"] as const;
export type Role = (typeof ROLES)[number];

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function isRole(value: unknown): value is Role { return typeof value === "string" && (ROLES as readonly string[]).includes(value); }
export function isSlug(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value); }
export function isEmail(value: unknown): value is string { return typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
export function isSafeText(value: unknown, maxLength: number, required = false): value is string {
  return typeof value === "string" && value.length <= maxLength && (!required || value.trim().length > 0) && !/[\u0000-\u001f\u007f]/.test(value);
}

export function isStrongTemporaryPassword(value: unknown): value is string {
  return typeof value === "string" && value.length >= 12 && value.length <= 128 && /[a-z]/i.test(value) && /\d/.test(value);
}

export function isPositiveInteger(value: unknown, max = 1_000_000): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= max;
}

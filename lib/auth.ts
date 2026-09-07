import { isEmail, isUsername } from "@/lib/validation";

export type LoginInput = { identifier: string; password: string };
export type LoginValidation = { valid: true; value: LoginInput } | { valid: false; error: string };

export function normalizeLoginIdentifier(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

// Passwords are deliberately not normalized. Leading/trailing spaces and
// special characters are valid password characters and must reach Supabase
// exactly as entered.
export function validateLoginInput(input: unknown): LoginValidation {
  const candidate = input as Partial<LoginInput> | null;
  const identifier = normalizeLoginIdentifier(candidate?.identifier);
  const password = candidate?.password;
  if (!identifier) return { valid: false, error: "Enter your User ID." };
  if (!isUsername(identifier) && !isEmail(identifier)) return { valid: false, error: "Enter a valid User ID." };
  if (typeof password !== "string" || password.length === 0) return { valid: false, error: "Enter your password." };
  if (password.length > 128) return { valid: false, error: "Password is too long." };
  return { valid: true, value: { identifier, password } };
}

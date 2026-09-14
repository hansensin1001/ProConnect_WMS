/** Shared operator input rules. The database remains the final stock authority. */
export function serialTokens(value: string): string[] {
  return value.split(/[\r\n,;\t]+/).map((serial) => serial.trim().toUpperCase()).filter(Boolean);
}

export function appendSerials(current: string[], incoming: string[], required: number): string[] {
  if (!Number.isSafeInteger(required) || required < 1) throw new Error("Enter a positive whole-number quantity before scanning.");
  const next = [...current];
  const seen = new Set(current.map((serial) => serial.toUpperCase()));
  for (const raw of incoming) {
    const serial = raw.trim().toUpperCase();
    if (!serial || serial.length > 160) throw new Error("Serial numbers must contain 1–160 characters.");
    if (seen.has(serial)) throw new Error(`Duplicate scan: ${serial}. Remove the duplicate before continuing.`);
    if (next.length >= required) throw new Error(`Only ${required} serial numbers are required. The batch was not added.`);
    seen.add(serial);
    next.push(serial);
  }
  return next;
}

export function receiptRemaining(line: { quantity_expected: number; quantity_received: number; rejected_qty?: number }): number {
  return Math.max(0, line.quantity_expected - line.quantity_received - (line.rejected_qty ?? 0));
}

export function shippableQuantity(line: { quantity_requested: number; quantity_picked: number; quantity_reserved?: number }): number {
  return Math.max(0, Math.min(line.quantity_requested, line.quantity_reserved ?? 0) - line.quantity_picked);
}

export function binLabel(bin?: { display_code?: string | null; location_code?: string | null } | null): string {
  return [...new Set([bin?.display_code?.trim(), bin?.location_code?.trim()].filter(Boolean))].join(" · ") || "[Unassigned bin]";
}

export function warehouseError(error: unknown, fallback: string): string {
  return error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : fallback;
}

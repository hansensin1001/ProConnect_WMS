import { NextRequest } from "next/server";

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// This is an in-memory safety net for a single server instance. For strict
// multi-region enforcement, configure an edge-backed store (for example
// Upstash) with the same key and limits.
export function checkRateLimit(request: NextRequest, scope: string, limit: number, windowMs: number) {
  const now = Date.now();
  const address = request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim() ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const key = `${scope}:${address}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) { buckets.set(key, { count: 1, resetAt: now + windowMs }); return { allowed: true, retryAfter: 0 }; }
  if (current.count >= limit) return { allowed: false, retryAfter: Math.ceil((current.resetAt - now) / 1000) };
  current.count += 1;
  if (buckets.size > 10_000) for (const [bucketKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(bucketKey);
  return { allowed: true, retryAfter: 0 };
}

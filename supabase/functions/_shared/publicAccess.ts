// supabase/functions/_shared/publicAccess.ts
// Shared anon-key check + IP rate limiter for public (verify_jwt = false)
// edge functions — submit-ba-form, submit-empanelment-correction.

export function checkAnonKey(req: Request): boolean {
  const apiKey = req.headers.get("apikey");
  const authHeader = req.headers.get("authorization");
  const expectedKey = Deno.env.get("SUPABASE_ANON_KEY");
  const providedKey = apiKey || authHeader?.replace("Bearer ", "");
  return !!providedKey && !!expectedKey && providedKey === expectedKey;
}

export function getClientIP(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// In-memory per-instance rate limiter. Each edge function module gets its
// own Map, so pass a distinct `store` per function (module-level `new Map()`)
// rather than sharing one across functions.
export function checkRateLimit(
  store: Map<string, { count: number; resetAt: number }>,
  ip: string,
  max = 5,
  windowMs = 15 * 60 * 1000
): { allowed: boolean; waitMinutes: number } {
  const now = Date.now();
  const record = store.get(ip);
  if (!record || now > record.resetAt) {
    store.set(ip, { count: 1, resetAt: now + windowMs });
    return { allowed: true, waitMinutes: 0 };
  }
  if (record.count >= max) {
    return { allowed: false, waitMinutes: Math.ceil((record.resetAt - now) / 60000) };
  }
  record.count++;
  return { allowed: true, waitMinutes: 0 };
}

export function clearRateLimit(store: Map<string, { count: number; resetAt: number }>, ip: string) {
  store.delete(ip);
}

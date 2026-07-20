// supabase/functions/_shared/cors.ts
// Shared CORS + JSON response helpers, lifted from create-staff-user/index.ts.

// Deploy-preview / branch-deploy subdomains are generated per-PR by
// Netlify and can't be enumerated in advance, so we match by suffix
// instead of an exact list. Set via `supabase secrets set
// NETLIFY_SITE_SUFFIX=--your-site-name.netlify.app` once the Netlify site
// exists. Until then, only localhost + ALLOWED_ORIGIN are permitted
// (fail closed, not open).
const DEFAULT_LOCALHOST_ORIGIN = "http://localhost:5173";
const NETLIFY_SITE_SUFFIX = Deno.env.get("NETLIFY_SITE_SUFFIX") || "";
const EXTRA_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "";

// Vite picks the next free port (5174, 5175, ...) whenever 5173 is
// already in use, so match any localhost/127.0.0.1 port rather than a
// single hardcoded one.
function isLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === "localhost" || hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (isLocalhostOrigin(origin)) return true;
  if (EXTRA_ORIGIN && origin === EXTRA_ORIGIN) return true;
  if (NETLIFY_SITE_SUFFIX) {
    try {
      return new URL(origin).hostname.endsWith(NETLIFY_SITE_SUFFIX);
    } catch {
      return false;
    }
  }
  return false;
}

export function getCorsHeaders(req: Request, extraMethods = "POST, OPTIONS") {
  const origin = req.headers.get("origin") || "";
  const allowed = isAllowedOrigin(origin) ? origin : DEFAULT_LOCALHOST_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": extraMethods,
  };
}

export function jsonRes(req: Request, status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

// supabase/functions/_shared/cors.ts
// Shared CORS + JSON response helpers, lifted from create-staff-user/index.ts.

// Deploy-preview / branch-deploy subdomains are generated per-PR by
// Netlify and can't be enumerated in advance, so we match by suffix
// instead of an exact list. Set via `supabase secrets set
// NETLIFY_SITE_SUFFIX=--your-site-name.netlify.app` once the Netlify site
// exists. Until then, only localhost + ALLOWED_ORIGIN are permitted
// (fail closed, not open).
const STATIC_ALLOWED_ORIGINS = ["http://localhost:5173"];
const NETLIFY_SITE_SUFFIX = Deno.env.get("NETLIFY_SITE_SUFFIX") || "";
const EXTRA_ORIGIN = Deno.env.get("ALLOWED_ORIGIN") || "";

export function isAllowedOrigin(origin: string): boolean {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.includes(origin)) return true;
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
  const allowed = isAllowedOrigin(origin) ? origin : STATIC_ALLOWED_ORIGINS[0];
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

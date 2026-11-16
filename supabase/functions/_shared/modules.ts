// supabase/functions/_shared/modules.ts
// Backend half of the module ON/OFF switch (see app_modules in
// 20261113000000_super_admin_and_app_modules.sql and src/lib/modules.js).
//
// On production (secret APP_ENV=production) a module that the Super Admin
// has switched OFF must not be usable through the API either — hiding it
// in the UI isn't enough. Every edge function belonging to a module calls
// moduleOffResponse() right after its OPTIONS check and returns early when
// it gets a Response back.
//
// Anywhere else (staging, local, tests — APP_ENV unset or not
// "production") every module is always ON and this never touches the
// database, so existing tests with mocked clients are unaffected.

import { createAdminClient } from "./auth.ts";
import { jsonRes } from "./cors.ts";

export type ModuleKey = "empanelment" | "leads" | "proposals" | "monitoring" | "financials" | "knowledge";

export function isProductionEnv(): boolean {
  return (Deno.env.get("APP_ENV") || "").toLowerCase() === "production";
}

// `modules`: the function is usable while ANY of them is ON (e.g. the
// invoice functions serve both Monitoring and Financials).
export async function moduleOffResponse(req: Request, modules: ModuleKey | ModuleKey[]): Promise<Response | null> {
  if (!isProductionEnv()) return null;
  const keys = Array.isArray(modules) ? modules : [modules];
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("app_modules")
      .select("module_key, enabled")
      .in("module_key", keys);
    if (error) throw error;
    if ((data || []).some((r: { enabled: boolean }) => r.enabled)) return null;
  } catch (e) {
    // Fail closed on production: if we can't confirm the module is ON,
    // treat it as OFF rather than letting a hidden module be used.
    console.error("moduleOffResponse: could not read app_modules", e);
  }
  return jsonRes(req, 403, { error: "This module is coming soon and isn't available yet.", code: "MODULE_DISABLED" });
}

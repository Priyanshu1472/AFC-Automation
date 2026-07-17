import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error("Missing Supabase environment variables. Check your .env.local file.");
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    storageKey: "afc-supabase-auth",
    autoRefreshToken: true,
    // Needed so password-reset / invite magic links (which land with the
    // session in the URL fragment) are picked up automatically.
    detectSessionInUrl: true,
  },
});

// supabase-js's FunctionsHttpError only exposes a generic "non-2xx status
// code" message — the actual { error: "..." } body an edge function sent
// back lives on error.context (the raw Response) and has to be read
// separately.
export async function extractFunctionErrorMessage(error, fallback) {
  try {
    const body = await error?.context?.json?.();
    return body?.error || error?.message || fallback;
  } catch {
    return error?.message || fallback;
  }
}

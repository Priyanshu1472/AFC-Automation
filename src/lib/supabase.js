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

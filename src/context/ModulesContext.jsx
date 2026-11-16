import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
import { IS_PRODUCTION } from "../lib/modules";

// Loads app_modules once (readable by anon too, so the public BP pages can
// follow the Empanelment switch) and keeps it live via realtime, so a
// change on the Module Settings page applies to open tabs straight away.
const ModulesContext = createContext(null);

export function ModulesProvider({ children }) {
  const [rows, setRows] = useState({});
  // Off production nothing is gated, so there's nothing to wait for.
  const [loading, setLoading] = useState(IS_PRODUCTION);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("app_modules").select("module_key, enabled, updated_at, updated_by");
    if (!error && data) setRows(Object.fromEntries(data.map((r) => [r.module_key, r])));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const channel = supabase
      .channel("app-modules")
      .on("postgres_changes", { event: "*", schema: "public", table: "app_modules" }, (payload) => {
        const row = payload.new;
        if (row?.module_key) setRows((prev) => ({ ...prev, [row.module_key]: row }));
      })
      .subscribe();
    // Realtime can miss events while a tab sleeps — re-check on focus.
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [load]);

  const value = useMemo(
    () => ({
      loading,
      rows,
      reload: load,
      // On production a module is ON only if its row says so (missing row
      // = OFF, fail closed); everywhere else every module is ON.
      isEnabled: (key) => !IS_PRODUCTION || rows[key]?.enabled === true,
      // What the table itself says, regardless of environment — for the
      // Module Settings page.
      storedEnabled: (key) => rows[key]?.enabled === true,
      setRow: (row) => setRows((prev) => ({ ...prev, [row.module_key]: row })),
    }),
    [loading, rows, load]
  );

  return <ModulesContext.Provider value={value}>{children}</ModulesContext.Provider>;
}

export function useModules() {
  const ctx = useContext(ModulesContext);
  if (!ctx) throw new Error("useModules must be used inside ModulesProvider");
  return ctx;
}

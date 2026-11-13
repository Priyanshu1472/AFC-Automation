import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTeamOptions } from "./useTeamOptions";

const userSelect = vi.fn();
const teamSelect = vi.fn();
let realtimeCallbacks;

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (table) => {
      if (table === "afc_users") return { select: () => ({ not: (...a) => userSelect(...a) }) };
      if (table === "afc_user_teams") return { select: () => teamSelect() };
      throw new Error(`unexpected table: ${table}`);
    },
    channel: () => {
      const chain = {
        on: (_event, _filter, cb) => {
          realtimeCallbacks.push(cb);
          return chain;
        },
        subscribe: () => ({}),
      };
      return chain;
    },
    removeChannel: vi.fn(),
  },
}));

// Both queries always resolve together in real usage (Promise.all) — this
// keeps every test's setup to one line instead of two.
function mockRows(userRows, teamRows = []) {
  userSelect.mockResolvedValueOnce({ data: userRows, error: null });
  teamSelect.mockResolvedValueOnce({ data: teamRows, error: null });
}

describe("useTeamOptions", () => {
  it("starts with the static seed list before the DB query resolves", () => {
    realtimeCallbacks = [];
    userSelect.mockReturnValue(new Promise(() => {})); // never resolves in this test
    teamSelect.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useTeamOptions());
    expect(result.current).toEqual(["BPDD", "BIID"]);
  });

  it("merges in team names found on afc_users, sorted, deduplicated", async () => {
    realtimeCallbacks = [];
    mockRows([{ team: "BPDD" }, { team: "Mumbai-West" }, { team: "Mumbai-West" }]);
    const { result } = renderHook(() => useTeamOptions());
    await waitFor(() => expect(result.current).toEqual(["BIID", "BPDD", "Mumbai-West"]));
  });

  it("filters out null/empty team values from the DB", async () => {
    realtimeCallbacks = [];
    mockRows([{ team: null }, { team: "" }, { team: "Delhi-North" }]);
    const { result } = renderHook(() => useTeamOptions());
    await waitFor(() => expect(result.current).toEqual(["BIID", "BPDD", "Delhi-North"]));
  });

  // A team only ever picked as someone's SECOND/THIRD team (never anyone's
  // primary) lives only in afc_user_teams, not afc_users.team — this is
  // the actual bug report: such a team never showed up as an option for
  // the next person creating a user, since only afc_users.team was read.
  it("also merges in team names that only exist in afc_user_teams (a secondary-team-only assignment)", async () => {
    realtimeCallbacks = [];
    mockRows([{ team: "BPDD" }], [{ team: "BPDD" }, { team: "Lucknow-Annex" }]);
    const { result } = renderHook(() => useTeamOptions());
    await waitFor(() => expect(result.current).toEqual(["BIID", "BPDD", "Lucknow-Annex"]));
  });

  it("falls back to the static list on a DB error instead of throwing", async () => {
    realtimeCallbacks = [];
    userSelect.mockResolvedValueOnce({ data: null, error: { message: "db down" } });
    teamSelect.mockResolvedValueOnce({ data: [], error: null });
    const { result } = renderHook(() => useTeamOptions());
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toEqual(["BPDD", "BIID"]);
  });

  it("re-fetches when an afc_users OR afc_user_teams realtime change fires, not just on mount", async () => {
    realtimeCallbacks = [];
    mockRows([{ team: "BPDD" }]);
    const { result } = renderHook(() => useTeamOptions());
    await waitFor(() => expect(result.current).toEqual(["BIID", "BPDD"]));
    expect(realtimeCallbacks.length).toBe(2); // one subscription per table

    mockRows([{ team: "BPDD" }, { team: "Mumbai-West" }]);
    realtimeCallbacks[0]();
    await waitFor(() => expect(result.current).toEqual(["BIID", "BPDD", "Mumbai-West"]));

    mockRows([{ team: "BPDD" }, { team: "Mumbai-West" }], [{ team: "Lucknow-Annex" }]);
    realtimeCallbacks[1]();
    await waitFor(() => expect(result.current).toEqual(["BIID", "BPDD", "Lucknow-Annex", "Mumbai-West"]));
  });
});

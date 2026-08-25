import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTeamOptions } from "./useTeamOptions";

const select = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: {
    from: () => ({ select: () => ({ not: (...a) => select(...a) }) }),
  },
}));

describe("useTeamOptions", () => {
  it("starts with the static seed list before the DB query resolves", () => {
    select.mockReturnValue(new Promise(() => {})); // never resolves in this test
    const { result } = renderHook(() => useTeamOptions());
    expect(result.current).toEqual(["BPDD", "BIID"]);
  });

  it("merges in team names found on afc_users, sorted, deduplicated", async () => {
    select.mockResolvedValue({ data: [{ team: "BPDD" }, { team: "Mumbai-West" }, { team: "Mumbai-West" }], error: null });
    const { result } = renderHook(() => useTeamOptions());
    await waitFor(() => expect(result.current).toEqual(["BIID", "BPDD", "Mumbai-West"]));
  });

  it("filters out null/empty team values from the DB", async () => {
    select.mockResolvedValue({ data: [{ team: null }, { team: "" }, { team: "Delhi-North" }], error: null });
    const { result } = renderHook(() => useTeamOptions());
    await waitFor(() => expect(result.current).toEqual(["BIID", "BPDD", "Delhi-North"]));
  });

  it("falls back to the static list on a DB error instead of throwing", async () => {
    select.mockResolvedValue({ data: null, error: { message: "db down" } });
    const { result } = renderHook(() => useTeamOptions());
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current).toEqual(["BPDD", "BIID"]);
  });
});

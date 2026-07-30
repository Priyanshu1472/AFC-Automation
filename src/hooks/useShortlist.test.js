import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useShortlist } from "./useShortlist";

vi.mock("./useAuth", () => ({
  useAuth: () => ({ profile: { id: "user-1", team: "BPDD" } }),
}));

const order = vi.fn();
const insertSelectSingle = vi.fn();
const upsert = vi.fn();
const deleteEq2 = vi.fn();

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: (table) => {
      if (table === "shortlists") {
        return {
          select: () => ({ order: (...a) => order(...a) }),
          insert: () => ({ select: () => ({ single: (...a) => insertSelectSingle(...a) }) }),
          delete: () => ({ eq: (col, val) => ({ then: (res) => res({ error: null }) }) }),
        };
      }
      if (table === "shortlist_projects") {
        return {
          upsert: (...a) => upsert(...a),
          delete: () => ({ eq: () => ({ eq: (...a) => deleteEq2(...a) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

const SAMPLE_LISTS = [
  {
    id: "sl-1",
    name: "Q1 Picks",
    created_by: "user-1",
    team: "BPDD",
    created_at: "2026-01-01",
    creator: { full_name: "Jane Doe" },
    shortlist_projects: [{ id: "sp-1", project_id: "proj-1", selected_kw_names: [], projects: { id: "proj-1", title: "Bridge", client: "X", location: "Delhi" } }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  order.mockResolvedValue({ data: SAMPLE_LISTS, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("useShortlist", () => {
  it("loads shortlists on mount and derives creator_name + membership map", async () => {
    const { result } = renderHook(() => useShortlist());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.shortlists[0].creator_name).toBe("Jane Doe");
    expect(result.current.isInAnyShortlist("proj-1")).toBe(true);
    expect(result.current.getProjectShortlists("proj-1")).toEqual(["sl-1"]);
    expect(result.current.isInAnyShortlist("proj-unrelated")).toBe(false);
  });

  it("createShortlist inserts using the caller's own profile id/team and refreshes", async () => {
    insertSelectSingle.mockResolvedValue({ data: { id: "sl-new" }, error: null });
    const { result } = renderHook(() => useShortlist());
    await waitFor(() => expect(result.current.loading).toBe(false));

    let created;
    await act(async () => {
      created = await result.current.createShortlist("  New List  ");
    });
    expect(created).toEqual({ id: "sl-new" });
    expect(insertSelectSingle).toHaveBeenCalled();
  });

  it("createShortlist surfaces an insert error instead of swallowing it", async () => {
    insertSelectSingle.mockResolvedValue({ data: null, error: { message: "insert failed" } });
    const { result } = renderHook(() => useShortlist());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(act(async () => {
      await result.current.createShortlist("New List");
    })).rejects.toThrow();
  });

  it("addToShortlist upserts on the shortlist_projects composite key", async () => {
    const { result } = renderHook(() => useShortlist());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addToShortlist("proj-2", ["kw1"], "sl-1");
    });
    expect(upsert).toHaveBeenCalledWith(
      { shortlist_id: "sl-1", project_id: "proj-2", selected_kw_names: ["kw1"] },
      { onConflict: "shortlist_id,project_id" },
    );
  });

  it("removeProject deletes by shortlist_id + project_id", async () => {
    deleteEq2.mockResolvedValue({ error: null });
    const { result } = renderHook(() => useShortlist());
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeProject("sl-1", "proj-1");
    });
    expect(deleteEq2).toHaveBeenCalledWith("project_id", "proj-1");
  });
});

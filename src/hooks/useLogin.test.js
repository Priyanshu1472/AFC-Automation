import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLogin } from "./useLogin";

const refreshProfile = vi.fn();
vi.mock("./useAuth", () => ({
  useAuth: () => ({ refreshProfile }),
}));

const signInWithPassword = vi.fn();
const signOut = vi.fn();
const maybeSingle = vi.fn();
vi.mock("../lib/supabase", () => ({
  supabase: {
    auth: { signInWithPassword: (...a) => signInWithPassword(...a), signOut: (...a) => signOut(...a) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: (...a) => maybeSingle(...a) }) }) }),
  },
}));

function fakeEvent() {
  return { preventDefault: vi.fn() };
}

async function submit(result, email, password) {
  act(() => {
    result.current.setEmail(email);
    result.current.setPassword(password);
  });
  await act(async () => {
    await result.current.handleLogin(fakeEvent());
  });
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  refreshProfile.mockResolvedValue({ id: "user-1" });
  signInWithPassword.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: { role: "md", is_active: true, must_change_password: false }, error: null });
});

describe("useLogin", () => {
  it("rejects an empty email without calling Supabase", async () => {
    const { result } = renderHook(() => useLogin());
    await submit(result, "", "password123");
    expect(result.current.error).toBe("Please enter your email address.");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a malformed email", async () => {
    const { result } = renderHook(() => useLogin());
    await submit(result, "not-an-email", "password123");
    expect(result.current.error).toBe("Please enter a valid email address.");
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a missing password", async () => {
    const { result } = renderHook(() => useLogin());
    await submit(result, "user@afc.com", "");
    expect(result.current.error).toBe("Please enter your password.");
  });

  it("blocks the attempt once the client-side rate limit is hit", async () => {
    for (let i = 0; i < 5; i++) {
      signInWithPassword.mockResolvedValueOnce({ error: { message: "bad" } });
      const { result } = renderHook(() => useLogin());
      await submit(result, "user@afc.com", "wrong");
    }
    const { result } = renderHook(() => useLogin());
    await submit(result, "user@afc.com", "wrong");
    expect(result.current.error).toContain("Too many failed attempts");
    expect(signInWithPassword).toHaveBeenCalledTimes(5);
  });

  it("shows remaining attempts on a failed login", async () => {
    signInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid credentials" } });
    const { result } = renderHook(() => useLogin());
    await submit(result, "user@afc.com", "wrong");
    expect(result.current.error).toBe("Invalid email or password. 4 attempts remaining.");
  });

  it("signs the user back out if their afc_users profile row is missing", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const { result } = renderHook(() => useLogin());
    await submit(result, "user@afc.com", "correct");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("Account not found in the system. Please contact your administrator.");
  });

  it("signs the user back out if their account is deactivated", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "md", is_active: false }, error: null });
    const { result } = renderHook(() => useLogin());
    await submit(result, "user@afc.com", "correct");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("Your account has been deactivated. Please contact your administrator.");
  });

  it("signs the user back out if their role isn't a recognized role", async () => {
    maybeSingle.mockResolvedValue({ data: { role: "not_a_real_role", is_active: true }, error: null });
    const { result } = renderHook(() => useLogin());
    await submit(result, "user@afc.com", "correct");
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe("Your account has an invalid role. Please contact your administrator.");
  });

  it("a full success clears the error and the rate-limit counter", async () => {
    const { result } = renderHook(() => useLogin());
    await submit(result, "user@afc.com", "correct");
    expect(result.current.error).toBe("");
    expect(result.current.attempts).toBe(0);
    expect(signOut).not.toHaveBeenCalled();
  });
});

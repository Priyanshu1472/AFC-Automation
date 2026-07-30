import { beforeEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit, clearRateLimit, getRemainingAttempts, recordFailedAttempt } from "./rateLimit";

const KEY = "rate_limit_afc";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("checkRateLimit", () => {
  it("allows the first attempt with no prior history", () => {
    expect(checkRateLimit()).toEqual({ allowed: true });
  });

  it("blocks after 5 failed attempts within the 15-minute window", () => {
    for (let i = 0; i < 5; i++) recordFailedAttempt();
    const result = checkRateLimit();
    expect(result.allowed).toBe(false);
    expect(result.waitMinutes).toBeGreaterThan(0);
  });

  it("allows the 5th attempt itself (blocks only once the max is reached)", () => {
    for (let i = 0; i < 4; i++) recordFailedAttempt();
    expect(checkRateLimit().allowed).toBe(true);
  });

  it("resets automatically once the 15-minute window has elapsed", () => {
    const start = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(start);
    for (let i = 0; i < 5; i++) recordFailedAttempt();
    expect(checkRateLimit().allowed).toBe(false);

    vi.spyOn(Date, "now").mockReturnValue(start + 16 * 60 * 1000);
    expect(checkRateLimit().allowed).toBe(true);
  });

  it("survives corrupted localStorage content instead of throwing", () => {
    localStorage.setItem(KEY, "not-json{{{");
    expect(checkRateLimit()).toEqual({ allowed: true });
  });
});

describe("recordFailedAttempt / getRemainingAttempts", () => {
  it("counts attempts and decrements remaining", () => {
    expect(getRemainingAttempts()).toBe(5);
    recordFailedAttempt();
    expect(getRemainingAttempts()).toBe(4);
    recordFailedAttempt();
    expect(getRemainingAttempts()).toBe(3);
  });

  it("never reports negative remaining attempts", () => {
    for (let i = 0; i < 10; i++) recordFailedAttempt();
    expect(getRemainingAttempts()).toBe(0);
  });

  it("returns the running count from recordFailedAttempt itself", () => {
    expect(recordFailedAttempt()).toBe(1);
    expect(recordFailedAttempt()).toBe(2);
  });
});

describe("clearRateLimit", () => {
  it("wipes stored attempts so remaining resets to the max", () => {
    recordFailedAttempt();
    recordFailedAttempt();
    clearRateLimit();
    expect(getRemainingAttempts()).toBe(5);
    expect(checkRateLimit()).toEqual({ allowed: true });
  });
});

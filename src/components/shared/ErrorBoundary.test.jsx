import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "./ErrorBoundary";

function Bomb() {
  throw new Error("kaboom");
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.defineProperty(window, "location", {
    value: { href: "", reload: vi.fn() },
    writable: true,
  });
});

describe("ErrorBoundary", () => {
  it("renders children normally when nothing throws", () => {
    render(
      <ErrorBoundary>
        <div>All good</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText("All good")).toBeInTheDocument();
  });

  it("catches a render error from a child and shows the fallback UI instead of crashing", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("logs the caught error for diagnostics", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(console.error).toHaveBeenCalledWith("Unhandled render error:", expect.any(Error), expect.anything());
  });

  it("Reload button calls window.location.reload", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText("Reload"));
    expect(window.location.reload).toHaveBeenCalled();
  });

  it("Go home button navigates to /home", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByText("Go home"));
    expect(window.location.href).toBe("/home");
  });
});

describe("ErrorBoundary — stale chunk after a deploy", () => {
  function StaleChunk() {
    throw new TypeError("Failed to fetch dynamically imported module: https://x/assets/HomePage-old.js");
  }

  beforeEach(() => sessionStorage.clear());

  it("reloads into the new version instead of showing the error screen", () => {
    render(
      <ErrorBoundary>
        <StaleChunk />
      </ErrorBoundary>,
    );
    expect(window.location.reload).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("does not reload again within 30s, so a truly broken chunk can't loop", () => {
    sessionStorage.setItem("afc:stale-chunk-reload-at", String(Date.now()));
    render(
      <ErrorBoundary>
        <StaleChunk />
      </ErrorBoundary>,
    );
    expect(window.location.reload).not.toHaveBeenCalled();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("does not reload for an ordinary render error", () => {
    function Bomb2() {
      throw new Error("kaboom");
    }
    render(
      <ErrorBoundary>
        <Bomb2 />
      </ErrorBoundary>,
    );
    expect(window.location.reload).not.toHaveBeenCalled();
  });
});

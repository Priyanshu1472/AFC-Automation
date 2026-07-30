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

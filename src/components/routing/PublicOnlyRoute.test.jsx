import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import PublicOnlyRoute from "./PublicOnlyRoute";

let mockAuth;
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => mockAuth,
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={["/login"]}>
      <Routes>
        <Route path="/home" element={<div>Home Page</div>} />
        <Route path="/change-password" element={<div>Change Password Page</div>} />
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <div>Login Form</div>
            </PublicOnlyRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("PublicOnlyRoute", () => {
  it("shows a loading screen while auth is resolving", () => {
    mockAuth = { user: null, profile: null, loading: true };
    renderLogin();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("shows the login form when there's no session", () => {
    mockAuth = { user: null, profile: null, loading: false };
    renderLogin();
    expect(screen.getByText("Login Form")).toBeInTheDocument();
  });

  it("redirects an already-active, logged-in user to /home", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: true, must_change_password: false }, loading: false };
    renderLogin();
    expect(screen.getByText("Home Page")).toBeInTheDocument();
  });

  it("redirects to /change-password instead of /home when that's still pending", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: true, must_change_password: true }, loading: false };
    renderLogin();
    expect(screen.getByText("Change Password Page")).toBeInTheDocument();
  });

  it("leaves a deactivated account on the login form instead of bouncing to /home", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: false }, loading: false };
    renderLogin();
    expect(screen.getByText("Login Form")).toBeInTheDocument();
  });

  it("leaves the user on the login form when there's a session but no profile row yet", () => {
    mockAuth = { user: { id: "u1" }, profile: null, loading: false };
    renderLogin();
    expect(screen.getByText("Login Form")).toBeInTheDocument();
  });
});

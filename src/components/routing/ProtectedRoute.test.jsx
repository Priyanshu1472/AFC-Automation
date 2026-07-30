import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import ProtectedRoute from "./ProtectedRoute";

let mockAuth;
vi.mock("../../hooks/useAuth", () => ({
  useAuth: () => mockAuth,
}));

function renderAt(path, allowedRoles) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/login" element={<div>Login Page</div>} />
        <Route path="/home" element={<div>Home Page</div>} />
        <Route path="/change-password" element={<div>Change Password Page</div>} />
        <Route
          path={path}
          element={
            <ProtectedRoute allowedRoles={allowedRoles}>
              <div>Protected Content</div>
            </ProtectedRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute", () => {
  it("shows a loading screen while auth is resolving", () => {
    mockAuth = { user: null, profile: null, loading: true };
    renderAt("/dashboard");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("redirects to /login when there's no authenticated user", () => {
    mockAuth = { user: null, profile: null, loading: false };
    renderAt("/dashboard");
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("redirects to /login when the user exists but has no afc_users profile row", () => {
    mockAuth = { user: { id: "u1" }, profile: null, loading: false };
    renderAt("/dashboard");
    expect(screen.getByText("Login Page")).toBeInTheDocument();
  });

  it("shows the deactivated message for a deactivated account, without navigating away", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: false, role: "md" }, loading: false };
    renderAt("/dashboard");
    expect(screen.getByText("Account Deactivated")).toBeInTheDocument();
  });

  it("forces a redirect to /change-password when must_change_password is set", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: true, must_change_password: true, role: "md" }, loading: false };
    renderAt("/dashboard");
    expect(screen.getByText("Change Password Page")).toBeInTheDocument();
  });

  it("does not redirect away from /change-password itself even when must_change_password is set", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: true, must_change_password: true, role: "md" }, loading: false };
    render(
      <MemoryRouter initialEntries={["/change-password"]}>
        <Routes>
          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <div>Protected Content</div>
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("redirects to /home when the role isn't in allowedRoles", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: true, must_change_password: false, role: "cfo" }, loading: false };
    renderAt("/dashboard", ["md", "admin"]);
    expect(screen.getByText("Home Page")).toBeInTheDocument();
  });

  it("renders children when the role is in allowedRoles", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: true, must_change_password: false, role: "admin" }, loading: false };
    renderAt("/dashboard", ["md", "admin"]);
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("renders children when no allowedRoles restriction is given, regardless of role", () => {
    mockAuth = { user: { id: "u1" }, profile: { is_active: true, must_change_password: false, role: "business_associate" }, loading: false };
    renderAt("/dashboard");
    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });
});

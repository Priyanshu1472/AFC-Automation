import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import ProtectedRoute from "./components/routing/ProtectedRoute";
import PublicOnlyRoute from "./components/routing/PublicOnlyRoute";

import LoginPage from "./pages/auth/LoginPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import ChangePasswordPage from "./pages/auth/ChangePasswordPage";
import HomePage from "./pages/HomePage";
import CreateUserPage from "./pages/admin/CreateUserPage";
import UserListPage from "./pages/admin/UserListPage";
import AuditLogsPage from "./pages/admin/AuditLogsPage";
import SendEmpanelmentPage from "./pages/empanelment/SendEmpanelmentPage";
import BaFormPage from "./pages/empanelment/BaFormPage";
import EmpanelmentListPage from "./pages/empanelment/EmpanelmentListPage";
import ApplicationReviewPage from "./pages/empanelment/ApplicationReviewPage";
import EmpanelmentCorrectionPage from "./pages/empanelment/EmpanelmentCorrectionPage";
import NotFoundPage from "./pages/NotFoundPage";

import "./App.css";

export default function App() {
  return (
    <BrowserRouter>
      <ErrorBoundary>
        <ToastProvider>
          <AuthProvider>
            <Routes>
          <Route path="/" element={<Navigate to="/login" replace />} />

          <Route
            path="/login"
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <PublicOnlyRoute>
                <ForgotPasswordPage />
              </PublicOnlyRoute>
            }
          />
          {/* Reached via the emailed reset link — the session is already
              set by Supabase (detectSessionInUrl), so no PublicOnlyRoute
              guard here; a signed-in user landing on this link should be
              able to complete the reset. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          <Route
            path="/change-password"
            element={
              <ProtectedRoute>
                <ChangePasswordPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/home"
            element={
              <ProtectedRoute>
                <HomePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/create-user"
            element={
              <ProtectedRoute allowedRoles={["md", "dgm"]}>
                <CreateUserPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute allowedRoles={["md", "dgm"]}>
                <UserListPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/audit-logs"
            element={
              <ProtectedRoute allowedRoles={["md", "cfo", "cs"]}>
                <AuditLogsPage />
              </ProtectedRoute>
            }
          />

              <Route path="/ba-form" element={<BaFormPage />} />
              <Route path="/empanelment/correction" element={<EmpanelmentCorrectionPage />} />
              <Route
                path="/empanelment/send"
                element={
                  <ProtectedRoute allowedRoles={["associate_consultant"]}>
                    <SendEmpanelmentPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/empanelment"
                element={
                  <ProtectedRoute allowedRoles={["associate_consultant", "project_officer", "dgm", "cfo", "cs", "md"]}>
                    <EmpanelmentListPage />
                  </ProtectedRoute>
                }
              />
              <Route
                path="/empanelment/:id"
                element={
                  <ProtectedRoute allowedRoles={["associate_consultant", "project_officer", "dgm", "cfo", "cs", "md"]}>
                    <ApplicationReviewPage />
                  </ProtectedRoute>
                }
              />

              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </AuthProvider>
        </ToastProvider>
      </ErrorBoundary>
    </BrowserRouter>
  );
}

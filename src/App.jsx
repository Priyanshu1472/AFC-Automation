import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import ProtectedRoute from "./components/routing/ProtectedRoute";
import PublicOnlyRoute from "./components/routing/PublicOnlyRoute";

import LoginPage from "./pages/auth/LoginPage";
import ForgotPasswordPage from "./pages/auth/ForgotPasswordPage";
import ResetPasswordPage from "./pages/auth/ResetPasswordPage";
import ChangePasswordPage from "./pages/auth/ChangePasswordPage";
import MyProfilePage from "./pages/auth/MyProfilePage";
import HomePage from "./pages/HomePage";
import CreateUserPage from "./pages/admin/CreateUserPage";
import EditUserPage from "./pages/admin/EditUserPage";
import UserListPage from "./pages/admin/UserListPage";
import AuditLogsPage from "./pages/admin/AuditLogsPage";
import SendEmpanelmentPage from "./pages/empanelment/SendEmpanelmentPage";
import BaFormPage from "./pages/empanelment/BaFormPage";
import EmpanelmentListPage from "./pages/empanelment/EmpanelmentListPage";
import ApplicationReviewPage from "./pages/empanelment/ApplicationReviewPage";
import EmpanelmentCorrectionPage from "./pages/empanelment/EmpanelmentCorrectionPage";
import ApplicationStatusPage from "./pages/empanelment/ApplicationStatusPage";
import EmpanelmentDashboardPage from "./pages/empanelment/EmpanelmentDashboardPage";
import EmpanelmentReportsPage from "./pages/empanelment/EmpanelmentReportsPage";
import KnowledgeSearchPage from "./pages/knowledge/KnowledgeSearchPage";
import AddProjectPage from "./pages/knowledge/AddProjectPage";
import EditProjectPage from "./pages/knowledge/EditProjectPage";
import ProjectDetailsPage from "./pages/knowledge/ProjectDetailsPage";
import ShortlistsPage from "./pages/knowledge/ShortlistsPage";
import LeadListPage from "./pages/leads/LeadListPage";
import CreateLeadPage from "./pages/leads/CreateLeadPage";
import EditLeadPage from "./pages/leads/EditLeadPage";
import LeadDetailPage from "./pages/leads/LeadDetailPage";
import LeadApprovalNoteForm from "./pages/leads/LeadApprovalNoteForm";
import LeadApprovalNotePreviewPage from "./pages/leads/LeadApprovalNotePreviewPage";
import LeadDashboardPage from "./pages/leads/LeadDashboardPage";
import LeadReportsPage from "./pages/leads/LeadReportsPage";
import ProposalsListPage from "./pages/proposals/ProposalsListPage";
import ProposalPreparationPage from "./pages/proposals/ProposalPreparationPage";
import NotFoundPage from "./pages/NotFoundPage";
import { USERS_PAGE_ROLES, AUDIT_LOG_ROLES, EMPANELMENT_ROLES, KNOWLEDGE_REPOSITORY_ROLES, LEAD_GENERATION_NAV_ROLES } from "./lib/roles";

import "./App.css";

export default function App() {
  return (
    <ThemeProvider>
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
                  path="/profile"
                  element={
                    <ProtectedRoute>
                      <MyProfilePage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/create-user"
                  element={
                    <ProtectedRoute allowedRoles={USERS_PAGE_ROLES}>
                      <CreateUserPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/users"
                  element={
                    <ProtectedRoute allowedRoles={USERS_PAGE_ROLES}>
                      <UserListPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/users/:id/edit"
                  element={
                    <ProtectedRoute allowedRoles={USERS_PAGE_ROLES}>
                      <EditUserPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/audit-logs"
                  element={
                    <ProtectedRoute allowedRoles={AUDIT_LOG_ROLES}>
                      <AuditLogsPage />
                    </ProtectedRoute>
                  }
                />

                <Route path="/ba-form" element={<BaFormPage />} />
                <Route path="/empanelment/correction" element={<EmpanelmentCorrectionPage />} />
                <Route path="/empanelment/status" element={<ApplicationStatusPage />} />
                <Route
                  path="/empanelment/send"
                  element={
                    <ProtectedRoute allowedRoles={["associate_consultant", "project_assistant"]}>
                      <SendEmpanelmentPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/empanelment"
                  element={
                    <ProtectedRoute allowedRoles={EMPANELMENT_ROLES}>
                      <EmpanelmentListPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/empanelment/:id"
                  element={
                    <ProtectedRoute allowedRoles={EMPANELMENT_ROLES}>
                      <ApplicationReviewPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/dashboard/empanelment"
                  element={
                    <ProtectedRoute allowedRoles={EMPANELMENT_ROLES}>
                      <EmpanelmentDashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reports/empanelment"
                  element={
                    <ProtectedRoute allowedRoles={EMPANELMENT_ROLES}>
                      <EmpanelmentReportsPage />
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/dashboard/leads"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <LeadDashboardPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/reports/leads"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <LeadReportsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leads/create"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <CreateLeadPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leads/:id/edit"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <EditLeadPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leads/:id/approval-note/preview"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <LeadApprovalNotePreviewPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leads/:id/approval-note"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <LeadApprovalNoteForm />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leads/:id"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <LeadDetailPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/leads"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <LeadListPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/proposals"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <ProposalsListPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/proposals/:leadId"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <ProposalPreparationPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/knowledge"
                  element={
                    <ProtectedRoute allowedRoles={KNOWLEDGE_REPOSITORY_ROLES}>
                      <KnowledgeSearchPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/knowledge/add"
                  element={
                    <ProtectedRoute allowedRoles={KNOWLEDGE_REPOSITORY_ROLES}>
                      <AddProjectPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/knowledge/shortlists"
                  element={
                    <ProtectedRoute allowedRoles={KNOWLEDGE_REPOSITORY_ROLES}>
                      <ShortlistsPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/knowledge/:id/edit"
                  element={
                    <ProtectedRoute allowedRoles={KNOWLEDGE_REPOSITORY_ROLES}>
                      <EditProjectPage />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/knowledge/:id"
                  element={
                    <ProtectedRoute allowedRoles={KNOWLEDGE_REPOSITORY_ROLES}>
                      <ProjectDetailsPage />
                    </ProtectedRoute>
                  }
                />

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </AuthProvider>
          </ToastProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </ThemeProvider>
  );
}

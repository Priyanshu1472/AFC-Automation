import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import ErrorBoundary from "./components/shared/ErrorBoundary";
import ProtectedRoute from "./components/routing/ProtectedRoute";
import PublicOnlyRoute from "./components/routing/PublicOnlyRoute";
import PageLoader from "./components/ui/PageLoader";
import { USERS_PAGE_ROLES, AUDIT_LOG_ROLES, EMPANELMENT_ROLES, KNOWLEDGE_REPOSITORY_ROLES, LEAD_GENERATION_NAV_ROLES } from "./lib/roles";

// Lazy-loaded so each page (and anything only it imports, e.g. xlsx/jspdf on
// the Reports pages) ships as its own chunk instead of all ~30 pages being
// bundled into one multi-MB chunk loaded even by the login screen.
const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const ForgotPasswordPage = lazy(() => import("./pages/auth/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/auth/ResetPasswordPage"));
const ChangePasswordPage = lazy(() => import("./pages/auth/ChangePasswordPage"));
const MyProfilePage = lazy(() => import("./pages/auth/MyProfilePage"));
const HomePage = lazy(() => import("./pages/HomePage"));
const CreateUserPage = lazy(() => import("./pages/admin/CreateUserPage"));
const EditUserPage = lazy(() => import("./pages/admin/EditUserPage"));
const UserListPage = lazy(() => import("./pages/admin/UserListPage"));
const AuditLogsPage = lazy(() => import("./pages/admin/AuditLogsPage"));
const SendEmpanelmentPage = lazy(() => import("./pages/empanelment/SendEmpanelmentPage"));
const BaFormPage = lazy(() => import("./pages/empanelment/BaFormPage"));
const EmpanelmentListPage = lazy(() => import("./pages/empanelment/EmpanelmentListPage"));
const ApplicationReviewPage = lazy(() => import("./pages/empanelment/ApplicationReviewPage"));
const EmpanelmentCorrectionPage = lazy(() => import("./pages/empanelment/EmpanelmentCorrectionPage"));
const ApplicationStatusPage = lazy(() => import("./pages/empanelment/ApplicationStatusPage"));
const EmpanelmentDashboardPage = lazy(() => import("./pages/empanelment/EmpanelmentDashboardPage"));
const EmpanelmentReportsPage = lazy(() => import("./pages/empanelment/EmpanelmentReportsPage"));
const KnowledgeSearchPage = lazy(() => import("./pages/knowledge/KnowledgeSearchPage"));
const AddProjectPage = lazy(() => import("./pages/knowledge/AddProjectPage"));
const EditProjectPage = lazy(() => import("./pages/knowledge/EditProjectPage"));
const ProjectDetailsPage = lazy(() => import("./pages/knowledge/ProjectDetailsPage"));
const ShortlistsPage = lazy(() => import("./pages/knowledge/ShortlistsPage"));
const LeadListPage = lazy(() => import("./pages/leads/LeadListPage"));
const CreateLeadPage = lazy(() => import("./pages/leads/CreateLeadPage"));
const EditLeadPage = lazy(() => import("./pages/leads/EditLeadPage"));
const LeadDetailPage = lazy(() => import("./pages/leads/LeadDetailPage"));
const LeadApprovalNoteForm = lazy(() => import("./pages/leads/LeadApprovalNoteForm"));
const LeadApprovalNotePreviewPage = lazy(() => import("./pages/leads/LeadApprovalNotePreviewPage"));
const LeadDashboardPage = lazy(() => import("./pages/leads/LeadDashboardPage"));
const LeadReportsPage = lazy(() => import("./pages/leads/LeadReportsPage"));
const ProposalsListPage = lazy(() => import("./pages/proposals/ProposalsListPage"));
const ProposalPreparationPage = lazy(() => import("./pages/proposals/ProposalPreparationPage"));
const FeeNoteEditPage = lazy(() => import("./pages/proposals/FeeNoteEditPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));

import "./App.css";

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <ToastProvider>
            <AuthProvider>
              <Suspense fallback={<PageLoader />}>
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
                  path="/proposals/:leadId/fee-note"
                  element={
                    <ProtectedRoute allowedRoles={LEAD_GENERATION_NAV_ROLES}>
                      <FeeNoteEditPage />
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
              </Suspense>
            </AuthProvider>
          </ToastProvider>
        </ErrorBoundary>
      </BrowserRouter>
    </ThemeProvider>
  );
}

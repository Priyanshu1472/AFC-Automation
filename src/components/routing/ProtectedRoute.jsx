import { Navigate, useLocation } from "react-router-dom";
import PageLoader from "../ui/PageLoader";
import { useAuth } from "../../hooks/useAuth";

export default function ProtectedRoute({ children, allowedRoles }) {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <PageLoader />;

  if (!user) return <Navigate to="/login" replace />;

  // Profile fetch resolved but returned no row (e.g. account removed).
  if (!profile) return <Navigate to="/login" replace />;

  if (!profile.is_active) {
    return (
      <div className="page-loader">
        <div className="card" style={{ padding: "32px 40px", textAlign: "center", maxWidth: 360 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>🔒</div>
          <div className="text-danger" style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>
            Account Deactivated
          </div>
          <div className="text-secondary text-sm">
            Your account has been deactivated. Please contact your DGM or administrator.
          </div>
        </div>
      </div>
    );
  }

  if (profile.must_change_password && location.pathname !== "/change-password") {
    return <Navigate to="/change-password" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(profile.role)) {
    return <Navigate to="/home" replace />;
  }

  return children;
}

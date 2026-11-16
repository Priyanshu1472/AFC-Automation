import { Link, useLocation } from "react-router-dom";
import PageLoader from "../ui/PageLoader";
import Button from "../ui/Button";
import { useModules } from "../../context/ModulesContext";
import { useAuth } from "../../hooks/useAuth";
import { MODULE_LABELS, moduleForPath } from "../../lib/modules";

// Wraps every route that belongs to a module. While the module is switched
// OFF (production only) the page is replaced by "Coming Soon" — including
// direct links like /leads/123 and the public BP pages.
export default function ModuleGate({ module, children }) {
  const { loading, isEnabled } = useModules();
  if (loading) return <PageLoader />;
  if (isEnabled(module)) return children;
  return <ComingSoonPage module={module} />;
}

export function ComingSoonPage({ module }) {
  const { user } = useAuth();
  const label = MODULE_LABELS[module] || "This module";
  return (
    <div className="page-loader">
      <div className="card" style={{ padding: "40px 40px", textAlign: "center", maxWidth: 440 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }} aria-hidden="true">🚧</div>
        <h2 style={{ marginBottom: 8 }}>{label} is coming soon</h2>
        <p className="text-secondary text-sm" style={{ marginBottom: 24 }}>
          This part of the portal isn't available yet. It will open here as soon as it goes live.
        </p>
        <Link to={user ? "/home" : "/login"}>
          <Button variant="primary">{user ? "Go home" : "Go to login"}</Button>
        </Link>
      </div>
    </div>
  );
}

// Wraps <Routes>: gates whichever module the current URL belongs to (see
// moduleForPath), so every module route — present and future — is covered
// without wrapping each <Route> individually.
export function PathModuleGate({ children }) {
  const { pathname } = useLocation();
  const module = moduleForPath(pathname);
  if (!module) return children;
  return <ModuleGate module={module}>{children}</ModuleGate>;
}

import { Link } from "react-router-dom";
import Button from "../components/ui/Button";

export default function NotFoundPage() {
  return (
    <div className="page-loader">
      <div className="card" style={{ padding: "40px 40px", textAlign: "center", maxWidth: 420 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
        <h2 style={{ marginBottom: 8 }}>Page not found</h2>
        <p className="text-secondary text-sm" style={{ marginBottom: 24 }}>
          The page you're looking for doesn't exist or may have moved.
        </p>
        <Link to="/home">
          <Button variant="primary">Go home</Button>
        </Link>
      </div>
    </div>
  );
}

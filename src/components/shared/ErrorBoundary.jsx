import { Component } from "react";
import Button from "../ui/Button";

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Unhandled render error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="page-loader">
        <div className="card" style={{ padding: "40px 40px", textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ marginBottom: 8 }}>Something went wrong</h2>
          <p className="text-secondary text-sm" style={{ marginBottom: 24 }}>
            An unexpected error occurred. You can try reloading the page, or go back to the home page.
          </p>
          <div className="flex gap-2" style={{ justifyContent: "center" }}>
            <Button variant="secondary" onClick={() => (window.location.href = "/home")}>
              Go home
            </Button>
            <Button variant="primary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

// src/components/ui/PageLoader.jsx

/**
 * Full-page loading screen.
 * Props:
 *  text — string (default: "Loading...")
 *
 * Usage:
 *  if (loading) return <PageLoader />;
 */
export default function PageLoader({ text = "Loading..." }) {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <div className="page-loader-inner">
        <div className="page-loader-spinner" aria-hidden="true">
          <div className="page-loader-ring" />
        </div>
        <span className="page-loader-text">{text}</span>
      </div>
    </div>
  );
}
// Admin-only "Rebuild Index" action for Find Relevant Experience search
// (spec §18). Mainly useful for projects that existed before this feature
// shipped, or that were inserted outside the normal Add/Edit Project form
// (bulk import, etc.) — day-to-day additions are already indexed
// automatically on save (see useProjectIndexing.js). Safe to run
// repeatedly: unchanged projects are skipped via content-hash comparison,
// so re-running after a partial run just picks up where it left off.
import { useState, useEffect, useCallback } from "react";
import { supabase } from "../../lib/supabase";
import { useProjectIndexing } from "../../hooks/useProjectIndexing";
import Modal from "../ui/Modal";
import Button from "../ui/Button";

function fmtDate(iso) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function RebuildIndexPanel({ onClose }) {
  const { bulkReindexAll } = useProjectIndexing();
  const [stats, setStats] = useState(null);
  const [loadingStats, setLoadingStats] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    const [{ count: totalProjects }, { data: embeddings }] = await Promise.all([
      supabase.from("projects").select("id", { count: "exact", head: true }),
      supabase.from("project_experience_embeddings").select("indexed_at").not("embedding", "is", null),
    ]);
    const lastIndexedAt = (embeddings || []).reduce((max, e) => (e.indexed_at && (!max || e.indexed_at > max) ? e.indexed_at : max), null);
    setStats({ totalProjects: totalProjects || 0, indexedCount: (embeddings || []).length, lastIndexedAt });
    setLoadingStats(false);
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  async function handleRebuild() {
    setRunning(true);
    setError("");
    setResult(null);
    setProgress({ done: 0, total: stats?.totalProjects || 0, indexed: 0, skipped: 0, failed: 0 });
    try {
      const outcome = await bulkReindexAll(setProgress);
      setResult(outcome);
      await loadStats();
    } catch (err) {
      setError(err.message || "Rebuild failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md">
      <Modal.Header title="Search Index" subtitle="Powers Find Relevant Experience — keeps every project's searchable text up to date." onClose={onClose} />
      <Modal.Body>
        {error && <div className="field-error" style={{ marginBottom: "var(--space-3)" }}>{error}</div>}

        {loadingStats ? (
          <p className="text-secondary text-sm">Loading…</p>
        ) : (
          <div className="pp-list-group" style={{ marginBottom: "var(--space-4)" }}>
            <div className="pp-list-row">
              <div className="pp-list-row-title">Projects indexed</div>
              <div className="detail-value">{stats.indexedCount} / {stats.totalProjects}</div>
            </div>
            <div className="pp-list-row">
              <div className="pp-list-row-title">Last indexed</div>
              <div className="detail-value">{fmtDate(stats.lastIndexedAt)}</div>
            </div>
          </div>
        )}

        {progress && (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <div className="text-secondary text-sm" style={{ marginBottom: 4 }}>
              {running ? `Indexing… ${progress.done} / ${progress.total}` : `Done — ${progress.done} / ${progress.total}`}
              {" "}({progress.indexed} indexed, {progress.skipped} unchanged{progress.failed ? `, ${progress.failed} failed` : ""})
            </div>
            <div style={{ height: 6, borderRadius: "var(--radius-full)", background: "var(--bg-surface-2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, background: "var(--brand-500)", transition: "width 150ms ease-out" }} />
            </div>
          </div>
        )}

        {result && result.failed.length > 0 && (
          <div className="pp-list-group" style={{ marginBottom: "var(--space-4)" }}>
            <div className="pp-list-group-label">Could not index ({result.failed.length}) — retry with "Rebuild Index"</div>
            {result.failed.map(({ project }) => (
              <div className="pp-list-row" key={project.id}>
                <div className="pp-list-row-title">{project.title}</div>
              </div>
            ))}
          </div>
        )}

        <Button variant="primary" onClick={handleRebuild} loading={running} disabled={loadingStats}>
          Rebuild Index
        </Button>
      </Modal.Body>
    </Modal>
  );
}

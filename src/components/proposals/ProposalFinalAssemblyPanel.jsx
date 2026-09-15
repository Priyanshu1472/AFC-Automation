// "Final Proposal" — the entry point to Generate Final Proposal
// (ProposalAssemblyModal) plus a history of past generation jobs. Each
// job is processed out-of-band by proposal-worker (see its README); this
// panel just creates jobs and reflects their status back, live, via
// Supabase Realtime on proposal_generation_jobs.
import { useState, useEffect, useCallback } from "react";
import { supabase, extractFunctionErrorMessage } from "../../lib/supabase";
import Card from "../ui/Card";
import Collapsible from "../ui/Collapsible";
import Badge from "../ui/Badge";
import Button from "../ui/Button";
import Alert from "../ui/Alert";
import { MergeIcon } from "../icons";
import ProposalAssemblyModal from "./ProposalAssemblyModal";

const STATUS_META = {
  queued: { label: "Queued", variant: "neutral" },
  processing: { label: "Processing…", variant: "warning" },
  completed: { label: "Ready", variant: "success" },
  failed: { label: "Failed", variant: "danger" },
};

function fmtDateTime(d) {
  return new Date(d).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ProposalFinalAssemblyPanel({ proposalId, baItems, checklistItems, documents, canManage, locked }) {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [error, setError] = useState("");
  const [openingId, setOpeningId] = useState(null);

  const fetchJobs = useCallback(async () => {
    const { data } = await supabase
      .from("proposal_generation_jobs")
      .select("*")
      .eq("proposal_id", proposalId)
      .order("created_at", { ascending: false });
    setJobs(data || []);
    setLoading(false);
  }, [proposalId]);

  useEffect(() => { fetchJobs(); }, [fetchJobs]);

  useEffect(() => {
    const channel = supabase
      .channel(`proposal-jobs-${proposalId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "proposal_generation_jobs", filter: `proposal_id=eq.${proposalId}` }, () => fetchJobs())
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [proposalId, fetchJobs]);

  async function handleView(job) {
    setError("");
    setOpeningId(job.id);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("get-proposal-document-url", {
        body: { path: job.output_file_path, proposal_id: proposalId },
      });
      if (fnError) { setError(await extractFunctionErrorMessage(fnError, "Failed to open document.")); return; }
      if (!data?.url) { setError(data?.error || "Failed to open document."); return; }
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setOpeningId(null);
    }
  }

  const latest = jobs[0];
  const hasActiveJob = !!latest && ["queued", "processing"].includes(latest.status);

  return (
    <Card>
      <Collapsible
        title="Final Proposal"
        subtitle="Assemble the documents collected above into one client-facing PDF."
        icon={<MergeIcon />}
        action={latest && <Badge variant={STATUS_META[latest.status]?.variant || "neutral"}>{STATUS_META[latest.status]?.label || latest.status}</Badge>}
      >
        {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

        {canManage && !locked && (
          <div style={{ marginBottom: "var(--space-4)" }}>
            <Button variant="primary" disabled={hasActiveJob} onClick={() => setShowModal(true)}>
              {hasActiveJob ? "Generating…" : "Generate Final Proposal"}
            </Button>
          </div>
        )}

        {loading ? (
          <p className="text-secondary text-sm">Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-secondary text-sm" style={{ margin: 0 }}>No final proposal generated yet.</p>
        ) : (
          <div>
            <div className="pp-list-group-label">Generation History</div>
            {jobs.map((job) => (
              <div key={job.id} className="pp-job-row">
                <div className="pp-job-meta">
                  <span className="pp-job-date">{fmtDateTime(job.created_at)} · {(job.selected_items || []).length} document{(job.selected_items || []).length === 1 ? "" : "s"}</span>
                  {job.status === "failed" && job.error_message && <span className="pp-job-error">{job.error_message}</span>}
                  {job.status === "completed" && job.output_file_name && (
                    <span className="pp-list-row-sub">{job.output_file_name}{job.output_file_size ? ` (${fmtSize(job.output_file_size)})` : ""}</span>
                  )}
                </div>
                <div className="pp-job-actions">
                  <Badge variant={STATUS_META[job.status]?.variant || "neutral"}>{STATUS_META[job.status]?.label || job.status}</Badge>
                  {job.status === "completed" && (
                    <Button variant="secondary" size="sm" loading={openingId === job.id} onClick={() => handleView(job)}>View</Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Collapsible>

      {showModal && (
        <ProposalAssemblyModal
          proposalId={proposalId}
          baItems={baItems}
          checklistItems={checklistItems}
          documents={documents}
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); fetchJobs(); }}
        />
      )}
    </Card>
  );
}

// Proposal Prep landing page — every MD-approved lead visible to the
// caller (RLS-scoped via can_view_lead, same as LeadListPage), with a
// quick look at lock/outcome state. "Open" only appears for md/admin or
// the lead's three assignees, same rule as LeadListPage/LeadDetailPage's
// row action — this page exists so that rule has somewhere to be browsed
// from besides the Leads table itself.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import { ArrowRightIcon } from "../../components/icons";
import { CLIENT_RESPONSE_LABELS, CLIENT_RESPONSE_VARIANTS, canOpenProposal } from "../../lib/proposalPrep";
import "../../styles/ProposalPreparationPage.css";

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export default function ProposalsListPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [leads, setLeads] = useState([]);
  const [proposalByLead, setProposalByLead] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const fetchAll = useCallback(async () => {
    const { data: leadRows, error: err } = await supabase
      .from("leads")
      .select("*, pr:person_responsible_id(full_name), ba:assigned_ba_id(full_name)")
      .eq("status", "md_approved")
      .order("created_at", { ascending: false });
    if (err) { setError(err.message); setLoading(false); return; }
    const rows = leadRows || [];
    setLeads(rows);

    const leadIds = rows.map((l) => l.id);
    const { data: proposalRows } = leadIds.length
      ? await supabase.from("proposal_preparations").select("*").in("lead_id", leadIds)
      : { data: [] };

    const propByLead = Object.fromEntries((proposalRows || []).map((p) => [p.lead_id, p]));
    setProposalByLead(propByLead);

    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const filtered = leads.filter((l) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (l.lead_number || "").toLowerCase().includes(s) ||
      (l.client_name || "").toLowerCase().includes(s) ||
      (l.ba?.full_name || "").toLowerCase().includes(s)
    );
  });

  if (loading) return <PageLoader text="Loading proposals…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="pp-page animate-fadeUp">
          <div className="page-header">
            <div className="page-title-row">
              <div>
                <h1>Proposal Preparation</h1>
                <p>MD-approved leads ready for fee notes, documents, and submission.</p>
              </div>
            </div>
          </div>

          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

          <Card className="pp-filter-card">
            <Card.Body className="pp-filters">
              <input type="text" className="input pp-search" placeholder="Search by lead number, client, or BA…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Card.Body>
          </Card>

          <Card>
            {filtered.length === 0 ? (
              <div className="pp-empty">No proposals in preparation yet — an approved lead will show up here.</div>
            ) : (
              <div className="pp-table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Lead Number</th><th>Client</th><th>BA</th><th>Person Responsible</th><th>Submission Date</th><th>Status</th><th>Outcome</th><th>Actions</th></tr>
                  </thead>
                  <tbody>
                    {filtered.map((l) => {
                      const proposal = proposalByLead[l.id];
                      const overdue = !!l.submission_deadline && new Date(l.submission_deadline) < new Date() && !proposal?.locked;
                      const canOpen = canOpenProposal(l, profile);
                      return (
                        <tr key={l.id}>
                          <td>
                            <button type="button" className="pp-lead-number-link" onClick={() => navigate(`/leads/${l.id}`)}>
                              {l.lead_number}
                            </button>
                          </td>
                          <td>{l.client_name || <span className="pp-td-muted">—</span>}</td>
                          <td className="pp-td-muted">{l.ba?.full_name || "—"}</td>
                          <td className="pp-td-muted">{l.pr?.full_name || "—"}</td>
                          <td className={overdue ? "pp-td-date--overdue" : ""}>{fmtDate(l.submission_deadline)}</td>
                          <td>
                            <Badge className="pp-status-badge" variant={proposal?.locked ? "neutral" : "success"}>{proposal?.locked ? "Locked" : proposal ? "In Progress" : "Not Started"}</Badge>
                          </td>
                          <td>
                            {proposal ? (
                              <Badge className="pp-outcome-badge" variant={CLIENT_RESPONSE_VARIANTS[proposal.client_response]}>{CLIENT_RESPONSE_LABELS[proposal.client_response]}</Badge>
                            ) : (
                              <span className="pp-td-muted">—</span>
                            )}
                          </td>
                          <td>
                            {canOpen ? (
                              <button type="button" className="pp-icon-btn" title="Open Proposal" aria-label="Open proposal" onClick={() => navigate(`/proposals/${l.id}`)}>
                                <ArrowRightIcon />
                              </button>
                            ) : (
                              <span className="pp-td-muted">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

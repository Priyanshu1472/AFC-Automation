import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Badge from "../../components/ui/Badge";
import Button from "../../components/ui/Button";
import Select from "../../components/ui/Select";
import PageLoader from "../../components/ui/PageLoader";
import FilterDrawer, { FilterButton, FilterField } from "../../components/ui/FilterDrawer";
import "../../styles/EmpanelmentListPage.css";

function fmt(val) { return val === null || val === undefined || val === "" ? "—" : val; }
function fmtDate(val) { if (!val) return "—"; return new Date(val).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }); }
function fmtMoney(val) { if (val === null || val === undefined || val === "") return "—"; return "INR " + Number(val).toLocaleString("en-IN"); }
function fmtJsonb(val) {
  if (!val) return "—";
  try { const obj = typeof val === "string" ? JSON.parse(val) : val; return Object.entries(obj).map(([k, v]) => `${k}: ${v}`).join(" | "); }
  catch { return String(val); }
}

const STATUS_MAP = {
  sent: { label: "Sent", variant: "info" },
  filled: { label: "BA Filled", variant: "warning" },
  po_review: { label: "PO Review", variant: "warning" },
  cfo_cs_review: { label: "CFO/CS Review", variant: "info" },
  po_final_review: { label: "PO Final", variant: "warning" },
  dgm_review: { label: "DGM Review", variant: "neutral" },
  md_review: { label: "MD Review", variant: "neutral" },
  accepted: { label: "Accepted", variant: "success" },
  rejected: { label: "Rejected", variant: "danger" },
  on_hold: { label: "On Hold", variant: "warning" },
};

const STATUS_OPTIONS = [
  { value: "all", label: "All Statuses" },
  ...Object.entries(STATUS_MAP).map(([value, cfg]) => ({ value, label: cfg.label })),
];

function StatusBadge({ status }) {
  const config = STATUS_MAP[status] || { label: status, variant: "neutral" };
  return <Badge variant={config.variant} dot className="bl-status-badge">{config.label}</Badge>;
}

function SearchIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>;
}
function CloseIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
}

function DetailSection({ title, children }) {
  return (
    <div className="bl-modal-section">
      <h4 className="bl-modal-section-title">{title}</h4>
      <div className="bl-modal-fields">{children}</div>
    </div>
  );
}
function DetailField({ label, value }) {
  return (
    <div className="bl-modal-field">
      <span className="bl-modal-field-label">{label}</span>
      <span className="bl-modal-field-value">{value || "—"}</span>
    </div>
  );
}

function BADetailModal({ ba, invStatus, onClose }) {
  if (!ba) return null;
  return (
    <div className="bl-modal-backdrop" onClick={onClose}>
      <div className="bl-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="bl-modal-header">
          <div className="bl-modal-header-info">
            <h2 className="bl-modal-org">{fmt(ba.org_name)}</h2>
            <p className="bl-modal-sub">{fmt(ba.contact_person)} · {fmt(ba.email)} · {fmt(ba.phone)}</p>
          </div>
          <div className="bl-modal-header-right">
            <StatusBadge status={invStatus} />
            <button className="bl-modal-close" onClick={onClose} aria-label="Close"><CloseIcon /></button>
          </div>
        </div>
        <div className="bl-modal-body">
          <DetailSection title="Organisation Details">
            <DetailField label="Organisation Name" value={fmt(ba.org_name)} />
            <DetailField label="Entity Type" value={fmt(ba.entity_type)} />
            <DetailField label="Year Established" value={fmt(ba.year_established)} />
            <DetailField label="CIN" value={fmt(ba.cin)} />
            <DetailField label="Date of Incorporation" value={fmtDate(ba.date_of_incorporation)} />
            <DetailField label="Companies Act Status" value={fmt(ba.companies_act_status)} />
            <DetailField label="Company Status" value={fmt(ba.company_status)} />
            <DetailField label="PAN" value={fmt(ba.pan)} />
            <DetailField label="GST" value={fmt(ba.gst)} />
            <DetailField label="MSME No." value={fmt(ba.msme_no)} />
            <DetailField label="Website" value={fmt(ba.website)} />
          </DetailSection>
          <DetailSection title="Address">
            <DetailField label="Registered Address" value={fmt(ba.reg_address)} />
            <DetailField label="Branch Address" value={fmt(ba.branch_address)} />
          </DetailSection>
          <DetailSection title="Contact Person">
            <DetailField label="Name" value={fmt(ba.contact_person)} />
            <DetailField label="Designation" value={fmt(ba.designation)} />
            <DetailField label="Email" value={fmt(ba.email)} />
            <DetailField label="Phone" value={fmt(ba.phone)} />
          </DetailSection>
          <DetailSection title="Financial Details">
            <DetailField label="Authorised Capital" value={fmtMoney(ba.authorised_capital)} />
            <DetailField label="Paid-up Capital" value={fmtMoney(ba.paidup_capital)} />
            <DetailField label="Working Capital Ratio" value={fmt(ba.working_capital_ratio)} />
            <DetailField label="Last BS Filed" value={fmtDate(ba.last_bs_filed)} />
            <DetailField label="Net Worth" value={fmtJsonb(ba.net_worth)} />
            <DetailField label="Turnover" value={fmtJsonb(ba.turnover)} />
            <DetailField label="PAT" value={fmtJsonb(ba.pat)} />
            <DetailField label="CA Firm Name" value={fmt(ba.ca_firm_name)} />
            <DetailField label="CA Reg. No." value={fmt(ba.ca_reg_no)} />
            <DetailField label="Director KYC" value={fmt(ba.director_kyc)} />
          </DetailSection>
          <DetailSection title="Business Profile">
            <DetailField label="Core Expertise" value={fmt(ba.core_expertise)} />
            <DetailField label="Sectors Served" value={Array.isArray(ba.sectors_served) ? ba.sectors_served.join(", ") : fmt(ba.sectors_served)} />
            <DetailField label="Team Size" value={fmt(ba.team_size)} />
            <DetailField label="Years Experience" value={fmt(ba.years_experience)} />
            <DetailField label="Certifications" value={fmt(ba.certifications)} />
            <DetailField label="Govt. Empanelments" value={fmt(ba.govt_empanelments)} />
            <DetailField label="Assignments" value={fmtJsonb(ba.assignments)} />
          </DetailSection>
          <DetailSection title="Bank Details">
            <DetailField label="Bank Name" value={fmt(ba.bank_name)} />
            <DetailField label="Branch" value={fmt(ba.bank_branch)} />
            <DetailField label="Account Number" value={fmt(ba.account_number)} />
            <DetailField label="IFSC Code" value={fmt(ba.ifsc_code)} />
          </DetailSection>
          <p className="bl-modal-submitted">Submitted: {fmtDate(ba.submitted_at)}</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, colorClass, loading }) {
  return (
    <div className={`bl-stat-card bl-stat-${colorClass}`}>
      <div className="bl-stat-value">{loading ? "—" : value}</div>
      <div className="bl-stat-label">{label}</div>
    </div>
  );
}

export default function EmpanelmentListPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [applications, setApplications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedBA, setSelectedBA] = useState(null);
  const [selectedStatus, setSelectedStatus] = useState(null);
  const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

  const fetchApplications = useCallback(async () => {
    // RLS (can_view_empanelment_application) scopes the visible rows
    // automatically per role/team — no client-side team filter needed.
    const { data, error } = await supabase
      .from("empanelment_applications")
      .select("*, ba_reg:ba_registrations(*)")
      .order("created_at", { ascending: false });
    if (!error) {
      setApplications((data || []).map((a) => ({ ...a, ba_reg: Array.isArray(a.ba_reg) ? a.ba_reg[0] || null : a.ba_reg })));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchApplications();
  }, [fetchApplications]);

  // Realtime: any change to an application visible to this user (RLS still
  // governs what postgres_changes actually delivers) triggers a light
  // refetch — no manual reload needed to see other reviewers' actions.
  useEffect(() => {
    const channel = supabase
      .channel("empanelment-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "empanelment_applications" }, () => fetchApplications())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchApplications]);

  const stats = useMemo(() => ({
    total: applications.length,
    inReview: applications.filter((a) => ["po_review", "cfo_cs_review", "po_final_review", "dgm_review", "md_review", "on_hold"].includes(a.status)).length,
    accepted: applications.filter((a) => a.status === "accepted").length,
    rejected: applications.filter((a) => a.status === "rejected").length,
  }), [applications]);

  const filtered = applications.filter((a) => {
    const q = search.toLowerCase();
    const sectorsServed = Array.isArray(a.ba_reg?.sectors_served) ? a.ba_reg.sectors_served.join(" ") : (a.ba_reg?.sectors_served || "");
    const assignments = a.ba_reg?.assignments ? (typeof a.ba_reg.assignments === "string" ? a.ba_reg.assignments : JSON.stringify(a.ba_reg.assignments)) : "";
    const matchSearch =
      (a.ba_email || "").toLowerCase().includes(q) ||
      (a.ba_reg?.org_name || "").toLowerCase().includes(q) ||
      (a.ba_reg?.contact_person || "").toLowerCase().includes(q) ||
      (a.application_code || "").includes(search) ||
      (a.ba_reg?.core_expertise || "").toLowerCase().includes(q) ||
      sectorsServed.toLowerCase().includes(q) ||
      assignments.toLowerCase().includes(q);
    return matchSearch && (statusFilter === "all" || a.status === statusFilter);
  });

  const canSend = ["associate_consultant", "project_assistant"].includes(profile?.role);
  // Admin included so it can open the full read-only review page (timeline,
  // documents, etc.) — it has no action branch there, so it lands view-only.
  const canReview = ["project_officer", "cfo", "cs", "dgm", "md", "admin"].includes(profile?.role);

  if (loading) return <PageLoader text="Loading applications…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="bl-page">
          <div className="page-header">
            <div className="page-title-row">
              <div>
                <h1>Empanelment Applications</h1>
              </div>
              {canSend && (
                <Button variant="primary" onClick={() => navigate("/empanelment/send")}>+ Send Empanelment Form</Button>
              )}
            </div>
          </div>

          <div className="bl-stats-grid">
            <StatCard label="Total" value={stats.total} colorClass="blue" loading={loading} />
            <StatCard label="In Review" value={stats.inReview} colorClass="purple" loading={loading} />
            <StatCard label="Accepted" value={stats.accepted} colorClass="green" loading={loading} />
            <StatCard label="Rejected" value={stats.rejected} colorClass="red" loading={loading} />
          </div>

          <Card className="bl-filter-card">
            <Card.Body className="bl-filters">
              <div className="bl-search-wrapper">
                <span className="bl-search-icon"><SearchIcon /></span>
                <input type="text" className="input bl-search" placeholder="Search by email, organisation, contact, app code, sector, expertise…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="bl-filter-right">
                <FilterButton onClick={() => setFilterDrawerOpen(true)} activeCount={statusFilter !== "all" ? 1 : 0} />
              </div>
            </Card.Body>
          </Card>

          <Card>
            {filtered.length === 0 ? (
              <div className="bl-empty"><p>No records found.</p></div>
            ) : (
              <div className="bl-table-scroll">
                <table className="table bl-table">
                  <thead>
                    <tr>
                      <th>App Code</th><th>BA Email</th><th>Organisation</th>
                      <th>Contact</th><th>Team</th><th>Sent On</th><th>Status</th><th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((a) => (
                      <tr key={a.id}>
                        <td><span className="bl-app-code">{a.application_code || "—"}</span></td>
                        <td className="bl-email" title={a.ba_email || ""}>{fmt(a.ba_email)}</td>
                        <td>{a.ba_reg?.org_name ? <span className="bl-org" title={a.ba_reg.org_name}>{fmt(a.ba_reg.org_name)}</span> : <span className="bl-not-filled">Not filled yet</span>}</td>
                        <td className="bl-contact" title={a.ba_reg?.contact_person || ""}>{fmt(a.ba_reg?.contact_person)}</td>
                        <td>{a.team ? <Badge variant="neutral">{a.team}</Badge> : "—"}</td>
                        <td className="bl-date">{fmtDate(a.created_at)}</td>
                        <td><StatusBadge status={a.status} /></td>
                        <td>
                          <div className="bl-actions">
                            {a.ba_reg && (
                              <Button variant="secondary" size="sm" onClick={() => { setSelectedBA(a.ba_reg); setSelectedStatus(a.status); }}>View</Button>
                            )}
                            {a.ba_reg && canReview && (
                              <Button variant="primary" size="sm" onClick={() => navigate(`/empanelment/${a.id}`)}>Review</Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <p className="bl-record-count">Showing {filtered.length} of {applications.length} records</p>
        </div>
      </div>

      <BADetailModal ba={selectedBA} invStatus={selectedStatus} onClose={() => { setSelectedBA(null); setSelectedStatus(null); }} />

      <FilterDrawer open={filterDrawerOpen} onClose={() => setFilterDrawerOpen(false)} onReset={() => setStatusFilter("all")}>
        <FilterField label="Status">
          <Select options={STATUS_OPTIONS} value={statusFilter} onChange={setStatusFilter} placeholder="All Statuses" />
        </FilterField>
      </FilterDrawer>
    </div>
  );
}

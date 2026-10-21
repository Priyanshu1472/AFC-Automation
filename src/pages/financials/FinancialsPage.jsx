// Financials — the invoice ledger across every monitored project the
// caller can see. Top: billable milestones/deliverables that are complete
// but not invoiced yet. Below: each client invoice with its payment and
// the Business Partner's leg (invoice requested → received → paid), using
// the same InvoiceList as a project's own Invoices section in Monitoring.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { can } from "../../lib/roles";
import AppHeader from "../../components/shared/AppHeader";
import Card from "../../components/ui/Card";
import Collapsible from "../../components/ui/Collapsible";
import Button from "../../components/ui/Button";
import Alert from "../../components/ui/Alert";
import PageLoader from "../../components/ui/PageLoader";
import InvoiceList from "../../components/financials/InvoiceList";
import { BellIcon } from "../../components/icons";
import {
  PROJECT_SELECT, CLIENT_INVOICE_SELECT, canEditProject, buildInvoiceEntries, formatINR, fmtDate, needsInvoice, invoiceTotals, roundMoney,
} from "../../lib/monitoring";
import "../../styles/ProposalPreparationPage.css";
import "../../styles/Monitoring.css";

const VIEWS = [
  { key: "all", label: "All", match: () => true },
  { key: "pending_cfo", label: "Awaiting CFO Approval", match: (e) => e.invoice.status === "pending_cfo" },
  { key: "rejected", label: "Sent Back by CFO", match: (e) => e.invoice.status === "rejected" },
  { key: "awaiting_client", label: "Awaiting Client Payment", match: (e) => e.invoice.status === "raised" },
  { key: "awaiting_bp", label: "Awaiting BP Invoice", match: (e) => e.project.hasBp && e.invoice.status === "paid" && (!e.bpInvoice || e.bpInvoice.status === "requested") },
  { key: "note_due", label: "Payment Note Due", match: (e) => e.bpInvoice?.status === "received" && e.paymentNote?.status !== "sent" },
  { key: "with_accounts", label: "With Accounts", match: (e) => e.bpInvoice?.status === "received" && e.paymentNote?.status === "sent" },
  { key: "settled", label: "Settled", match: (e) => e.invoice.status === "paid" && (!e.project.hasBp || e.bpInvoice?.status === "paid") },
];

export default function FinancialsPage() {
  const navigate = useNavigate();
  const { profile, activeTeam } = useAuth();
  const [projects, setProjects] = useState([]);
  const [items, setItems] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [bpInvoices, setBpInvoices] = useState([]);
  const [paymentNotes, setPaymentNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The CFO lands on their own queue: invoices waiting for their approval
  // and signature, ahead of the older "ready to pay a BP" queue.
  const [view, setView] = useState(() => (profile?.role === "cfo" ? "pending_cfo" : "all"));
  const [search, setSearch] = useState("");

  const fetchAll = useCallback(async () => {
    const [p, it, inv, bp, notes] = await Promise.all([
      supabase.from("monitoring_projects").select(PROJECT_SELECT),
      supabase.from("monitoring_items").select("id, project_id, kind, parent_id, title, status, completed_at, invoice_on_completion, invoice_amount"),
      supabase.from("client_invoices").select(CLIENT_INVOICE_SELECT).order("invoice_date", { ascending: false }),
      supabase.from("bp_invoices").select("*"),
      supabase.from("bp_payment_notes").select("*"),
    ]);
    if (p.error || inv.error) setError((p.error || inv.error).message);
    setProjects(p.data || []);
    setItems(it.data || []);
    setInvoices(inv.data || []);
    setBpInvoices(bp.data || []);
    setPaymentNotes(notes.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const scopedProjects = useMemo(
    () => (can.viewAllTeams(profile?.role) || !activeTeam ? projects : projects.filter((p) => p.lead?.team === activeTeam)),
    [projects, profile?.role, activeTeam]
  );
  const projectsById = useMemo(() => Object.fromEntries(scopedProjects.map((p) => [p.id, p])), [scopedProjects]);
  const itemsById = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);

  const entries = useMemo(
    () => buildInvoiceEntries({ invoices: invoices.filter((i) => projectsById[i.project_id]), bpInvoices, paymentNotes, projectsById, itemsById, profile }),
    [invoices, bpInvoices, paymentNotes, projectsById, itemsById, profile]
  );

  const toInvoice = useMemo(
    () => items.filter((i) => projectsById[i.project_id] && needsInvoice(i, invoices, items)),
    [items, invoices, projectsById]
  );

  const totals = useMemo(() => {
    const t = { ...invoiceTotals(entries.map((e) => e.invoice)), contract: 0, toInvoice: 0, bpDue: 0, bpDueCount: 0, bpPaid: 0, bpAwaiting: 0 };
    t.noContract = 0;
    for (const p of scopedProjects) {
      if (p.contract_value == null) {
        if (p.status !== "completed") t.noContract += 1;
        continue;
      }
      t.contract += Number(p.contract_value);
      const billed = entries.filter((e) => e.project.id === p.id).reduce((s, e) => s + Number(e.invoice.amount || 0), 0);
      t.toInvoice += Math.max(Number(p.contract_value) - billed, 0);
    }
    for (const e of entries) {
      if (e.bpInvoice?.status === "received") { t.bpDue += Number(e.bpInvoice.amount || 0); t.bpDueCount += 1; }
      if (e.bpInvoice?.status === "paid") t.bpPaid += Number(e.bpInvoice.paid_amount || 0);
      if (e.bpInvoice?.status === "requested") t.bpAwaiting += 1;
    }
    for (const k of ["contract", "toInvoice", "bpDue", "bpPaid"]) t[k] = roundMoney(t[k]);
    return t;
  }, [entries, scopedProjects]);

  const counts = useMemo(() => Object.fromEntries(VIEWS.map((v) => [v.key, entries.filter(v.match).length])), [entries]);

  const shown = useMemo(() => {
    const match = VIEWS.find((v) => v.key === view).match;
    const s = search.trim().toLowerCase();
    return entries.filter((e) => match(e) && (!s || [e.invoice.invoice_number, e.project.title, e.project.bpName, e.bpInvoice?.invoice_number, projectsById[e.project.id]?.lead?.client_name]
      .some((v) => (v || "").toLowerCase().includes(s))));
  }, [entries, view, search, projectsById]);

  if (loading) return <PageLoader text="Loading financials…" />;

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="pp-page animate-fadeUp">
          <div className="page-header">
            <div className="page-title-row">
              <div>
                <h1>Financials</h1>
                <p>Client invoices, payments received, and Business Partner invoices and payouts.</p>
              </div>
            </div>
          </div>

          {error && <Alert variant="danger" onClose={() => setError("")}>{error}</Alert>}

          <div className="mon-kpis mon-kpis-5">
            {[
              {
                label: "Contract Value", value: totals.contract, tone: "blue",
                sub: [
                  `${formatINR(totals.toInvoice, { decimals: false })} yet to invoice`,
                  totals.noContract ? `${totals.noContract} project${totals.noContract === 1 ? "" : "s"} without a value` : "",
                ].filter(Boolean).join(" · "),
              },
              {
                label: "Invoiced", value: totals.invoiced, tone: "purple",
                sub: `${entries.length} invoice${entries.length === 1 ? "" : "s"} · incl. ${formatINR(totals.gst, { decimals: false })} GST`,
              },
              {
                label: "Received", value: totals.received, tone: "green",
                sub: `${counts.all - counts.awaiting_client} of ${counts.all} invoice${counts.all === 1 ? "" : "s"} paid`,
              },
              {
                label: "Outstanding from Clients", value: totals.outstanding, tone: "amber", warn: totals.outstanding > 0,
                sub: totals.outstanding <= 0
                  ? "Nothing outstanding"
                  : [
                      totals.unpaid ? `${totals.unpaid} unpaid (${formatINR(totals.unpaidAmount, { decimals: false })})` : "",
                      totals.shortPaid ? `${totals.shortPaid} short-paid (${formatINR(totals.shortAmount, { decimals: false })})` : "",
                    ].filter(Boolean).join(" · "),
              },
              {
                label: "Payable to BPs", value: totals.bpDue, tone: "red", warn: totals.bpDue > 0,
                sub: [
                  `${formatINR(totals.bpPaid, { decimals: false })} paid`,
                  totals.bpAwaiting ? `${totals.bpAwaiting} awaiting BP invoice` : "",
                ].filter(Boolean).join(" · "),
              },
            ].map((k) => (
              <div key={k.label} className={`mon-kpi mon-kpi-${k.tone}`}>
                <span className="mon-kpi-label">{k.label}</span>
                <span className={`mon-kpi-value${k.warn ? " is-warn" : ""}`}>{formatINR(k.value, { decimals: false })}</span>
                <span className="mon-kpi-sub">{k.sub}</span>
              </div>
            ))}
          </div>

          {toInvoice.length > 0 && (
            <Card className="mon-alerts-card">
              <Collapsible title="Ready to Invoice" subtitle="Completed billable milestones and deliverables with no client invoice yet." icon={<BellIcon />}>
                <ul className="mon-alerts">
                  {toInvoice.map((i) => {
                    const p = projectsById[i.project_id];
                    return (
                      <li key={i.id} className="mon-alert is-danger">
                        <span className="mon-alert-dot" aria-hidden="true" />
                        <span className="mon-alert-text">
                          <strong>{i.title}</strong>
                          {" — "}
                          <button type="button" className="mon-link" onClick={() => navigate(`/monitoring/${i.project_id}`)}>{p?.lead?.title}</button>
                          {i.invoice_amount != null ? ` · ${formatINR(i.invoice_amount)}` : ""}
                          {i.completed_at ? ` · completed ${fmtDate(i.completed_at)}` : ""}
                        </span>
                        {canEditProject(p, profile) && <Button size="sm" onClick={() => navigate(`/monitoring/${i.project_id}/invoice?item=${i.id}&back=financials`)}>Raise Invoice</Button>}
                      </li>
                    );
                  })}
                </ul>
              </Collapsible>
            </Card>
          )}

          <Card className="pp-filter-card">
            <Card.Body className="mon-toolbar">
              <div className="mon-chips" role="tablist" aria-label="Filter invoices">
                {VIEWS.map((v) => (
                  <button key={v.key} type="button" role="tab" aria-selected={view === v.key} className={`mon-chip${view === v.key ? " is-active" : ""}`} onClick={() => setView(v.key)}>
                    {v.label} <span>{counts[v.key]}</span>
                  </button>
                ))}
              </div>
              <input type="text" className="input mon-search" placeholder="Search invoice no., project, client, BP…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </Card.Body>
          </Card>

          <Card>
            <InvoiceList
              entries={shown}
              showProject
              emptyText={entries.length === 0 ? "No invoices yet — raise one from a project in Monitoring, or from “Ready to Invoice” above." : "No invoices in this view."}
              onChanged={fetchAll}
            />
          </Card>
        </div>
      </div>

    </div>
  );
}

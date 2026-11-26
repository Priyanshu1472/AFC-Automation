import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";
import Card from "../ui/Card";
import Badge from "../ui/Badge";

function fmtDate(val) {
  if (!val) return "-";
  return new Date(val).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// Business Partners that were empanelled before PMIS and added by name on
// the lead form (manual_business_partners) — listed separately from the
// PMIS empanelment applications so it's clear which BPs are already
// empanelled outside PMIS. Org-wide: every team's manual BPs.
export default function ManualBusinessPartnersList({ onCount }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    supabase.rpc("get_manual_business_partners").then(({ data }) => {
      setRows(data || []);
      setLoading(false);
      onCount?.((data || []).length);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.org_name} ${r.team || ""} ${r.created_by_name || ""}`.toLowerCase().includes(q));
  }, [rows, search]);

  return (
    <>
      <Card className="bl-filter-card">
        <Card.Body className="bl-filters">
          <div className="bl-search-wrapper" style={{ flex: 1 }}>
            <input type="text" className="input bl-search" style={{ paddingLeft: 12 }} placeholder="Search by organisation, team, added by…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </Card.Body>
      </Card>
      <p className="bl-record-count" style={{ margin: "0 0 var(--space-3)" }}>
        Business Partners empanelled before PMIS, added by name while creating a lead. They appear in the Business Partner list on every new lead.
      </p>
      <Card>
        {loading ? (
          <div className="bl-empty"><p>Loading…</p></div>
        ) : filtered.length === 0 ? (
          <div className="bl-empty"><p>{rows.length ? "No records found." : "No Business Partners have been added manually yet."}</p></div>
        ) : (
          <div className="bl-table-scroll">
            <table className="table bl-table">
              <thead>
                <tr>
                  <th>Organisation</th><th className="bl-col-team">Team</th><th>Added By</th><th className="bl-col-date">Added On</th><th>Leads</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td><span className="bl-org" title={r.org_name}>{r.org_name}</span></td>
                    <td className="bl-col-team">{r.team ? <Badge variant="neutral" className="bl-team-badge">{r.team}</Badge> : "-"}</td>
                    <td>{r.created_by_name || "-"}</td>
                    <td className="bl-date bl-col-date">{fmtDate(r.created_at)}</td>
                    <td>{Number(r.lead_count) || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="bl-record-count">{filtered.length} of {rows.length} manually added</p>
    </>
  );
}

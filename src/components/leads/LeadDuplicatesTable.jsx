// The "Possible duplications" table shown inline on the lead detail page
// (in place of the progress stepper / records / actions while open). One
// row per matched reason with its actual value — reasons come from
// get_lead_duplicate_refs (20261105030000_lead_duplicate_refs_match_reason.sql).
import { Link } from "react-router-dom";

export default function LeadDuplicatesTable({ refs, currentLeadId, currentLeadNumber }) {
  if (!refs.length) {
    return <p className="ld-dup-empty">This lead isn't flagged as a possible duplicate of any other lead.</p>;
  }
  return (
    <div className="ld-dup-table-wrap">
      <table className="ld-dup-table">
        <thead>
          <tr>
            <th>Lead Number</th>
            <th>Team</th>
            <th>Why it matches</th>
            <th>Matching value</th>
          </tr>
        </thead>
        {/* One tbody per matched lead: a lead with several reasons
            gets one row per reason, lead number/team spanning them. */}
        {refs.map((d) => {
          // Empty = flagged when saved, but one of the two leads has
          // been edited since and nothing matches any more.
          const reasons = d.match_reasons?.length
            ? d.match_reasons
            : [{ type: "none", label: "No longer matches", detail: null }];
          return (
            <tbody key={d.id} className="ld-dup-group">
              {reasons.map((r, j) => (
                <tr key={r.type}>
                  {j === 0 && (
                    <>
                      <td rowSpan={reasons.length} className="ld-dup-cell-lead">
                        {d.can_view ? (
                          <Link
                            to={`/leads/${d.id}`}
                            state={{ from: "duplicate", leadId: currentLeadId, leadNumber: currentLeadNumber }}
                            className="ld-dup-link"
                          >
                            {d.lead_number}
                          </Link>
                        ) : (
                          <span className="ld-dup-num">{d.lead_number}</span>
                        )}
                        {d.title && <div className="ld-dup-title">{d.title}</div>}
                      </td>
                      <td rowSpan={reasons.length} className="ld-dup-cell-team">
                        <span className="ld-dup-team">{d.team}</span>
                      </td>
                    </>
                  )}
                  <td className="ld-dup-cell-reason">
                    <span className={`ld-dup-reason is-${r.type}`}>{r.label}</span>
                  </td>
                  <td className="ld-dup-cell-value">
                    {r.detail ? (
                      <span className="ld-dup-reason-detail">{r.detail}</span>
                    ) : (
                      <span className="ld-dup-reason-none">Edited after it was flagged</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

// Read-only rendering of a Business Partner's Section D answers, shared by the
// Application Review page and the Empanelment list's detail modal so both show
// what the BP actually typed (paragraphs, "Others" text, the assignments table).

// "Others" is replaced by what the BP wrote in "Specify Other Sectors", and
// kept at the end of the list.
export function formatSectors(ba) {
  let list = ba?.sectors_served;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { list = [list]; } }
  if (!Array.isArray(list) || list.length === 0) return "-";
  const named = list.filter((s) => s !== "Others");
  if (list.includes("Others")) {
    const other = (ba.other_sectors || "").trim();
    named.push(other ? `Others (${other})` : "Others");
  }
  return named.join(", ");
}

// Long free text (Core Expertise etc.) with the BP's line breaks preserved.
export function MultilineText({ text }) {
  if (text === null || text === undefined || String(text).trim() === "") return "-";
  return <span style={{ whiteSpace: "pre-line", fontWeight: 400, lineHeight: 1.6 }}>{String(text).trim()}</span>;
}

const ASSIGNMENT_COLS = [
  ["title", "Project Title"],
  ["client", "Client"],
  ["duration", "Duration"],
  ["value", "Value (INR Lakhs)"],
  ["role", "Role Played"],
];

function parseAssignments(val) {
  let list = val;
  if (typeof list === "string") { try { list = JSON.parse(list); } catch { return []; } }
  if (list && !Array.isArray(list) && typeof list === "object") list = Object.values(list);
  if (!Array.isArray(list)) return [];
  return list.filter((row) => row && typeof row === "object" && ASSIGNMENT_COLS.some(([k]) => String(row[k] ?? "").trim() !== ""));
}

// Returns null when nothing was filled, so callers' "hide empty row" logic works.
export function AssignmentsTable({ value }) {
  const rows = parseAssignments(value);
  if (rows.length === 0) return "-";
  const cell = { padding: "8px 10px", borderBottom: "1px solid var(--border-subtle)", textAlign: "left", verticalAlign: "top", fontWeight: 400, lineHeight: 1.45, wordBreak: "normal", overflowWrap: "normal" };
  const wide = { minWidth: 170 };
  return (
    <div style={{ overflowX: "auto", width: "100%", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
      <table style={{ width: "100%", minWidth: 720, borderCollapse: "collapse", fontSize: "var(--text-sm)" }}>
        <thead>
          <tr>
            <th style={{ ...cell, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>#</th>
            {ASSIGNMENT_COLS.map(([k, label]) => <th key={k} style={{ ...cell, fontWeight: 600, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>{label}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              <td style={cell}>{i + 1}</td>
              {ASSIGNMENT_COLS.map(([k]) => <td key={k} style={k === "title" || k === "client" || k === "role" ? { ...cell, ...wide } : cell}>{String(row[k] ?? "").trim() || "-"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function hasAssignments(value) { return parseAssignments(value).length > 0; }
export function hasText(value) { return value !== null && value !== undefined && String(value).trim() !== ""; }

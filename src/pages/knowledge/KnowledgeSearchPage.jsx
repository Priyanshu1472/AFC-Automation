import { useState, useEffect, useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../hooks/useAuth";
import { useShortlist } from "../../hooks/useShortlist";
import ShortlistModal from "../../components/knowledge/ShortlistModal";
import AppHeader from "../../components/shared/AppHeader";
import FilterDrawer, { FilterButton, FilterField } from "../../components/ui/FilterDrawer";
import "../../styles/KnowledgeSearchPage.css";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function parseYM(yyyymm) {
  if (!yyyymm) return { year: null, month: null };
  const [y, m] = yyyymm.split("-");
  return { year: parseInt(y), month: parseInt(m) - 1 };
}
function fmtYM(yyyymm) {
  if (!yyyymm) return "—";
  const { year, month } = parseYM(yyyymm);
  if (!year) return "—";
  return `${MONTHS[month]} ${year}`;
}

// ── Icons ─────────────────────────────────────────────────────
const IconFolder = ({ size = 28 }) => (<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>);
const IconFile = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>);
const IconGrid = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>);
const IconTable = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="3" y1="15" x2="21" y2="15" /><line x1="9" y1="3" x2="9" y2="21" /></svg>);
const IconChevronRight = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>);
const IconPin = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>);
const IconSearch = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>);
const IconPlus = () => (<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>);
const IconBookmark = ({ filled = false }) => (<svg width="13" height="13" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>);
const IconEye = () => (<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>);

export default function KnowledgeSearchPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const canAdd = profile?.role !== "business_associate";

  const [projects, setProjects] = useState([]);
  const [kwDetails, setKwDetails] = useState([]);
  const [keywords, setKeywords] = useState([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState("");
  const [filterYears, setFilterYears] = useState(new Set());
  const [filterMin, setFilterMin] = useState("");
  const [filterMax, setFilterMax] = useState("");
  const [filterLoc, setFilterLoc] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState("folder");

  // Folder drill-down position lives in the URL (not plain state) so that
  // navigating to a project's details and back restores the exact
  // year/month you were browsing, instead of resetting to the years list —
  // this page fully remounts on that round trip, so local state alone
  // can't survive it.
  const [searchParams, setSearchParams] = useSearchParams();
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const nav = useMemo(() => {
    if (yearParam == null) return { level: "years", year: null, month: null };
    if (monthParam == null) return { level: "months", year: Number(yearParam), month: null };
    return { level: "projects", year: Number(yearParam), month: Number(monthParam) };
  }, [yearParam, monthParam]);
  function setNav(next) {
    const params = {};
    if (next.year != null) params.year = String(next.year);
    if (next.month != null) params.month = String(next.month);
    setSearchParams(params);
  }

  const [slProject, setSlProject] = useState(null);
  const { shortlists, createShortlist, addToShortlist, isInAnyShortlist, getProjectShortlists } = useShortlist();

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: proj }, { data: kwd }, { data: kw }] = await Promise.all([
        supabase.from("projects").select("*"),
        supabase.from("project_keyword_details").select("*"),
        supabase.from("keywords").select("*"),
      ]);
      setProjects(proj || []);
      setKwDetails(kwd || []);
      setKeywords(kw || []);
      setLoading(false);
    })();
  }, []);

  const enriched = useMemo(() => {
    const kwMap = {};
    keywords.forEach((k) => { kwMap[k.id] = k.name; });
    const projKwMap = {};
    kwDetails.forEach((d) => {
      if (!projKwMap[d.project_id]) projKwMap[d.project_id] = [];
      projKwMap[d.project_id].push({ name: kwMap[d.keyword_id] || "—", description: d.description });
    });
    return projects.map((p) => {
      const s = p.summary || {};
      return {
        ...p,
        startDate: s.startDate || null,
        finishDate: s.finishDate || null,
        capitalCost: s.capitalCost ? parseFloat(s.capitalCost) : null,
        description: s.projectBriefDescription || null,
        kwList: projKwMap[p.id] || [],
        location: p.location || null,
      };
    });
  }, [projects, kwDetails, keywords]);

  const allYears = useMemo(() => {
    const yrs = new Set();
    enriched.forEach((p) => { const { year } = parseYM(p.startDate); if (year) yrs.add(year); });
    return [...yrs].sort((a, b) => b - a);
  }, [enriched]);

  const allLocations = useMemo(() => {
    const locs = new Set();
    enriched.forEach((p) => { if (p.location) locs.add(p.location); });
    return [...locs].sort();
  }, [enriched]);

  const filtered = useMemo(() => {
    return enriched.filter((p) => {
      if (query) {
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
        const haystack = [
          p.title, p.client, p.location, p.shortform, p.description,
          p.startDate, p.finishDate, p.capitalCost != null ? String(p.capitalCost) : "",
          ...p.kwList.map((k) => k.name), ...p.kwList.map((k) => k.description),
        ].filter(Boolean).join(" ").toLowerCase();
        if (!terms.every((t) => haystack.includes(t))) return false;
      }
      if (filterYears.size > 0) {
        const { year } = parseYM(p.startDate);
        if (!filterYears.has(year)) return false;
      }
      if (filterMin !== "" && (p.capitalCost == null || p.capitalCost < parseFloat(filterMin))) return false;
      if (filterMax !== "" && (p.capitalCost == null || p.capitalCost > parseFloat(filterMax))) return false;
      if (filterLoc && p.location !== filterLoc) return false;
      return true;
    });
  }, [enriched, query, filterYears, filterMin, filterMax, filterLoc]);

  const byYear = useMemo(() => {
    const m = {};
    filtered.forEach((p) => {
      const { year, month } = parseYM(p.startDate);
      if (!year) return;
      if (!m[year]) m[year] = {};
      if (!m[year][month]) m[year][month] = [];
      m[year][month].push(p);
    });
    return m;
  }, [filtered]);

  // Reset the folder position back to "years" whenever a filter actually
  // changes — done directly in these setters (not a watch-and-reset
  // effect) so it can't fire on mount and wipe the year/month just
  // restored from the URL after coming back from a project.
  const resetNavToYears = () => setNav({ level: "years", year: null, month: null });

  const updateQuery = (v) => { setQuery(v); resetNavToYears(); };
  const updateFilterLoc = (v) => { setFilterLoc(v); resetNavToYears(); };
  const updateFilterMin = (v) => { setFilterMin(v); resetNavToYears(); };
  const updateFilterMax = (v) => { setFilterMax(v); resetNavToYears(); };
  const toggleYear = (yr) => {
    setFilterYears((prev) => { const next = new Set(prev); next.has(yr) ? next.delete(yr) : next.add(yr); return next; });
    resetNavToYears();
  };

  const hasFilters = query || filterYears.size > 0 || filterMin || filterMax || filterLoc;
  const activeCount = (query ? 1 : 0) + (filterYears.size > 0 ? 1 : 0) + (filterLoc ? 1 : 0) + ((filterMin || filterMax) ? 1 : 0);
  const clearAll = () => { setQuery(""); setFilterYears(new Set()); setFilterMin(""); setFilterMax(""); setFilterLoc(""); resetNavToYears(); };

  function openSlModal(e, p) {
    e.stopPropagation();
    setSlProject({ id: p.id, title: p.title });
  }

  const renderFolder = () => {
    if (nav.level === "years") {
      const years = Object.keys(byYear).sort((a, b) => b - a);
      if (!years.length) return <div className="kr-empty"><IconFolder size={40} /><p>No projects found.</p></div>;
      return (
        <div className="kr-folder-grid">
          {years.map((yr) => {
            const count = Object.values(byYear[yr]).flat().length;
            return (
              <button key={yr} className="kr-folder-item" onClick={() => setNav({ level: "months", year: Number(yr), month: null })}>
                <span className="kr-folder-icon"><IconFolder /></span>
                <span className="kr-folder-name">{yr}</span>
                <span className="kr-folder-count">{count} project{count !== 1 ? "s" : ""}</span>
              </button>
            );
          })}
        </div>
      );
    }

    if (nav.level === "months") {
      const monthKeys = Object.keys(byYear[nav.year] || {}).sort((a, b) => a - b);
      if (!monthKeys.length) return <div className="kr-empty"><p>No projects this year.</p></div>;
      return (
        <div className="kr-folder-grid">
          {monthKeys.map((mo) => {
            const count = (byYear[nav.year]?.[mo] || []).length;
            return (
              <button key={mo} className="kr-folder-item kr-folder-item--month" onClick={() => setNav({ level: "projects", year: nav.year, month: Number(mo) })}>
                <span className="kr-folder-icon kr-folder-icon--month"><IconFolder /></span>
                <span className="kr-folder-name">{MONTHS[mo]}</span>
                <span className="kr-folder-count">{count} project{count !== 1 ? "s" : ""}</span>
              </button>
            );
          })}
        </div>
      );
    }

    if (nav.level === "projects") {
      const projs = byYear[nav.year]?.[nav.month] || [];
      if (!projs.length) return <div className="kr-empty"><p>No projects this month.</p></div>;
      return (
        <div className="kr-file-grid">
          {projs.map((p) => {
            const shortlisted = isInAnyShortlist(p.id);
            return (
              <button key={p.id} className="kr-file-item" onClick={() => navigate(`/knowledge/${p.id}`)}>
                <div className="kr-file-top">
                  <span className="kr-file-icon"><IconFile /></span>
                  <div className="kr-file-actions">
                    {p.shortform && <span className="kr-file-shortform">{p.shortform}</span>}
                    <span className="kr-icon-action" title="View project" onClick={(e) => { e.stopPropagation(); navigate(`/knowledge/${p.id}`); }}><IconEye /></span>
                    <span className={`kr-icon-action${shortlisted ? " kr-icon-action--active" : ""}`} title={shortlisted ? "Shortlisted" : "Add to shortlist"} onClick={(e) => openSlModal(e, p)}><IconBookmark filled={shortlisted} /></span>
                  </div>
                </div>
                <span className="kr-file-name">{p.title}</span>
                {p.client && <span className="kr-file-client">{p.client.length > 45 ? p.client.slice(0, 45) + "…" : p.client}</span>}
                <div className="kr-file-meta">
                  {p.location && <span className="kr-file-loc"><IconPin /> {p.location}</span>}
                  {p.capitalCost && <span className="kr-file-cost">₹{p.capitalCost} Cr</span>}
                </div>
                {p.kwList.length > 0 && (
                  <div className="kr-tags">
                    {p.kwList.slice(0, 2).map((k) => <span key={k.name} className="kr-tag">{k.name}</span>)}
                    {p.kwList.length > 2 && <span className="kr-tag kr-tag--more">+{p.kwList.length - 2}</span>}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      );
    }
  };

  const renderTable = () => (
    <>
      <div className="kr-table-wrap">
        <table className="kr-table">
          <thead>
            <tr><th>#</th><th>Project</th><th>Client</th><th>Location</th><th>Duration</th><th>Value (Cr)</th><th style={{ width: 72 }}>Actions</th></tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ textAlign: "center", padding: "48px 16px", color: "var(--text-secondary)" }}>No projects found.</td></tr>
            ) : filtered.map((p, i) => {
              const shortlisted = isInAnyShortlist(p.id);
              return (
                <tr key={p.id}>
                  <td className="kr-td-num">{i + 1}</td>
                  <td><div className="kr-td-title">{p.title}</div>{p.shortform && <div className="kr-td-shortform">{p.shortform}</div>}</td>
                  <td><div className="kr-td-client">{p.client || <span className="kr-td-muted">—</span>}</div></td>
                  <td>{p.location ? <span className="kr-td-loc"><IconPin /> {p.location}</span> : <span className="kr-td-muted">—</span>}</td>
                  <td className="kr-td-date">{fmtYM(p.startDate)} – {fmtYM(p.finishDate)}</td>
                  <td className="kr-td-date">{p.capitalCost != null ? `₹${p.capitalCost} Cr` : <span className="kr-td-muted">—</span>}</td>
                  <td>
                    <div className="kr-td-actions">
                      <button className="kr-icon-action" title="View project" onClick={() => navigate(`/knowledge/${p.id}`)}><IconEye /></button>
                      <button className={`kr-icon-action${shortlisted ? " kr-icon-action--active" : ""}`} title={shortlisted ? "Shortlisted" : "Add to shortlist"} onClick={(e) => openSlModal(e, p)}><IconBookmark filled={shortlisted} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="kr-mobile-list">
        {filtered.map((p, i) => {
          const shortlisted = isInAnyShortlist(p.id);
          return (
            <div key={p.id} className="kr-mobile-card-wrap">
              <button className="kr-mobile-card" onClick={() => navigate(`/knowledge/${p.id}`)}>
                <div className="kr-mc-header">
                  <span className="kr-mc-num">{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="kr-mc-title">{p.title.length > 65 ? p.title.slice(0, 65) + "…" : p.title}{p.shortform && <span className="kr-mc-shortform">{p.shortform}</span>}</div>
                    {p.client && <div className="kr-mc-client">{p.client.length > 50 ? p.client.slice(0, 50) + "…" : p.client}</div>}
                  </div>
                  <button className={`kr-icon-action${shortlisted ? " kr-icon-action--active" : ""}`} onClick={(e) => openSlModal(e, p)}><IconBookmark filled={shortlisted} /></button>
                </div>
                <div className="kr-mc-meta">
                  {p.location && <span className="kr-mc-loc"><IconPin /> {p.location}</span>}
                  {p.capitalCost && <span className="kr-mc-cost">₹{p.capitalCost} Cr</span>}
                </div>
                {(p.startDate || p.finishDate) && <div className="kr-mc-dates">{fmtYM(p.startDate)} – {fmtYM(p.finishDate)}</div>}
                {p.kwList.length > 0 && (
                  <div className="kr-tags" style={{ marginTop: 6 }}>
                    {p.kwList.slice(0, 2).map((k) => <span key={k.name} className="kr-tag">{k.name}</span>)}
                    {p.kwList.length > 2 && <span className="kr-tag kr-tag--more">+{p.kwList.length - 2}</span>}
                  </div>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );

  const Breadcrumb = () => {
    if (viewMode !== "folder") return null;
    return (
      <div className="kr-breadcrumb">
        <button className="kr-bc-link" onClick={() => setNav({ level: "years", year: null, month: null })}>All Years</button>
        {nav.year && (<><span className="kr-bc-sep"><IconChevronRight /></span><button className="kr-bc-link" onClick={() => setNav({ level: "months", year: nav.year, month: null })}>{nav.year}</button></>)}
        {nav.month !== null && (<><span className="kr-bc-sep"><IconChevronRight /></span><span className="kr-bc-current">{MONTHS[nav.month]}</span></>)}
      </div>
    );
  };

  const countLabel = viewMode === "folder" ? (nav.level === "years" ? "All Projects" : nav.level === "months" ? String(nav.year) : `${MONTHS[nav.month]} ${nav.year}`) : "All Projects";

  return (
    <div className="app-shell">
      <AppHeader />
      <div className="app-container">
        <div className="kr-page">
          <div className="page-header">
            <div className="page-title-row">
              <div>
                <h1>Knowledge Repository</h1>
              </div>
              <div className="kr-header-actions" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <div className="kr-view-toggle">
                  <button className={`kr-view-btn${viewMode === "folder" ? " kr-view-btn--active" : ""}`} onClick={() => setViewMode("folder")} title="Folder View"><IconGrid /></button>
                  <button className={`kr-view-btn${viewMode === "table" ? " kr-view-btn--active" : ""}`} onClick={() => setViewMode("table")} title="Table View"><IconTable /></button>
                </div>
                <button className="kr-btn-shortlists" onClick={() => navigate("/knowledge/shortlists")}>
                  <span className="kr-btn-icon"><IconBookmark /></span>
                  <span className="kr-btn-label">Shortlists</span>
                  {shortlists.length > 0 && <span className="kr-btn-shortlists-count">{shortlists.length}</span>}
                </button>
                {canAdd && (
                  <button className="kr-btn-add" onClick={() => navigate("/knowledge/add")}>
                    <span className="kr-btn-icon"><IconPlus /></span>
                    <span className="kr-btn-label">Add Project</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)" }}>
              <div className="kr-search-row">
                <div className="kr-search-wrap">
                  <span className="kr-search-icon"><IconSearch /></span>
                  <input className="input kr-search-input" placeholder="Search by project, client, keyword, location… (space = AND)" value={query} onChange={(e) => updateQuery(e.target.value)} />
                </div>
                <FilterButton onClick={() => setShowFilters(true)} activeCount={activeCount} />
                {hasFilters && <button className="kr-clear-btn" onClick={clearAll}>Clear All</button>}
              </div>

              {hasFilters && (
                <div className="kr-pills-row">
                  {query && <span className="kr-pill">Search: {query}<button className="kr-pill-x" onClick={() => updateQuery("")}>×</button></span>}
                  {[...filterYears].sort().map((yr) => (<span key={yr} className="kr-pill">{yr}<button className="kr-pill-x" onClick={() => toggleYear(yr)}>×</button></span>))}
                  {filterLoc && <span className="kr-pill kr-pill--loc"><IconPin /> {filterLoc}<button className="kr-pill-x" onClick={() => updateFilterLoc("")}>×</button></span>}
                  {(filterMin || filterMax) && <span className="kr-pill">₹{filterMin || "0"} – {filterMax || "∞"} Cr<button className="kr-pill-x" onClick={() => { updateFilterMin(""); updateFilterMax(""); }}>×</button></span>}
                </div>
              )}
            </div>
          </div>

          <FilterDrawer open={showFilters} onClose={() => setShowFilters(false)} onReset={clearAll}>
            <FilterField label="Year">
              <div className="kr-year-chips">
                {allYears.map((yr) => (<button key={yr} className={`kr-year-chip${filterYears.has(yr) ? " kr-year-chip--active" : ""}`} onClick={() => toggleYear(yr)}>{yr}</button>))}
              </div>
            </FilterField>
            <FilterField label="Location">
              <select className="input" value={filterLoc} onChange={(e) => updateFilterLoc(e.target.value)}>
                <option value="">All Locations</option>
                {allLocations.map((loc) => <option key={loc} value={loc}>{loc}</option>)}
              </select>
            </FilterField>
            <FilterField label="Project Value (₹ Cr)">
              <div className="kr-range-row">
                <input type="number" className="input" placeholder="Min" value={filterMin} onChange={(e) => updateFilterMin(e.target.value)} />
                <span style={{ color: "var(--text-tertiary)" }}>—</span>
                <input type="number" className="input" placeholder="Max" value={filterMax} onChange={(e) => updateFilterMax(e.target.value)} />
              </div>
            </FilterField>
          </FilterDrawer>

          <div className="card">
            <div className="card-header">
              <span style={{ display: "flex", alignItems: "center", gap: "var(--space-3)" }}>
                <span style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-md)", fontWeight: 600 }}>{countLabel}</span>
                <span className="kr-count-badge">{filtered.length} project{filtered.length !== 1 ? "s" : ""}</span>
              </span>
              <Breadcrumb />
            </div>
            <div className="card-body">
              {loading ? <div className="kr-loading">Loading projects…</div> : viewMode === "folder" ? renderFolder() : renderTable()}
            </div>
          </div>

          {slProject && (
            <ShortlistModal
              projectTitle={slProject.title}
              shortlists={shortlists}
              alreadyIn={getProjectShortlists(slProject.id)}
              onAddToExisting={(slId) => addToShortlist(slProject.id, [], slId)}
              onCreateNew={async (name) => { const sl = await createShortlist(name); await addToShortlist(slProject.id, [], sl.id); }}
              onClose={() => setSlProject(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

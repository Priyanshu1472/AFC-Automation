// "Find Relevant Experience" — describe the kind of past work you need
// (not a project name) and get ranked historical projects back. Hybrid
// search: a local, in-browser embedding of the query is compared against
// each project's stored embedding (semantic similarity), combined with
// PostgreSQL full-text/trigram search over Actual Services, keywords and
// keyword descriptions, and exact keyword/project-name matches — merged
// and ranked via supabase.rpc("find_relevant_experience", ...) plus the
// weights in src/lib/experienceSearchConfig.js. See that file for exactly
// how the relevance score shown on each result is calculated.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { embedText } from "../../lib/embeddingModel";
import {
  computeFinalScore, relevanceLabel, RELEVANCE_LOW_CONFIDENCE, COMPONENT_MATCH_THRESHOLD,
} from "../../lib/experienceSearchConfig";
import { CustomSelect } from "./KnowledgeFormParts";
import RelevantExperienceModal from "./RelevantExperienceModal";
import PageLoader from "../ui/PageLoader";
import Badge from "../ui/Badge";
import "../../styles/FindExperiencePanel.css";

const IconPin = () => (<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>);
const IconCheck = () => (<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>);

function relevanceVariant(label) {
  if (label === "High relevance") return "success";
  if (label === "Medium relevance") return "warning";
  return "neutral";
}

function whyItMatched(row, searchServices, searchKeywords) {
  const reasons = [];
  if (searchServices && row.services_score >= COMPONENT_MATCH_THRESHOLD) {
    reasons.push("Matches your query in the Actual Services Provided description.");
  }
  if (searchKeywords && row.keyword_score >= COMPONENT_MATCH_THRESHOLD) {
    const names = row.matched_keywords.map((k) => k.name).filter(Boolean);
    reasons.push(names.length ? `Tagged with keyword${names.length > 1 ? "s" : ""} matching your query: ${names.join(", ")}.` : "Keyword experience matches your query.");
  }
  if (row.semantic_score >= COMPONENT_MATCH_THRESHOLD) {
    reasons.push("Overall project description is semantically similar to your query.");
  }
  if (row.metadata_score >= COMPONENT_MATCH_THRESHOLD) {
    reasons.push("Project name or client closely matches your search.");
  }
  return reasons;
}

export default function FindExperiencePanel({ allLocations, allCountries, allKeywordNames }) {
  const navigate = useNavigate();

  const [queryText, setQueryText] = useState("");
  const [filterCountry, setFilterCountry] = useState("");
  const [filterLoc, setFilterLoc] = useState("");
  const [filterYearMin, setFilterYearMin] = useState("");
  const [filterYearMax, setFilterYearMax] = useState("");
  const [filterValueMin, setFilterValueMin] = useState("");
  const [filterValueMax, setFilterValueMax] = useState("");
  const [filterClientType, setFilterClientType] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterKeywords, setFilterKeywords] = useState(new Set());
  const [kwSearch, setKwSearch] = useState("");
  const [searchDescription, setSearchDescription] = useState(true);
  const [searchServices, setSearchServices] = useState(true);
  const [searchKeywordDesc, setSearchKeywordDesc] = useState(true);
  const [searchKeywords, setSearchKeywords] = useState(true);

  const [loading, setLoading] = useState(false);
  const [loadingLabel, setLoadingLabel] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState(null); // null = not searched yet
  const [detailFor, setDetailFor] = useState(null);

  const toggleFilterKeyword = (kw) => {
    setFilterKeywords((prev) => { const next = new Set(prev); next.has(kw) ? next.delete(kw) : next.add(kw); return next; });
  };

  async function handleSearch() {
    const trimmed = queryText.trim();
    if (!trimmed) { setError("Describe the experience you need."); return; }
    setError("");
    setLoading(true);
    setResults(null);
    try {
      let embedding = null;
      try {
        setLoadingLabel("Preparing search…");
        embedding = await embedText(trimmed, (p) => {
          if (p?.status === "progress") setLoadingLabel(`Preparing search… ${Math.round(p.progress || 0)}%`);
        });
      } catch (embedErr) {
        console.error("Semantic search unavailable, falling back to text-only matching:", embedErr);
      }
      setLoadingLabel("Searching past experience…");

      const { data: rows, error: rpcErr } = await supabase.rpc("find_relevant_experience", {
        p_query_embedding: embedding,
        p_query_text: trimmed,
        p_search_services: searchServices,
        p_search_keywords: searchKeywords || searchKeywordDesc,
        p_locations: filterLoc ? [filterLoc] : null,
        p_countries: filterCountry ? [filterCountry] : null,
        p_client_types: filterClientType ? [filterClientType] : null,
        p_statuses: filterStatus ? [filterStatus] : null,
        p_keyword_names: filterKeywords.size > 0 ? [...filterKeywords] : null,
        p_year_min: filterYearMin ? parseInt(filterYearMin, 10) : null,
        p_year_max: filterYearMax ? parseInt(filterYearMax, 10) : null,
        p_value_min: filterValueMin ? parseFloat(filterValueMin) : null,
        p_value_max: filterValueMax ? parseFloat(filterValueMax) : null,
        p_match_count: 50,
      });
      if (rpcErr) { setError(rpcErr.message); setLoading(false); return; }

      if (!rows || rows.length === 0) { setResults([]); setLoading(false); return; }

      const projectIds = rows.map((r) => r.project_id);
      const { data: projects, error: projErr } = await supabase.from("projects").select("*").in("id", projectIds);
      if (projErr) { setError(projErr.message); setLoading(false); return; }
      const projectById = {};
      (projects || []).forEach((p) => { projectById[p.id] = p; });

      const merged = rows
        .filter((r) => projectById[r.project_id])
        .map((r) => {
          const finalScore = computeFinalScore(r);
          return {
            ...r,
            project: projectById[r.project_id],
            finalScore,
            label: relevanceLabel(finalScore),
            matched_keywords: (r.matched_keywords || []).filter((k) => k.name),
          };
        })
        .sort((a, b) => b.finalScore - a.finalScore);

      setResults(merged);
    } catch (err) {
      setError(err.message || "Search failed.");
    } finally {
      setLoading(false);
      setLoadingLabel("");
    }
  }

  const strongResults = results?.filter((r) => r.finalScore >= RELEVANCE_LOW_CONFIDENCE) || [];
  const closestResults = results?.filter((r) => r.finalScore < RELEVANCE_LOW_CONFIDENCE) || [];

  function renderResultCard(r) {
    const p = r.project;
    const s = p.summary || {};
    const reasons = whyItMatched(r, searchServices, searchKeywordDesc || searchKeywords);
    return (
      <div className="fre-result-card" key={p.id}>
        <div className="fre-result-top">
          <div className="fre-result-title">{p.title}</div>
          <Badge variant={relevanceVariant(r.label)}>{r.label} · {r.finalScore.toFixed(2)}</Badge>
        </div>
        <div className="fre-result-meta">
          {p.client && <span>{p.client}</span>}
          {p.location && <span className="fre-result-loc"><IconPin /> {p.location}</span>}
          {s.capitalCost && <span>₹{s.capitalCost} Cr</span>}
        </div>
        {r.matched_keywords.length > 0 && (
          <div className="fre-match-list">
            {r.matched_keywords.slice(0, 5).map((kw) => (
              <div key={kw.name} className="fre-match-item"><IconCheck /> {kw.name}</div>
            ))}
          </div>
        )}
        {reasons.length > 0 && (
          <div className="fre-why">
            <div className="fre-why-label">Why it matched</div>
            <ul className="fre-why-list">
              {reasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          </div>
        )}
        <div className="fre-result-actions">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/knowledge/${p.id}`)}>View Project</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setDetailFor(r)}>View Relevant Experience</button>
        </div>
      </div>
    );
  }

  return (
    <div className="fre-panel">
      <div className="fre-query-row">
        <label className="field-label" htmlFor="fre-query">Describe the experience you need</label>
        <textarea
          id="fre-query" className="input fre-textarea" rows={3}
          placeholder="e.g. Experience in GIS-based infrastructure planning, urban development, transportation planning and monitoring."
          value={queryText} onChange={(e) => setQueryText(e.target.value)}
        />
      </div>

      <div className="fre-filters-grid">
        <div className="fre-field">
          <label className="field-label">Country</label>
          <CustomSelect value={filterCountry} onChange={setFilterCountry} options={[{ value: "", label: "All" }, ...allCountries.map((c) => ({ value: c, label: c }))]} placeholder="All" />
        </div>
        <div className="fre-field">
          <label className="field-label">State / UT</label>
          <CustomSelect value={filterLoc} onChange={setFilterLoc} options={[{ value: "", label: "All" }, ...allLocations.map((l) => ({ value: l, label: l }))]} placeholder="All" />
        </div>
        <div className="fre-field">
          <label className="field-label">Client Type</label>
          <CustomSelect value={filterClientType} onChange={setFilterClientType} options={[{ value: "", label: "All" }, { value: "Government", label: "Government" }, { value: "Private", label: "Private" }]} placeholder="All" />
        </div>
        <div className="fre-field">
          <label className="field-label">Project Status</label>
          <CustomSelect value={filterStatus} onChange={setFilterStatus} options={[{ value: "", label: "All" }, { value: "Ongoing", label: "Ongoing" }, { value: "Completed", label: "Completed" }]} placeholder="All" />
        </div>
        <div className="fre-field">
          <label className="field-label">Year</label>
          <div className="kr-range-row">
            <input type="number" className="input" placeholder="From" value={filterYearMin} onChange={(e) => setFilterYearMin(e.target.value)} />
            <span style={{ color: "var(--text-tertiary)" }}>—</span>
            <input type="number" className="input" placeholder="To" value={filterYearMax} onChange={(e) => setFilterYearMax(e.target.value)} />
          </div>
        </div>
        <div className="fre-field">
          <label className="field-label">Contract Value (₹ Cr)</label>
          <div className="kr-range-row">
            <input type="number" className="input" placeholder="Min" value={filterValueMin} onChange={(e) => setFilterValueMin(e.target.value)} />
            <span style={{ color: "var(--text-tertiary)" }}>—</span>
            <input type="number" className="input" placeholder="Max" value={filterValueMax} onChange={(e) => setFilterValueMax(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="fre-field">
        <label className="field-label">Keywords</label>
        <input type="text" className="input" placeholder="Search keywords…" value={kwSearch} onChange={(e) => setKwSearch(e.target.value)} style={{ marginBottom: "var(--space-2)" }} />
        <div className="kr-year-chips kr-kw-chip-scroll">
          {allKeywordNames
            .filter((kw) => kw.toLowerCase().includes(kwSearch.trim().toLowerCase()))
            .map((kw) => (
              <button key={kw} type="button" className={`kr-year-chip${filterKeywords.has(kw) ? " kr-year-chip--active" : ""}`} onClick={() => toggleFilterKeyword(kw)}>{kw}</button>
            ))}
        </div>
      </div>

      <div className="fre-field">
        <label className="field-label">Search in</label>
        <div className="fre-checkbox-row">
          <label className="fre-checkbox"><input type="checkbox" checked={searchDescription} onChange={(e) => setSearchDescription(e.target.checked)} disabled /> Project Description</label>
          <label className="fre-checkbox"><input type="checkbox" checked={searchServices} onChange={(e) => setSearchServices(e.target.checked)} /> Actual Services Provided</label>
          <label className="fre-checkbox"><input type="checkbox" checked={searchKeywordDesc} onChange={(e) => setSearchKeywordDesc(e.target.checked)} /> Keyword Descriptions</label>
          <label className="fre-checkbox"><input type="checkbox" checked={searchKeywords} onChange={(e) => setSearchKeywords(e.target.checked)} /> Keywords</label>
        </div>
        <p className="fre-hint">Project Description always contributes to the overall semantic match, it isn't a separate toggle since one embedding represents the whole project.</p>
      </div>

      {error && <div className="field-error" style={{ marginBottom: "var(--space-3)" }}>{error}</div>}

      <button type="button" className="btn btn-primary" onClick={handleSearch} disabled={loading}>
        {loading ? "Searching…" : "Find Relevant Experience"}
      </button>

      {loading && <PageLoader text={loadingLabel || "Searching…"} />}

      {!loading && results !== null && (
        <div className="fre-results">
          {results.length === 0 && (
            <div className="fre-empty">
              <p><strong>No strongly matching experience found.</strong></p>
              <p>Try:</p>
              <ul>
                <li>Adding more detail about the experience needed</li>
                <li>Using the specific services required</li>
                <li>Removing overly restrictive filters</li>
                <li>Searching by a known keyword</li>
              </ul>
            </div>
          )}

          {results.length > 0 && strongResults.length === 0 && (
            <p className="fre-empty-heading">No highly relevant experience found. Closest matches:</p>
          )}

          {strongResults.map(renderResultCard)}

          {strongResults.length > 0 && closestResults.length > 0 && (
            <p className="fre-empty-heading" style={{ marginTop: "var(--space-4)" }}>Other, less closely related matches:</p>
          )}
          {strongResults.length > 0 && closestResults.map(renderResultCard)}
          {strongResults.length === 0 && closestResults.map(renderResultCard)}
        </div>
      )}

      {detailFor && (
        <RelevantExperienceModal
          project={detailFor.project}
          queryText={queryText}
          matchedKeywords={detailFor.matched_keywords}
          servicesText={detailFor.project.summary?.servicesDescription}
          onClose={() => setDetailFor(null)}
        />
      )}
    </div>
  );
}

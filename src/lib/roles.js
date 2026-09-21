// ─── Role Hierarchy ───────────────────────────────────────────
// Insertion order here is the display order used everywhere roles/
// designations are listed (dropdowns, filters, badges) — high tier to low:
// Managing Director -> Executive Director -> Administrator -> Chief
// Financial Officer -> Company Secretary -> General Manager -> Deputy
// General Manager -> Assistant General Manager -> Senior Regional Manager
// -> Regional Manager -> Area Manager -> Project Officer -> Associate
// Consultant/Project Assistant, with Business Partner (a separate portal
// role, not part of this hierarchy) always listed last.
export const ROLES = {
  md: 0,
  executive_director: 1,
  // Not part of the review hierarchy below — a separate, IT/ops-style role
  // scoped to Home + Users (full manage rights) and read-only visibility
  // into empanelment/dashboards/reports. Given its own bucket rather than a
  // hierarchy rank.
  admin: 2,
  cfo: 3,
  cs: 4,
  // Same permissions/visibility as dgm everywhere (empanelment advisor
  // slot, knowledge-repo edit rights, DGM-tier lead visibility/
  // notifications) — kept as its own role rather than aliased so titles
  // stay accurate on the roster.
  general_manager: 4.9,
  dgm: 5,
  agm: 6,
  srm: 7,
  regional_manager: 7.9,
  // Same permissions/visibility as project_officer everywhere (empanelment
  // reviewing-PO slot included) — kept as its own role so titles stay
  // accurate on the roster.
  area_manager: 7.95,
  project_officer: 8,
  associate_consultant: 9,
  // Same permissions/visibility as associate_consultant (can send
  // empanelment invitations, sees their own team's applications) — kept as
  // its own role rather than aliased so titles stay accurate on the roster.
  project_assistant: 9.9,
  // Placeholder role — exists so Admin can assign it today, but is
  // deliberately excluded from every permission/nav list below. No
  // elevated permissions until a future change defines them.
  business_associate: 10,
};

export const ROLE_LABELS = {
  md: "Managing Director",
  executive_director: "Executive Director",
  admin: "Administrator",
  cfo: "Chief Financial Officer",
  cs: "Company Secretary",
  general_manager: "General Manager",
  dgm: "Deputy General Manager",
  agm: "Assistant General Manager",
  srm: "Senior Regional Manager",
  regional_manager: "Regional Manager",
  area_manager: "Area Manager",
  project_officer: "Project Officer",
  associate_consultant: "Associate Consultant",
  project_assistant: "Project Assistant",
  business_associate: "Business Partner",
};

// ─── Short form of ROLE_LABELS for space-constrained UI (e.g. the Users
// list table) — full name is still available via a tooltip/title.
export const ROLE_ABBR = {
  md: "MD",
  executive_director: "ED",
  admin: "Admin",
  cfo: "CFO",
  cs: "CS",
  general_manager: "GM",
  dgm: "DGM",
  agm: "AGM",
  srm: "SRM",
  regional_manager: "RM",
  area_manager: "AM",
  project_officer: "PO",
  associate_consultant: "AC",
  project_assistant: "PA",
  business_associate: "BP",
};

// ─── Admin can create any staff role, including more admin or md
// accounts — per explicit product decision. ────────────────────
export const ADMIN_CREATABLE_ROLES = [
  "admin",
  "md",
  "executive_director",
  "cfo",
  "cs",
  "general_manager",
  "dgm",
  "agm",
  "srm",
  "regional_manager",
  "area_manager",
  "project_officer",
  "associate_consultant",
  "project_assistant",
];

// ─── Users page — nav visibility and every /users*/create-user route's
// allowedRoles must stay in sync, so all of them read from this single
// list. User management (view, create, edit, activate/deactivate) is
// Admin-only — no other role, including MD and DGM, can see or reach it.
// ──────────────────────────────────────────────
export const USERS_PAGE_ROLES = ["admin"];

// ─── Audit log — Admin only. ──────────────────────────────────────────
export const AUDIT_LOG_ROLES = ["admin"];

// ─── Empanelment — visible to every staff role (not the business_associate
// portal role, which has its own separate area, and not executive_director,
// which has no permissions defined yet). Only associate_consultant can
// actually send a new one; who can act at each review stage is enforced
// by the empanelment RLS policies, not by this nav-level list. Admin is
// included here for read-only visibility — it has no branch in any
// review-stage action UI, so it naturally lands as view-only.
export const EMPANELMENT_ROLES = Object.keys(ROLES).filter((r) => r !== "business_associate" && r !== "executive_director");

// ─── Knowledge Repository — visible to every staff role (not the
// business_associate portal role, and not executive_director, which has no
// permissions defined yet). Org-wide, not team-scoped: any staff member can
// search/view every project so past experience can be cited in proposals
// company-wide. Adding/editing/deleting is enforced by RLS
// (can_edit_project), not by this nav-level list.
export const KNOWLEDGE_REPOSITORY_ROLES = Object.keys(ROLES).filter((r) => r !== "business_associate" && r !== "executive_director");

// ─── Permissions ──────────────────────────────────────────────
export const can = {
  // User management (view, create, edit, activate/deactivate, change role)
  // is Admin-only — no other role, not even MD or DGM.
  manageAllUsers: (role) => role === "admin",
  createUsers: (role) => role === "admin",
  editUsers: (role) => role === "admin",
  editUserRole: (role) => role === "admin",

  viewAllTeams: (role) => ["md", "cfo", "cs", "admin"].includes(role),
  // Reports page's Team/Office filters — narrower than viewAllTeams: only MD
  // and Admin get to slice reports by team/office, everyone else's data is
  // already scoped to their own team/office by RLS so the controls are
  // disabled rather than a no-op.
  filterReportsByTeamOffice: (role) => ["md", "admin"].includes(role),
  viewOwnTeam: (role) =>
    ["dgm", "general_manager", "agm", "srm", "project_officer", "area_manager", "regional_manager", "associate_consultant", "project_assistant"].includes(role),

  viewUsersPage: (role) => USERS_PAGE_ROLES.includes(role),
  viewAuditLog: (role) => AUDIT_LOG_ROLES.includes(role),

  // Company Documents (Knowledge Repository) — everyone in
  // KNOWLEDGE_REPOSITORY_ROLES can view/download; only Admin can
  // upload/update/delete. Mirrors company_documents' RLS policies exactly
  // (see 20260910000000_company_documents.sql) — this is UI-only gating,
  // never the actual enforcement.
  manageCompanyDocuments: (role) => role === "admin",

  // "Rebuild Index" for Find Relevant Experience search — a maintenance
  // action (re-embed every project's searchable text), not a data-access
  // permission, so it's gated the same way as other admin-only maintenance
  // actions. The underlying writes are still governed by
  // project_experience_embeddings' own RLS (can_edit_project per row), so
  // this is UI-only gating, not the actual enforcement.
  manageSearchIndex: (role) => role === "admin",
};

export function isTeamUser(role) {
  return ["dgm", "general_manager", "agm", "srm", "project_officer", "area_manager", "regional_manager", "associate_consultant", "project_assistant"].includes(role);
}

export function isAdminLevel(role) {
  return ["md", "cfo", "cs"].includes(role);
}

// ─── Org structure ─────────────────────────────────────────────
// Stored values stay the plain city names (existing afc_users.office data,
// filters, etc. all key off these) — only the display label changed.
export const OFFICES = ["delhi", "mumbai", "lucknow"];
export const OFFICE_LABELS = {
  delhi: "CO - New Delhi",
  mumbai: "HO - Mumbai",
  lucknow: "RO - Lucknow",
};
export const TEAMS = ["BPDD", "BIID"];

// ─── Whitelist of valid roles — validate any role value from the DB before trusting it ──
export const VALID_ROLES = new Set(Object.keys(ROLES));
export function isValidRole(role) {
  return VALID_ROLES.has(role);
}

// ─── Lead Generation ────────────────────────────────────────────────
// Authorization here is the universal afc_users.role/team (same as every
// other module — set on the Users page, no separate role-assignment
// system) plus one additional field, `committee`, for the PMT review
// stage (PMT Extended and G3 were removed from the approval chain — see
// 20260928000000_lead_committee_and_status_simplification.sql — the
// former G3/DGM-initial gate is now the named Recommending Authority
// instead). See leadPermissions.js for the actual can()-style predicates.
export const COMMITTEES = ["PMT"];

// The tier eligible to be Person Responsible for a lead (owns its
// PA_REVIEW accept/drop step) and to claim a dropped one. SRM has the same
// access/permissions as AGM throughout Lead Generation, per product
// decision — kept alongside it everywhere AGM appears in this module.
export const LEAD_PA_TIER_ROLES = ["project_assistant", "project_officer", "area_manager", "regional_manager", "associate_consultant", "agm", "srm"];

// Route-level gating only (who can even reach /leads*) — every actual
// create/accept/review permission is re-derived from afc_users.role/
// committee/team, never from this list. cfo/cs are view-only here: they
// already have org-wide row visibility via can_view_lead(), but have no
// action branch anywhere in advance-lead-stage — included so they can
// actually reach the pages, not because they can act on anything yet.
export const LEAD_GENERATION_NAV_ROLES = ["project_assistant", "project_officer", "area_manager", "regional_manager", "associate_consultant", "agm", "srm", "dgm", "general_manager", "md", "admin", "cfo", "cs"];

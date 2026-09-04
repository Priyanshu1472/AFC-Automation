// ─── Role Hierarchy ───────────────────────────────────────────
export const ROLES = {
  md: 0,
  cfo: 1,
  cs: 2,
  dgm: 3,
  agm: 4,
  srm: 5,
  project_officer: 6,
  associate_consultant: 7,
  // Same permissions/visibility as associate_consultant (can send
  // empanelment invitations, sees their own team's applications) — kept as
  // its own role rather than aliased so titles stay accurate on the roster.
  project_assistant: 8,
  business_associate: 9,
  // Not part of the review hierarchy above — a separate, IT/ops-style role
  // scoped to Home + Users (full manage rights) and read-only visibility
  // into empanelment/dashboards/reports. Given its own bucket rather than a
  // hierarchy rank.
  admin: 10,
};

export const ROLE_LABELS = {
  md: "Managing Director",
  cfo: "Chief Financial Officer",
  cs: "Company Secretary",
  dgm: "Deputy General Manager",
  agm: "Assistant General Manager",
  srm: "Senior Regional Manager",
  project_officer: "Project Officer",
  associate_consultant: "Associate Consultant",
  project_assistant: "Project Assistant",
  business_associate: "Business Associate",
  admin: "Administrator",
};

// ─── Admin can create any staff role except admin (avoid Admins silently
// minting more Admins) and md (MD accounts aren't created through this
// flow). ─────────────────────────────────────────────────────
export const ADMIN_CREATABLE_ROLES = [
  "cfo",
  "cs",
  "dgm",
  "agm",
  "srm",
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
// portal role, which has its own separate area). Only associate_consultant
// can actually send a new one; who can act at each review stage is enforced
// by the empanelment RLS policies, not by this nav-level list. Admin is
// included here for read-only visibility — it has no branch in any
// review-stage action UI, so it naturally lands as view-only.
export const EMPANELMENT_ROLES = Object.keys(ROLES).filter((r) => r !== "business_associate");

// ─── Knowledge Repository — visible to every staff role (not the
// business_associate portal role). Org-wide, not team-scoped: any staff
// member can search/view every project so past experience can be cited in
// proposals company-wide. Adding/editing/deleting is enforced by RLS
// (can_edit_project), not by this nav-level list.
export const KNOWLEDGE_REPOSITORY_ROLES = Object.keys(ROLES).filter((r) => r !== "business_associate");

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
    ["dgm", "agm", "srm", "project_officer", "associate_consultant", "project_assistant"].includes(role),

  viewUsersPage: (role) => USERS_PAGE_ROLES.includes(role),
  viewAuditLog: (role) => AUDIT_LOG_ROLES.includes(role),
};

export function isTeamUser(role) {
  return ["dgm", "agm", "srm", "project_officer", "associate_consultant", "project_assistant"].includes(role);
}

export function isAdminLevel(role) {
  return ["md", "cfo", "cs"].includes(role);
}

// ─── Org structure ─────────────────────────────────────────────
export const OFFICES = ["delhi", "mumbai", "lucknow"];
export const TEAMS = ["BPDD", "BIID"];

// ─── Whitelist of valid roles — validate any role value from the DB before trusting it ──
export const VALID_ROLES = new Set(Object.keys(ROLES));
export function isValidRole(role) {
  return VALID_ROLES.has(role);
}

// ─── Lead Generation ────────────────────────────────────────────────
// Authorization here is the universal afc_users.role/team (same as every
// other module — set on the Users page, no separate role-assignment
// system) plus one additional field, `committee`, for the three Lead
// Generation review committees. G3 is the DGM committee: membership grants
// DGM-equivalent lead-workflow permission, org-wide (pooled across all
// DGMs), independent of the member's own role. See useLeadPermissions.js
// for the actual can()-style predicates.
export const COMMITTEES = ["PMT", "PMT Extended", "G3"];

// The tier eligible to be Person Responsible for a lead (owns its
// PA_REVIEW accept/drop step) and to claim a dropped one. SRM has the same
// access/permissions as AGM throughout Lead Generation, per product
// decision — kept alongside it everywhere AGM appears in this module.
export const LEAD_PA_TIER_ROLES = ["project_assistant", "project_officer", "associate_consultant", "agm", "srm"];

// Route-level gating only (who can even reach /leads*) — every actual
// create/accept/review permission is re-derived from afc_users.role/
// committee/team, never from this list. cfo/cs are view-only here: they
// already have org-wide row visibility via can_view_lead(), but have no
// action branch anywhere in advance-lead-stage — included so they can
// actually reach the pages, not because they can act on anything yet.
export const LEAD_GENERATION_NAV_ROLES = ["project_assistant", "project_officer", "associate_consultant", "agm", "srm", "dgm", "md", "admin", "cfo", "cs"];

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
};

// ─── MD can create these roles ────────────────────────────────
export const MD_CREATABLE_ROLES = [
  "cfo",
  "cs",
  "dgm",
  "agm",
  "srm",
  "project_officer",
  "associate_consultant",
];

// ─── DGM can create these roles only, within their own team ──
export const DGM_CREATABLE_ROLES = [
  "agm",
  "srm",
  "project_officer",
  "associate_consultant",
];

// ─── Permissions ──────────────────────────────────────────────
export const can = {
  manageAllUsers: (role) => role === "md",
  manageTeamUsers: (role) => role === "dgm",
  createUsers: (role) => role === "md" || role === "dgm",

  viewAllTeams: (role) => ["md", "cfo", "cs"].includes(role),
  viewOwnTeam: (role) =>
    ["dgm", "agm", "srm", "project_officer", "associate_consultant"].includes(role),
};

export function isTeamUser(role) {
  return ["dgm", "agm", "srm", "project_officer", "associate_consultant"].includes(role);
}

export function isAdminLevel(role) {
  return ["md", "cfo", "cs"].includes(role);
}

// ─── Org structure ─────────────────────────────────────────────
export const OFFICES = ["delhi", "mumbai", "lucknow"];
export const TEAMS = ["BPDD", "CBBO"];

// ─── Whitelist of valid roles — validate any role value from the DB before trusting it ──
export const VALID_ROLES = new Set(Object.keys(ROLES));
export function isValidRole(role) {
  return VALID_ROLES.has(role);
}

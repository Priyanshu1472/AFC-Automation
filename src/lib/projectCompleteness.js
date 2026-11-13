// Knowledge Repository projects can now be saved with any field left
// blank (see AddProjectPage) — this is the single source of truth for
// which fields "count" as a project's required details, so the list page's
// "Missing Details" button and anything else that needs to flag an
// incomplete project all agree on the same list. Keep this in sync with
// the fields AddProjectPage/EditProjectPage actually collect.
export const PROJECT_FIELD_CHECKS = [
  { label: "Name and Address of Client", get: (p) => p.client },
  { label: "Approx. Value of the Contract", get: (p) => p.summary?.capitalCost },
  { label: "Country", get: (p) => p.summary?.country },
  { label: "Location within Country (State / UT)", get: (p) => p.location },
  { label: "Client Type", get: (p) => p.client_type },
  { label: "Project Status", get: (p) => p.status },
  { label: "Contact Person", get: (p) => p.summary?.contactPerson },
  { label: "Title / Designation", get: (p) => p.summary?.titleDesignation },
  { label: "Telephone", get: (p) => p.summary?.telephone },
  { label: "Email", get: (p) => p.summary?.email },
  { label: "Start Date", get: (p) => p.summary?.startDate },
  { label: "Completion Date", get: (p) => p.summary?.finishDate },
  { label: "Total Staff-Months of the Assignment", get: (p) => p.summary?.totalStaffMonths },
  { label: "Professional Staff-Months", get: (p) => p.summary?.associatedConsultantMonths },
  { label: "Name of Associated Consultants", get: (p) => p.summary?.associatedConsultants },
  { label: "Name of Senior Professional Staff & Functions", get: (p) => p.summary?.seniorProfessionalStaff },
  { label: "Description of Project", get: (p) => p.summary?.projectBriefDescription },
  { label: "Description of Actual Services Provided by the Staff", get: (p) => p.summary?.servicesDescription },
];

// `project` is a raw `projects` row (title/client/location/client_type/
// status columns + the summary jsonb blob) — the same shape returned by
// `select("*")` wherever this is called from.
export function getMissingProjectFields(project) {
  if (!project) return [];
  return PROJECT_FIELD_CHECKS.filter(({ get }) => !String(get(project) ?? "").trim()).map(({ label }) => label);
}

// Builds the canonical, labelled "searchable experience" text for a
// Knowledge Repository project — what gets embedded and full-text indexed
// for "Find Relevant Experience". Reuses fields that already exist on the
// project (summary jsonb + project_keyword_details); no new project-form
// fields are introduced for this.
//
// keywordDetails: [{ name, description }] — one entry per keyword the
// project has, with that project's own free-text description of how the
// keyword applied (project_keyword_details.description).
export function buildExperienceText(project, keywordDetails = []) {
  const summary = project.summary || {};
  const servicesText = summary.servicesDescription || "";
  const descriptionText = summary.projectBriefDescription || "";

  const keywordsBlock = keywordDetails
    .filter((k) => k.name)
    .map((k) => `KEYWORD:\n${k.name}\n\nKEYWORD EXPERIENCE:\n${k.description || "—"}`)
    .join("\n\n");

  const keywordsText = keywordDetails
    .filter((k) => k.name)
    .map((k) => `${k.name}: ${k.description || ""}`)
    .join("\n");

  const content = [
    `PROJECT:\n${project.title || ""}`,
    descriptionText && `PROJECT DESCRIPTION:\n${descriptionText}`,
    servicesText && `ACTUAL SERVICES PROVIDED:\n${servicesText}`,
    keywordsBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  return { content, servicesText, keywordsText };
}

// SHA-256 of the canonical content, used to skip re-embedding unchanged
// projects. Uses the browser's built-in SubtleCrypto — no new dependency.
export async function hashContent(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Keeps project_experience_embeddings in sync with projects/keywords so
// "Find Relevant Experience" has something to search. Two entry points:
//   - reindexProject(): called fire-and-forget right after a project is
//     saved (Add/Edit Project pages) — indexes just that one project.
//   - bulkReindexAll(): the admin "Rebuild Index" action — walks every
//     project the current user can see, skipping any whose canonical text
//     hasn't changed since it was last indexed (via content_hash), so
//     re-running it costs nothing for already-current projects and is
//     naturally resumable if interrupted partway through.
// Both go through plain supabase-js calls under normal RLS — no
// service-role key, no Edge Function (see project_experience_embeddings'
// RLS policies, which mirror project_keyword_details exactly).
import { useCallback } from "react";
import { supabase } from "../lib/supabase";
import { buildExperienceText, hashContent } from "../lib/buildExperienceText";
import { embedText } from "../lib/embeddingModel";
import { EMBEDDING_MODEL_ID, EMBEDDING_VERSION } from "../lib/experienceSearchConfig";

async function fetchKeywordDetails(projectId) {
  const { data } = await supabase
    .from("project_keyword_details")
    .select("description, keywords(name)")
    .eq("project_id", projectId);
  return (data || []).map((d) => ({ name: d.keywords?.name, description: d.description }));
}

// Indexes a single project. Pass keywordDetails if already loaded
// (Add/Edit Project pages have it in hand); otherwise it's fetched.
async function indexOneProject(project, keywordDetails) {
  const kwDetails = keywordDetails ?? (await fetchKeywordDetails(project.id));
  const { content, servicesText, keywordsText } = buildExperienceText(project, kwDetails);
  const contentHash = await hashContent(content);

  const { data: existing } = await supabase
    .from("project_experience_embeddings")
    .select("content_hash, embedding")
    .eq("project_id", project.id)
    .maybeSingle();

  if (existing && existing.content_hash === contentHash && existing.embedding) {
    return { status: "skipped" };
  }

  // Full-text/trigram search must not depend on the embedding model
  // loading successfully — write the row either way, with embedding left
  // null if generation fails, so lexical matching still works.
  let embedding = null;
  try {
    embedding = await embedText(content);
  } catch (err) {
    console.error("Embedding generation failed; indexing text-only for this project:", err);
  }

  const { error } = await supabase.from("project_experience_embeddings").upsert(
    {
      project_id: project.id,
      content,
      services_text: servicesText,
      keywords_text: keywordsText,
      content_hash: contentHash,
      embedding,
      embedding_model: EMBEDDING_MODEL_ID,
      embedding_version: EMBEDDING_VERSION,
      indexed_at: new Date().toISOString(),
    },
    { onConflict: "project_id" }
  );

  if (error) return { status: "failed", error };
  return { status: "indexed" };
}

export function useProjectIndexing() {
  // Fire-and-forget from a save handler — never throws, since a search-
  // index write failing must not block the user from having saved their
  // project.
  const reindexProject = useCallback(async (project, keywordDetails) => {
    try {
      return await indexOneProject(project, keywordDetails);
    } catch (err) {
      console.error("Failed to index project for search:", err);
      return { status: "failed", error: err };
    }
  }, []);

  const bulkReindexAll = useCallback(async (onProgress) => {
    const { data: projects, error: projErr } = await supabase.from("projects").select("*");
    if (projErr) throw projErr;

    const { data: kwDetails } = await supabase
      .from("project_keyword_details")
      .select("project_id, description, keywords(name)");
    const byProject = {};
    (kwDetails || []).forEach((d) => {
      if (!byProject[d.project_id]) byProject[d.project_id] = [];
      byProject[d.project_id].push({ name: d.keywords?.name, description: d.description });
    });

    const total = projects.length;
    let indexed = 0;
    let skipped = 0;
    const failed = [];
    const batchSize = 5;

    for (let i = 0; i < projects.length; i += batchSize) {
      const batch = projects.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map((p) => indexOneProject(p, byProject[p.id] || []).catch((err) => ({ status: "failed", error: err, project: p })))
      );
      results.forEach((r, idx) => {
        if (r.status === "indexed") indexed += 1;
        else if (r.status === "skipped") skipped += 1;
        else failed.push({ project: batch[idx], error: r.error });
      });
      onProgress?.({ done: Math.min(i + batchSize, total), total, indexed, skipped, failed: failed.length });
    }

    return { total, indexed, skipped, failed };
  }, []);

  return { reindexProject, bulkReindexAll };
}

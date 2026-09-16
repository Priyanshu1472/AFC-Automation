// Centralized tuning knobs for "Find Relevant Experience" (Knowledge
// Repository hybrid search). Nothing here is baked into the SQL side —
// supabase.rpc("find_relevant_experience", ...) returns raw, unweighted
// 0..1 component scores per candidate project; everything below combines
// those into one final 0..1 relevance number and a human-readable label.
// Adjust these constants (and re-deploy) to retune ranking without a
// migration.

// Weights must sum to 1 so the weighted score stays in 0..1 (each
// component score is itself already normalized to 0..1 by the RPC).
export const SEMANTIC_WEIGHT = 0.5;
export const SERVICES_WEIGHT = 0.25;
export const KEYWORD_WEIGHT = 0.15;
export const METADATA_WEIGHT = 0.10;

// Relevance labels shown to the user are derived from this exact formula:
//   finalScore = SEMANTIC_WEIGHT   * semantic_score
//              + SERVICES_WEIGHT   * services_score
//              + KEYWORD_WEIGHT    * keyword_score
//              + METADATA_WEIGHT   * metadata_score
// where each *_score is 0..1 (cosine similarity, normalized full-text
// rank, or trigram similarity — see the find_relevant_experience() SQL
// function for exactly how each is computed).
export function computeFinalScore({ semantic_score = 0, services_score = 0, keyword_score = 0, metadata_score = 0 }) {
  return (
    SEMANTIC_WEIGHT * semantic_score +
    SERVICES_WEIGHT * services_score +
    KEYWORD_WEIGHT * keyword_score +
    METADATA_WEIGHT * metadata_score
  );
}

// Thresholds are a starting point, not a validated benchmark — the spec
// this feature was built against explicitly calls for tuning these
// against real company projects once enough are indexed (the Knowledge
// Repository is empty at the time this was written).
export const RELEVANCE_HIGH = 0.55;
export const RELEVANCE_MEDIUM = 0.35;
export const RELEVANCE_LOW_CONFIDENCE = 0.25; // below this: "closest matches", not a real result

export function relevanceLabel(finalScore) {
  if (finalScore >= RELEVANCE_HIGH) return "High relevance";
  if (finalScore >= RELEVANCE_MEDIUM) return "Medium relevance";
  return "Low relevance";
}

// Per-component thresholds for deciding whether a component contributed
// enough to be worth mentioning in "Why it matched" — deliberately looser
// than the final-score thresholds since a single strong signal (e.g. an
// exact keyword hit) is worth surfacing even if the overall score is
// merely medium.
export const COMPONENT_MATCH_THRESHOLD = 0.15;

export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIMENSIONS = 384;
export const EMBEDDING_VERSION = 1;

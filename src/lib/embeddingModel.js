// Local, in-browser text embeddings for "Find Relevant Experience" —
// no project/company data is ever sent to an external AI API. The only
// network traffic this causes is a one-time download of the public,
// pre-trained model's weights (from the model hub transformers.js talks
// to), the same way a font or icon library would be fetched; the actual
// text being embedded (project descriptions, search queries, etc.) never
// leaves the browser.
//
// Loaded via a runtime CDN import, same pattern this codebase already
// uses for docx/mammoth/pdf-lib/html2canvas (see ProjectDetailsPage.jsx,
// knowledgeDocumentEmbed.js) — kept out of the Vite bundle entirely. This
// module deliberately DIFFERS from that existing pattern in one way: it
// caches the imported library and the loaded pipeline at module scope,
// because the model itself is tens of MB and must not be re-fetched or
// re-initialized on every search or every reindexed project — every other
// dynamic-CDN-import in this codebase re-imports fresh each call, which is
// fine for small libraries but would make this feature unusably slow.
// The prebuilt browser bundle (not esm.sh's re-bundled transform, which
// mis-resolves a couple of this package's conditional Node-only requires
// as real imports and fails with "module 'buffer'/'long' not found") —
// this is the exact file transformers.js ships for direct CDN/browser use.
const TRANSFORMERS_URL = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/dist/transformers.min.js";
const MODEL_ID = "Xenova/all-MiniLM-L6-v2";

let extractorPromise = null;

async function getExtractor(onProgress) {
  if (!extractorPromise) {
    extractorPromise = (async () => {
      const { pipeline, env } = await import(/* @vite-ignore */ TRANSFORMERS_URL);
      env.allowLocalModels = false;
      return pipeline("feature-extraction", MODEL_ID, {
        quantized: true,
        progress_callback: onProgress,
      });
    })();
  }
  return extractorPromise;
}

// Loads the model (first call only — subsequent calls reuse the cached
// pipeline) so callers can show a "preparing search…" state before the
// user's first query, rather than surprising them with a slow first call.
export async function preloadEmbeddingModel(onProgress) {
  await getExtractor(onProgress);
}

// Returns a plain number[] of length EMBEDDING_DIMENSIONS (384 for
// all-MiniLM-L6-v2), mean-pooled and L2-normalized — ready to hand to
// pgvector as-is.
export async function embedText(text, onProgress) {
  const extractor = await getExtractor(onProgress);
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

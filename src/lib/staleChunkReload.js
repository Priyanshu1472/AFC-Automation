// After a new deploy, a tab that was already open still runs the old build.
// The first time it opens a page it hasn't loaded yet, it asks for the old
// hashed chunk (e.g. /assets/HomePage-abc123.js), which no longer exists,
// so the dynamic import fails and the ErrorBoundary would show
// "Something went wrong". The fix is to reload once and pick up the new build.
//
// The reload is rate-limited through sessionStorage so a chunk that is
// genuinely broken can't trap the user in a reload loop.

const KEY = "afc:stale-chunk-reload-at";
const MIN_INTERVAL_MS = 30_000;

const CHUNK_ERROR_RE =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk [\w-]+ failed|is not a valid JavaScript MIME type/i;

export function isChunkLoadError(error) {
  if (!error) return false;
  if (error.name === "ChunkLoadError") return true;
  return CHUNK_ERROR_RE.test(String(error.message || error));
}

// Reloads the page unless we already did so in the last 30 seconds.
// Returns true when a reload was started.
export function reloadForStaleChunk() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY)) || 0;
  } catch {
    // storage blocked: still reload, the interval guard just can't apply
  }
  if (Date.now() - last < MIN_INTERVAL_MS) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // ignore
  }
  window.location.reload();
  return true;
}

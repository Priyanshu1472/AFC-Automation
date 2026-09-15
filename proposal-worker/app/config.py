"""Worker configuration — every value comes from the environment (Docker
env vars / a local .env for `docker compose`). Never hardcode a secret.
"""
import os

from dotenv import load_dotenv

load_dotenv()


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


SUPABASE_URL = _required("SUPABASE_URL")
# Service-role key — bypasses RLS by design (the worker only ever acts on
# jobs the create-proposal-generation-job edge function already validated
# and inserted; it never receives untrusted input directly). Never expose
# this to the frontend.
SUPABASE_SERVICE_ROLE_KEY = _required("SUPABASE_SERVICE_ROLE_KEY")

BUCKET = os.environ.get("PROPOSAL_BUCKET", "proposal-documents")

# How many jobs this worker process will process at once. Expected volume
# is ~300-400 proposals/year (~1/day) — 2 is generous headroom, not a
# real scaling requirement. Configurable per the spec's "make this
# configurable" — bump only if actually needed.
MAX_CONCURRENT_JOBS = int(os.environ.get("PROPOSAL_WORKER_CONCURRENCY", "2"))

# Seconds between polls when there's no work. Sub-minute latency is more
# than enough responsiveness for a low-volume, non-interactive generation
# job (the frontend shows a "processing" state either way).
POLL_INTERVAL_SECONDS = float(os.environ.get("PROPOSAL_WORKER_POLL_INTERVAL", "10"))

# Bounds how long one bad file's LibreOffice conversion can hold up a
# worker slot — the dominant risk for "one job corrupting another"
# (LibreOffice hanging), see document_converter.py.
LIBREOFFICE_TIMEOUT_SECONDS = int(os.environ.get("PROPOSAL_WORKER_LO_TIMEOUT", "90"))

MAX_OUTPUT_FILE_SIZE_BYTES = int(os.environ.get("PROPOSAL_WORKER_MAX_OUTPUT_BYTES", str(25 * 1024 * 1024)))

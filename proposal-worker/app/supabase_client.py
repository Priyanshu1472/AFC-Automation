"""Thin wrapper around supabase-py, service-role only. Every read/write
this worker does bypasses RLS by design — it only ever acts on rows the
create-proposal-generation-job edge function already validated and
inserted (see that function's docstring), never on raw client input.
"""
from pathlib import Path

from supabase import Client, create_client

from app.config import BUCKET, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL

JOBS_TABLE = "proposal_generation_jobs"


def get_client() -> Client:
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def claim_next_job(client: Client) -> dict | None:
    """Optimistic claim: read one queued job, then conditionally update it
    to 'processing' only if it's still 'queued'. At this project's volume
    (~300-400 jobs/year) true concurrent contention between worker
    replicas is vanishingly unlikely, so this simple read-then-conditional-
    update is enough — no need for a raw Postgres connection (FOR UPDATE
    SKIP LOCKED) just to avoid a race that will essentially never happen.
    """
    candidates = (
        client.table(JOBS_TABLE)
        .select("id, proposal_id, selected_items")
        .eq("status", "queued")
        .order("created_at")
        .limit(1)
        .execute()
    )
    if not candidates.data:
        return None

    candidate = candidates.data[0]
    claimed = (
        client.table(JOBS_TABLE)
        .update({"status": "processing", "claimed_at": _now_iso(), "started_at": _now_iso()})
        .eq("id", candidate["id"])
        .eq("status", "queued")
        .execute()
    )
    if not claimed.data:
        return None  # another worker won the race
    return candidate


def mark_completed(client: Client, job_id: str, result: dict) -> None:
    """`result` carries the PDF (always present) and DOCX (best-effort —
    see document_converter.py's docstring on why PDF->DOCX can fail or be
    skipped without failing the whole job) output file info — see
    proposal_generator.run_job for its exact shape.
    """
    client.table(JOBS_TABLE).update({
        "status": "completed",
        "output_pdf_name": result["pdf_name"],
        "output_pdf_path": result["pdf_path"],
        "output_pdf_size": result["pdf_size"],
        "output_docx_name": result.get("docx_name"),
        "output_docx_path": result.get("docx_path"),
        "output_docx_size": result.get("docx_size"),
        "completed_at": _now_iso(),
    }).eq("id", job_id).execute()


def mark_failed(client: Client, job_id: str, error_message: str) -> None:
    client.table(JOBS_TABLE).update({
        "status": "failed",
        "error_message": error_message[:2000],
        "completed_at": _now_iso(),
    }).eq("id", job_id).execute()


def get_proposal_and_lead(client: Client, proposal_id: str) -> tuple[dict, dict]:
    proposal = client.table("proposal_preparations").select("id, lead_id").eq("id", proposal_id).single().execute().data
    lead = client.table("leads").select("title, client_name").eq("id", proposal["lead_id"]).single().execute().data
    return proposal, lead


def download_source_file(client: Client, storage_path: str, dest: Path) -> None:
    data = client.storage.from_(BUCKET).download(storage_path)
    dest.write_bytes(data)


_CONTENT_TYPES = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def upload_final_file(client: Client, storage_path: str, data: bytes, ext: str) -> None:
    client.storage.from_(BUCKET).upload(
        storage_path, data, file_options={"content-type": _CONTENT_TYPES[ext], "upsert": "true"}
    )


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()

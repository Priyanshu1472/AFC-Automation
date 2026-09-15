"""Entry point — polls proposal_generation_jobs for 'queued' rows and
processes up to MAX_CONCURRENT_JOBS at once. No public endpoint: this
process makes only outbound calls to Supabase, so it deploys as a
"background worker" (Render/Fly/Railway all support that service type)
rather than a web service — one less thing exposed to the internet.
"""
import logging
import time
from concurrent.futures import Future, ThreadPoolExecutor

from app import supabase_client
from app.config import MAX_CONCURRENT_JOBS, POLL_INTERVAL_SECONDS
from app.proposal_generator import GenerationError, run_job

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worker")


def process_one_job(job: dict) -> None:
    # A fresh client per job (and thread) — supabase-py's Client wraps an
    # httpx session that isn't documented as thread-safe, so sharing one
    # across concurrently-running jobs isn't worth the risk at this volume.
    client = supabase_client.get_client()
    job_id = job["id"]
    try:
        name, path, size = run_job(client, job)
        supabase_client.mark_completed(client, job_id, name, path, size)
        log.info("Job %s completed -> %s", job_id, path)
    except GenerationError as exc:
        supabase_client.mark_failed(client, job_id, str(exc))
        log.warning("Job %s failed: %s", job_id, exc)
    except Exception:
        # Never let one bad job (or an unanticipated bug) take the whole
        # worker process down — every other in-flight/future job must
        # keep going. Full detail to the server log only; the frontend
        # gets a safe, generic message (spec section 33/28).
        log.exception("Job %s failed unexpectedly", job_id)
        supabase_client.mark_failed(client, job_id, "Something went wrong while generating this proposal. Please try again.")


def main() -> None:
    log.info("Proposal worker starting (concurrency=%d, poll interval=%ss)", MAX_CONCURRENT_JOBS, POLL_INTERVAL_SECONDS)
    with ThreadPoolExecutor(max_workers=MAX_CONCURRENT_JOBS) as pool:
        in_flight: set[Future] = set()
        while True:
            in_flight = {f for f in in_flight if not f.done()}
            free_slots = MAX_CONCURRENT_JOBS - len(in_flight)
            if free_slots > 0:
                claim_client = supabase_client.get_client()
                for _ in range(free_slots):
                    job = supabase_client.claim_next_job(claim_client)
                    if not job:
                        break
                    log.info("Claimed job %s", job["id"])
                    in_flight.add(pool.submit(process_one_job, job))
            time.sleep(POLL_INTERVAL_SECONDS)


if __name__ == "__main__":
    main()

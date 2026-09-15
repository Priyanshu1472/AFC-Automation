# Proposal Worker

Assembles a Final Proposal PDF (and a Word download generated from it)
from documents already stored in the main app's `proposal-documents`
Supabase Storage bucket: converts DOCX/DOC/XLS/XLSX to PDF with
LibreOffice (real rendering, not a rasterized approximation), preserves
PDFs exactly as uploaded, and adds a cover, Table of Contents, and page
numbering — see the module docstrings in `app/` for how each piece
works, and `tests/` for what's actually verified (page-numbering math,
TOC pagination, bookmark placement, full orchestration — all runnable
without LibreOffice; only the LibreOffice conversion step itself isn't
covered by these tests, since LibreOffice isn't available in a plain
Python environment — see "Smoke-testing the LibreOffice step" below).

The PDF is the guaranteed, always-produced artifact. The Word (.docx)
download is generated FROM that finished PDF (same cover/TOC/page
numbers/order) via LibreOffice's own PDF import — genuinely editable,
but a lossier reconstruction than the DOCX→PDF direction (PDF's fixed
page layout becomes Word text-frames, not flowing paragraphs), so it's
best-effort: a job still completes with the PDF alone if that step fails
(see `document_converter.py` and `proposal_generator.py`'s docstrings).

It is a separate service from the rest of this app on purpose — see
`create-proposal-generation-job` (a Supabase Edge Function) for why:
LibreOffice/PyMuPDF/pypdf/ReportLab are Python/binary tools that can't
run inside Supabase's Deno-based Edge Functions.

## How it fits together

1. The frontend (Proposal Preparation page, "Generate Final Proposal")
   calls the `create-proposal-generation-job` edge function with the
   user's selected documents and order.
2. That function re-validates everything server-side (proposal
   ownership, that each document actually belongs to this proposal, file
   type) and inserts a row into `proposal_generation_jobs` with
   `status = 'queued'`.
3. This worker polls that table (no webhook, no queue service — the
   simplest reliable mechanism for ~300-400 jobs/year), claims a job,
   downloads the selected files, converts/assembles/numbers them, and
   uploads the final PDF (and, best-effort, the Word version derived
   from it) back into the same Storage bucket.
4. It updates the job row to `completed` (with both output paths, or
   just the PDF's if the Word conversion failed) or `failed` (with a
   user-safe error message). The frontend is subscribed to that row via
   Supabase Realtime and reacts accordingly.

No public endpoint anywhere in this service — it only ever makes outbound
calls to Supabase, so it deploys as a **background worker**, not a web
service (Render, Fly.io, and Railway all support that service type
explicitly for exactly this shape of workload).

## Local development

```bash
cp .env.example .env   # fill in SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
docker compose up --build
```

## Running the tests

```bash
pip install -r requirements.txt pytest
pytest
```

These exercise the real numbering/TOC/assembly/bookmark logic against
actual (small, generated) PDFs — they don't need LibreOffice, a live
Supabase project, or Docker.

## Smoke-testing the LibreOffice step

The one thing not covered by the automated tests (no LibreOffice in a
plain Python environment). After building the image:

```bash
docker build -t proposal-worker .
docker run --rm -v "$(pwd)/testfile.docx:/tmp/in.docx" proposal-worker \
  soffice --headless --convert-to pdf --outdir /tmp /tmp/in.docx
```

Confirm `/tmp/in.pdf` exists inside the container and looks right when
copied out.

## Deploying

Pick any container host that supports a "background worker" / non-HTTP
service (this repo doesn't dictate one — Render, Fly.io, Railway, a VPS
with `docker compose` and a restart policy, etc. all work identically,
since the code and Dockerfile are the same regardless). Set the two
required env vars (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — the
`SUPABASE_SERVICE_ROLE_KEY` **must** stay a server-side secret, never in
the frontend build) and deploy the image. Concurrency (`PROPOSAL_WORKER_
CONCURRENCY`, default 2) and poll interval are both configurable via env
vars — see `.env.example` — without needing a code change or redeploy of
anything else.

## Known limitations (honest, not hidden)

- **DOCX formatting fidelity** depends on LibreOffice's own DOCX
  rendering, which is very good but not byte-identical to Word's own
  rendering in every edge case (an unusual font, exotic field codes,
  etc.). This is categorically more faithful than the project's earlier
  client-side approach (mammoth.js → HTML → docx.js, which dropped
  tables and images entirely) — but "as closely as possible", not
  "guaranteed pixel-identical to Word."
- **Internal hyperlinks** (a link that jumps to another page *within the
  same source document*) can end up pointing at the wrong page once that
  document is spliced into the middle of a larger assembled PDF — an
  inherent limit of concatenating independently-authored PDFs. External
  hyperlinks (to a URL) are unaffected.
- **Job claiming** is an optimistic read-then-conditional-update, not a
  `SELECT ... FOR UPDATE SKIP LOCKED` — correct and simple at this
  project's volume (~300-400/year), but not what you'd reach for at much
  higher, genuinely concurrent volume.

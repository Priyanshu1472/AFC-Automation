"""Orchestrates ONE generation job end to end. Pure orchestration — every
actual piece of work (convert, assemble, number, upload) lives in its own
module and is unit-tested there; this file just wires them together in
the right order and guarantees cleanup.
"""
import logging
import shutil
import tempfile
import uuid
from pathlib import Path

from supabase import Client

from app import supabase_client
from app.config import MAX_OUTPUT_FILE_SIZE_BYTES
from app.cover import render_cover_pdf
from app.document_converter import ConversionError, convert_pdf_to_docx, convert_to_pdf
from app.filenames import output_filename, sanitize_filename
from app.page_numbering import Section, build_page_labels, build_toc_entries, compute_arabic_starts, render_page_number_overlay
from app.pdf_assembler import add_bookmarks, apply_page_number_overlay, assemble_content_pdf, page_count
from app.toc_generator import render_toc_pdf

log = logging.getLogger("proposal_generator")


class GenerationError(Exception):
    """A user-facing failure — mark_failed's error_message is shown as-is
    on the frontend, so this must never leak a filesystem path, a stack
    trace, or an internal detail. Anything unexpected is caught and
    re-raised as this with a generic message instead (see run_job).
    """


def _prepare_section(client: Client, item: dict, index: int, work_dir: Path) -> Section:
    ext = item["ext"]
    local_input = work_dir / f"src_{index}.{ext}"
    supabase_client.download_source_file(client, item["file_path"], local_input)

    if ext == "pdf":
        pdf_path = local_input
    else:
        try:
            pdf_path = convert_to_pdf(local_input, work_dir)
        except ConversionError as exc:
            raise GenerationError(f'Unable to convert "{item["file_name"]}" to PDF. {exc}') from exc

    try:
        pages = page_count(pdf_path.read_bytes())
    except Exception as exc:  # pypdf raises various error types for a corrupt file
        raise GenerationError(f'Unable to process "{item["file_name"]}". The file may be corrupted.') from exc
    if pages == 0:
        raise GenerationError(f'"{item["file_name"]}" has no pages.')

    return Section(label=item["label"], path=str(pdf_path), page_count=pages)


def run_job(client: Client, job: dict, include_cover: bool = True) -> dict:
    """Returns a dict: pdf_name/pdf_path/pdf_size (always present) and
    docx_name/docx_path/docx_size (present only if the PDF->DOCX
    conversion succeeded — see document_converter.py's docstring on why
    that direction is best-effort, not guaranteed, and never blocks
    delivering the PDF). Raises GenerationError on any failure building
    the PDF itself — the caller (worker.py) is responsible for calling
    mark_failed with its message. `client` is a fresh Client per call
    (see worker.py) — nothing here is shared mutable state, so this is
    safe to run concurrently across jobs.
    """
    proposal_id = job["proposal_id"]
    selected_items = job["selected_items"]
    if not selected_items:
        raise GenerationError("Please select at least one document.")

    proposal, lead = supabase_client.get_proposal_and_lead(client, proposal_id)
    title = lead.get("title") or "Proposal"
    client_name = lead.get("client_name")

    work_dir = Path(tempfile.mkdtemp(prefix=f"proposal_{job['id']}_"))
    try:
        sections = [_prepare_section(client, item, i, work_dir) for i, item in enumerate(selected_items)]

        cover_bytes = render_cover_pdf(title, client_name) if include_cover else None
        toc_entries = build_toc_entries(sections)
        toc_bytes = render_toc_pdf(toc_entries)
        toc_page_count = page_count(toc_bytes)

        content_bytes = assemble_content_pdf(cover_bytes, toc_bytes, sections)

        main_content_pages = sum(s.page_count for s in sections)
        labels = build_page_labels(bool(cover_bytes), toc_page_count, main_content_pages)
        overlay_bytes = render_page_number_overlay(labels)
        numbered_bytes = apply_page_number_overlay(content_bytes, overlay_bytes)

        try:
            arabic_starts = compute_arabic_starts(sections)
            final_bytes = add_bookmarks(numbered_bytes, bool(cover_bytes), toc_page_count, sections, arabic_starts, title)
        except Exception:
            # Bookmarks are desirable, not load-bearing (spec section 22).
            log.warning("Bookmark generation failed for job %s; continuing without bookmarks.", job["id"], exc_info=True)
            final_bytes = numbered_bytes

        if len(final_bytes) > MAX_OUTPUT_FILE_SIZE_BYTES:
            raise GenerationError(
                f"The assembled proposal is too large ({len(final_bytes) / (1024 * 1024):.1f} MB). "
                f"Remove a document or split it into multiple proposals."
            )

        job_prefix = sanitize_filename(job["id"])
        pdf_name = output_filename(client_name, title, "pdf")
        pdf_path = f"{proposal_id}/final/{job_prefix}_{pdf_name}"
        supabase_client.upload_final_file(client, pdf_path, final_bytes, "pdf")

        result = {"pdf_name": pdf_name, "pdf_path": pdf_path, "pdf_size": len(final_bytes)}

        # Word download — derived FROM the already-finalized PDF (so it
        # carries the same cover/TOC/page numbers/order), via LibreOffice.
        # Best-effort: a PDF the worker can merge just fine sometimes isn't
        # one LibreOffice can reconstruct as DOCX cleanly — that's a
        # narrower, format-reconstruction failure mode, not a reason to
        # fail the whole job when the PDF (the guaranteed-fidelity
        # artifact) already built successfully.
        try:
            final_pdf_path = work_dir / "final.pdf"
            final_pdf_path.write_bytes(final_bytes)
            docx_local_path = convert_pdf_to_docx(final_pdf_path, work_dir)
            docx_bytes = docx_local_path.read_bytes()

            docx_name = output_filename(client_name, title, "docx")
            docx_path = f"{proposal_id}/final/{job_prefix}_{docx_name}"
            supabase_client.upload_final_file(client, docx_path, docx_bytes, "docx")
            result.update({"docx_name": docx_name, "docx_path": docx_path, "docx_size": len(docx_bytes)})
        except Exception:
            log.warning("PDF->DOCX conversion failed for job %s; PDF-only.", job["id"], exc_info=True)

        return result
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)

"""LibreOffice headless — real native rendering (fonts, tables, images,
layout) instead of the old client-side mammoth+html2canvas rasterization
this project used elsewhere, which is exactly the "Case 1: preserve
original formatting" requirement.

Two directions, same underlying subprocess call:
  - DOCX/DOC/XLS/XLSX -> PDF for each selected source document
    (convert_to_pdf).
  - The final assembled PDF -> DOCX, for the Word download option
    (convert_pdf_to_docx). This is a fundamentally lossier direction than
    the first — LibreOffice reconstructs a PDF's fixed page layout as
    Word text-frames rather than flowing paragraphs, so the result is a
    genuinely editable .docx (not an image), but its layout fidelity to
    the original is noticeably rougher than the PDF's. Documented, not
    hidden — see proposal_generator.py's docstring and the frontend's
    copy on the Word download option.

Not covered by this repo's automated tests: LibreOffice itself isn't
installed in the environment these tests run in (see the worker's
README for how to smoke-test this module once the Docker image is
built) — every OTHER module in this worker (numbering, TOC, assembly,
overlay, bookmarks, filenames) is unit-tested for real with actual PDFs.
"""
import logging
import subprocess
import uuid
from pathlib import Path

from app.config import LIBREOFFICE_TIMEOUT_SECONDS

log = logging.getLogger("document_converter")


class ConversionError(Exception):
    pass


def _run_soffice_convert(input_path: Path, output_dir: Path, to_format: str, infilter: str | None = None) -> Path:
    """Never uses a shell string (subprocess.run gets a plain argv list —
    no shell=True, so nothing in a filename can be interpreted as a shell
    command), and gives each invocation its own LibreOffice profile
    directory so two concurrent jobs (see config.MAX_CONCURRENT_JOBS)
    never contend on the same lock file.

    `infilter` forces which import filter opens the source file, rather
    than relying on soffice's own autodetection — needed for PDF->DOCX
    specifically (see convert_pdf_to_docx): without it, soffice's
    autodetection for a .pdf source under --convert-to doesn't reliably
    pick the PDF-as-editable-document import path and fails outright with
    "source file could not be loaded", even with libreoffice-draw (which
    owns that import filter) installed.
    """
    profile_dir = output_dir / f"lo_profile_{uuid.uuid4().hex}"
    profile_dir.mkdir(parents=True, exist_ok=True)

    argv = [
        "soffice",
        "--headless",
        "--norestore",
        "--nolockcheck",
        "--nodefault",
        f"-env:UserInstallation=file://{profile_dir.as_posix()}",
        "--convert-to", to_format,
    ]
    if infilter:
        # Must be ONE argv token with "=" — soffice's own arg parser
        # rejects "--infilter" and the value as two separate argv items
        # ("Error in option: --infilter", confirmed against a real
        # container run), which silently fell through to the exact same
        # autodetection failure this was meant to fix.
        argv += [f"--infilter={infilter}"]
    argv += ["--outdir", str(output_dir), str(input_path)]

    try:
        result = subprocess.run(
            argv,
            capture_output=True,
            text=True,
            timeout=LIBREOFFICE_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ConversionError(f"Converting \"{input_path.name}\" timed out after {LIBREOFFICE_TIMEOUT_SECONDS}s.") from exc

    # to_format can carry a filter suffix, e.g. "docx:MS Word 2007 XML" —
    # the output extension is always just the part before the colon.
    output_ext = to_format.split(":", 1)[0]
    expected_output = output_dir / f"{input_path.stem}.{output_ext}"
    if result.returncode != 0 or not expected_output.exists():
        # soffice's actual failure reason is often on stdout, not stderr
        # (the javaldx line that WAS showing up is themself just a benign
        # startup warning, not the real cause) — log everything available
        # so the next failure is diagnosable from one log capture instead
        # of guessing blind. Full detail goes to the worker's own log
        # (server-side only); the user-facing GenerationError message
        # built from this stays short (see proposal_generator.py).
        listing = sorted(p.name for p in output_dir.iterdir()) if output_dir.exists() else []
        log.warning(
            "soffice convert failed: argv=%s exit=%s\n--- stdout ---\n%s\n--- stderr ---\n%s\n--- %s contents ---\n%s",
            argv, result.returncode, (result.stdout or "").strip(), (result.stderr or "").strip(), output_dir, listing,
        )
        detail_tail = ((result.stderr or "") + " " + (result.stdout or "")).strip()[-500:]
        raise ConversionError(f"Unable to convert \"{input_path.name}\" to .{output_ext}.{(' ' + detail_tail) if detail_tail else ''}")

    return expected_output


def convert_to_pdf(input_path: Path, output_dir: Path) -> Path:
    """Converts one office document to PDF in `output_dir`."""
    return _run_soffice_convert(input_path, output_dir, "pdf")


def convert_pdf_to_docx(input_path: Path, output_dir: Path) -> Path:
    """Converts the final assembled PDF to an editable .docx — see this
    module's docstring for the fidelity tradeoff, and _run_soffice_convert
    for why this needs an explicit infilter.
    """
    return _run_soffice_convert(input_path, output_dir, "docx:MS Word 2007 XML", infilter="writer_pdf_import")

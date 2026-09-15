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
import subprocess
import uuid
from pathlib import Path

from app.config import LIBREOFFICE_TIMEOUT_SECONDS


class ConversionError(Exception):
    pass


def _run_soffice_convert(input_path: Path, output_dir: Path, to_format: str) -> Path:
    """Never uses a shell string (subprocess.run gets a plain argv list —
    no shell=True, so nothing in a filename can be interpreted as a shell
    command), and gives each invocation its own LibreOffice profile
    directory so two concurrent jobs (see config.MAX_CONCURRENT_JOBS)
    never contend on the same lock file.
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
        "--outdir", str(output_dir),
        str(input_path),
    ]

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
        stderr_tail = (result.stderr or "").strip()[-500:]
        raise ConversionError(f"Unable to convert \"{input_path.name}\" to .{output_ext}.{(' ' + stderr_tail) if stderr_tail else ''}")

    return expected_output


def convert_to_pdf(input_path: Path, output_dir: Path) -> Path:
    """Converts one office document to PDF in `output_dir`."""
    return _run_soffice_convert(input_path, output_dir, "pdf")


def convert_pdf_to_docx(input_path: Path, output_dir: Path) -> Path:
    """Converts the final assembled PDF to an editable .docx — see this
    module's docstring for the fidelity tradeoff.
    """
    return _run_soffice_convert(input_path, output_dir, "docx:MS Word 2007 XML")

"""DOCX/DOC/XLS/XLSX -> PDF via LibreOffice headless — real native
rendering (fonts, tables, images, layout) instead of the old client-side
mammoth+html2canvas rasterization this project used elsewhere, which is
exactly the "Case 1: preserve original formatting" requirement.

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


def convert_to_pdf(input_path: Path, output_dir: Path) -> Path:
    """Converts one office document to PDF in `output_dir`. Never uses a
    shell string (subprocess.run gets a plain argv list — no shell=True,
    so nothing in a filename can be interpreted as a shell command), and
    gives each invocation its own LibreOffice profile directory so two
    concurrent jobs (see config.MAX_CONCURRENT_JOBS) never contend on the
    same lock file.
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
        "--convert-to", "pdf",
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

    expected_output = output_dir / f"{input_path.stem}.pdf"
    if result.returncode != 0 or not expected_output.exists():
        stderr_tail = (result.stderr or "").strip()[-500:]
        raise ConversionError(f"Unable to convert \"{input_path.name}\" to PDF.{(' ' + stderr_tail) if stderr_tail else ''}")

    return expected_output

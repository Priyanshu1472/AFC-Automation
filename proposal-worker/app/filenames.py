"""Filename/path safety — the two places untrusted-ish strings (a client
name, a proposal title, an uploaded file's own name) turn into filesystem
or storage paths. Nothing here ever trusts a path segment from the client
directly; source file paths always come from create-proposal-generation-job's
server-verified selected_items (see index.ts), never from a raw request.
"""
import re
import unicodedata

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def sanitize_filename(name: str, fallback: str = "file") -> str:
    """Collapses anything that isn't alnum/dot/dash/underscore, strips
    leading dots (hidden-file / path-trick prevention), caps length. Never
    returns an empty string.
    """
    normalized = unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode("ascii")
    cleaned = _UNSAFE.sub("_", normalized).strip("._")
    cleaned = re.sub(r"_+", "_", cleaned)
    if not cleaned:
        cleaned = fallback
    return cleaned[:150]


def output_base_name(client_name: str | None, proposal_title: str | None) -> str:
    base = sanitize_filename(client_name or "", "") or sanitize_filename(proposal_title or "", "Proposal")
    return f"{base}_Final" if base else "Proposal_Final"


def output_filename(client_name: str | None, proposal_title: str | None, ext: str = "pdf") -> str:
    return f"{output_base_name(client_name, proposal_title)}.{ext}"


def is_safe_relative_path(path: str) -> bool:
    """Guards against path traversal in any path we're about to join onto
    a temp directory — no leading slash, no "..", no null bytes.
    """
    if not path or "\x00" in path:
        return False
    if path.startswith("/") or path.startswith("\\"):
        return False
    parts = re.split(r"[\\/]+", path)
    return ".." not in parts

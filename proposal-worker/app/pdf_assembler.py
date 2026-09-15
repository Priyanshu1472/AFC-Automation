"""Real PDF-page assembly — pypdf's PdfWriter.append() copies each source
page's own content stream, fonts, images, and annotations (including
hyperlinks) as-is. Nothing here rasterizes a page or re-renders text, so
source formatting/quality is preserved exactly (the whole point of "Case
1" in the task spec — see the doc string on document_converter.py for the
DOCX side of that same guarantee).

Known limitation (documented, not silently hidden): an internal hyperlink
that jumps to another page *within the same source document* can end up
pointing at the wrong page once that document is spliced into a larger
PDF alongside others — this is an inherent limit of concatenating
independently-authored PDFs, not something fixable without rewriting
every such link's destination (out of scope for v1; external hyperlinks
are unaffected).
"""
from io import BytesIO

from pypdf import PdfReader, PdfWriter

from app.page_numbering import Section


def assemble_content_pdf(cover_bytes: bytes | None, toc_bytes: bytes, sections: list[Section]) -> bytes:
    """Cover (optional) + TOC + every section's own pages, in order —
    before any page-number overlay is applied.
    """
    writer = PdfWriter()
    if cover_bytes:
        writer.append(PdfReader(BytesIO(cover_bytes)))
    writer.append(PdfReader(BytesIO(toc_bytes)))
    for section in sections:
        writer.append(PdfReader(section.path))
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def apply_page_number_overlay(pdf_bytes: bytes, overlay_bytes: bytes) -> bytes:
    """Merges each overlay page onto the matching physical page of the
    assembled PDF — never edits the underlying content, just composites a
    transparent page-number layer on top (spec section 20: "do not modify
    the original source PDF content unnecessarily").
    """
    writer = PdfWriter(clone_from=BytesIO(pdf_bytes))
    overlay_reader = PdfReader(BytesIO(overlay_bytes))
    for i, page in enumerate(writer.pages):
        if i < len(overlay_reader.pages):
            page.merge_page(overlay_reader.pages[i])
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def add_bookmarks(pdf_bytes: bytes, has_cover: bool, toc_page_count: int, sections: list[Section], arabic_starts: list[int], root_title: str) -> bytes:
    """PDF outline: root title, cover (if any), Table of Contents, then
    one entry per section pointing at its actual starting physical page.
    Desirable, not load-bearing — proposal_generator wraps this call and
    falls back to no bookmarks on failure rather than failing the whole
    job (spec section 22: "must not block the core functionality").
    """
    reader = PdfReader(BytesIO(pdf_bytes))
    writer = PdfWriter()
    writer.append(reader)

    root = writer.add_outline_item(root_title, 0)
    physical_offset = (1 if has_cover else 0)
    if has_cover:
        writer.add_outline_item("Cover", 0, parent=root)
    writer.add_outline_item("Table of Contents", physical_offset, parent=root)

    content_offset = physical_offset + toc_page_count
    for section, start in zip(sections, arabic_starts):
        physical_index = content_offset + (start - 1)
        writer.add_outline_item(section.label, physical_index, parent=root)

    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def page_count(pdf_bytes: bytes) -> int:
    return len(PdfReader(BytesIO(pdf_bytes)).pages)

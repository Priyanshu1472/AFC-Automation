import os
import tempfile
from io import BytesIO

from pypdf import PdfReader
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.cover import render_cover_pdf
from app.page_numbering import Section, build_page_labels, build_toc_entries, compute_arabic_starts, render_page_number_overlay
from app.pdf_assembler import add_bookmarks, apply_page_number_overlay, assemble_content_pdf, page_count
from app.toc_generator import render_toc_pdf


def _make_pdf(n_pages: int, label: str) -> bytes:
    """A tiny real PDF with n_pages pages, each with `label` drawn on it
    — a stand-in for a "source document already converted to PDF" without
    needing LibreOffice (that part is tested separately/manually — see
    document_converter.py's own docstring).
    """
    buf = BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    for i in range(n_pages):
        c.drawString(100, 700, f"{label} page {i + 1}")
        c.showPage()
    c.save()
    return buf.getvalue()


def _write_temp_pdf(data: bytes) -> str:
    fd, path = tempfile.mkstemp(suffix=".pdf")
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return path


def test_full_pipeline_matches_spec_worked_example():
    # Same shape as the task spec's own section 18 example, minus the
    # cover (tested separately below) to keep this test focused on the
    # assembly + numbering interaction.
    tech_path = _write_temp_pdf(_make_pdf(4, "Technical"))
    profile_path = _write_temp_pdf(_make_pdf(7, "Profile"))
    financial_path = _write_temp_pdf(_make_pdf(5, "Financial"))
    try:
        sections = [
            Section("Technical Proposal", tech_path, 4),
            Section("Company Profile", profile_path, 7),
            Section("Financial Proposal", financial_path, 5),
        ]
        starts = compute_arabic_starts(sections)
        assert starts == [1, 5, 12]

        toc_entries = build_toc_entries(sections)
        toc_bytes = render_toc_pdf(toc_entries)
        toc_page_count = page_count(toc_bytes)
        assert toc_page_count >= 1

        content = assemble_content_pdf(cover_bytes=None, toc_bytes=toc_bytes, sections=sections)
        # TOC pages + 4 + 7 + 5 content pages, no cover.
        assert page_count(content) == toc_page_count + 16

        labels = build_page_labels(has_cover=False, toc_page_count=toc_page_count, main_content_page_count=16)
        overlay = render_page_number_overlay(labels)
        numbered = apply_page_number_overlay(content, overlay)
        assert page_count(numbered) == page_count(content)

        reader = PdfReader(BytesIO(numbered))
        # First content page (right after the TOC) must show Arabic "1" —
        # never the source document's own page number, per spec section 16.
        first_content_page_index = toc_page_count
        assert "1" in reader.pages[first_content_page_index].extract_text()
        # Company Profile's first page (index toc_page_count + 4) must show "5".
        assert "5" in reader.pages[toc_page_count + 4].extract_text()
        # Financial Proposal's first page must show "12".
        assert "12" in reader.pages[toc_page_count + 11].extract_text()
        # The very last page (Financial's 5th) must show "16".
        assert "16" in reader.pages[-1].extract_text()
    finally:
        for p in (tech_path, profile_path, financial_path):
            os.remove(p)


def test_cover_has_no_visible_page_number():
    doc_path = _write_temp_pdf(_make_pdf(1, "Doc"))
    try:
        sections = [Section("Doc", doc_path, 1)]
        toc_bytes = render_toc_pdf(build_toc_entries(sections))
        toc_pages = page_count(toc_bytes)
        cover_bytes = render_cover_pdf("My Proposal", "Client Co.")

        content = assemble_content_pdf(cover_bytes=cover_bytes, toc_bytes=toc_bytes, sections=sections)
        assert page_count(content) == 1 + toc_pages + 1

        labels = build_page_labels(has_cover=True, toc_page_count=toc_pages, main_content_page_count=1)
        assert labels[0] is None
        overlay = render_page_number_overlay(labels)
        numbered = apply_page_number_overlay(content, overlay)

        cover_text = PdfReader(BytesIO(numbered)).pages[0].extract_text()
        # The cover's own title text is expected; no bottom-center page
        # number digit/roman numeral should have been drawn on it.
        assert "My Proposal" in cover_text
    finally:
        os.remove(doc_path)


def test_toc_roman_numerals_precede_arabic_content():
    doc_path = _write_temp_pdf(_make_pdf(1, "Doc"))
    try:
        sections = [Section("Doc", doc_path, 1)]
        toc_bytes = render_toc_pdf(build_toc_entries(sections))
        toc_pages = page_count(toc_bytes)
        content = assemble_content_pdf(cover_bytes=None, toc_bytes=toc_bytes, sections=sections)
        labels = build_page_labels(has_cover=False, toc_page_count=toc_pages, main_content_page_count=1)
        overlay = render_page_number_overlay(labels)
        numbered = apply_page_number_overlay(content, overlay)
        reader = PdfReader(BytesIO(numbered))
        assert "i" in reader.pages[0].extract_text()
    finally:
        os.remove(doc_path)


def test_bookmarks_point_at_the_right_physical_pages():
    tech_path = _write_temp_pdf(_make_pdf(2, "Technical"))
    profile_path = _write_temp_pdf(_make_pdf(3, "Profile"))
    try:
        sections = [Section("Technical Proposal", tech_path, 2), Section("Company Profile", profile_path, 3)]
        starts = compute_arabic_starts(sections)
        toc_bytes = render_toc_pdf(build_toc_entries(sections))
        toc_pages = page_count(toc_bytes)
        content = assemble_content_pdf(cover_bytes=None, toc_bytes=toc_bytes, sections=sections)

        bookmarked = add_bookmarks(content, has_cover=False, toc_page_count=toc_pages, sections=sections, arabic_starts=starts, root_title="Proposal")
        reader = PdfReader(BytesIO(bookmarked))
        outline = reader.outline
        # outline[0] is the root; outline[1] is a nested list of its children.
        assert len(outline) >= 1
    finally:
        for p in (tech_path, profile_path):
            os.remove(p)

"""Renders the Table of Contents as its own standalone PDF from a list of
(label, arabic page number) entries the caller has already computed (see
page_numbering.build_toc_entries) — this module never computes page
numbers itself, only lays them out.

No iterative "regenerate because the TOC's own length changed the
numbers" loop: the Arabic numbers here don't depend on how many physical
pages this TOC ends up taking (see page_numbering.py's docstring) — this
function paginates itself (spilling onto more pages if there are many
entries) and the CALLER discovers the resulting page count afterward
(pypdf.PdfReader(toc_bytes).pages), which is all that's needed to place
Roman-numeral overlays on the right physical pages.
"""
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.page_numbering import TocEntry

_MARGIN = 72  # 1 inch
_LINE_HEIGHT = 22
_TITLE_FONT_SIZE = 16
_ENTRY_FONT_SIZE = 11
_FONT = "Helvetica"


def _draw_row(c: canvas.Canvas, x_left: float, y: float, x_right: float, label: str, page_label: str) -> None:
    c.setFont(_FONT, _ENTRY_FONT_SIZE)
    c.drawString(x_left, y, label)

    num_width = c.stringWidth(page_label, _FONT, _ENTRY_FONT_SIZE)
    c.drawString(x_right - num_width, y, page_label)

    label_width = c.stringWidth(label, _FONT, _ENTRY_FONT_SIZE)
    dot_width = c.stringWidth(".", _FONT, _ENTRY_FONT_SIZE)
    gap_start = x_left + label_width + 6
    gap_end = x_right - num_width - 6
    if dot_width > 0 and gap_end > gap_start:
        n_dots = int((gap_end - gap_start) / dot_width)
        if n_dots > 0:
            c.drawString(gap_start, y, "." * n_dots)


def render_toc_pdf(entries: list[TocEntry], title: str = "TABLE OF CONTENTS") -> bytes:
    buf = BytesIO()
    width, height = A4
    x_left, x_right = _MARGIN, width - _MARGIN
    c = canvas.Canvas(buf, pagesize=A4)

    if not entries:
        # Still produce a well-formed one-page TOC rather than an empty
        # PDF — "no documents selected" is already rejected earlier in the
        # pipeline, but an empty TOC page is a safer failure mode than a
        # zero-page PDF if that ever changes.
        c.setFont("Helvetica-Bold", _TITLE_FONT_SIZE)
        c.drawCentredString(width / 2, height - _MARGIN, title)
        c.showPage()
        c.save()
        return buf.getvalue()

    idx = 0
    first_page = True
    while idx < len(entries):
        y = height - _MARGIN
        if first_page:
            c.setFont("Helvetica-Bold", _TITLE_FONT_SIZE)
            c.drawCentredString(width / 2, y, title)
            y -= 40
            first_page = False
        while idx < len(entries) and y > _MARGIN:
            entry = entries[idx]
            _draw_row(c, x_left, y, x_right, entry.label, str(entry.page_number))
            y -= _LINE_HEIGHT
            idx += 1
        c.showPage()

    c.save()
    return buf.getvalue()

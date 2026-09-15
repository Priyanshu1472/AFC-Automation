"""The three numbering concepts, kept deliberately separate (see the task
spec's section 16):

  - physical page index   — position in the assembled PDF (0-indexed here).
  - TOC page number        — Roman numeral, one per physical TOC page.
  - displayed page number  — what's printed on the page (None on the cover,
    Roman on the TOC, Arabic on everything else).

Arabic numbers are computed purely from each section's own page count —
they do NOT depend on how many physical pages the TOC itself takes up
(see toc_generator.py's docstring for why that's deliberate: it avoids the
"regenerate the TOC because its own length changed something" loop the
spec describes, because in this design it never does — only the point
where the physical page stream switches from Roman to Arabic depends on
the TOC's length, and that's resolved after the TOC is rendered).
"""
from dataclasses import dataclass
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

_ROMAN_TABLE = [
    (1000, "m"), (900, "cm"), (500, "d"), (400, "cd"),
    (100, "c"), (90, "xc"), (50, "l"), (40, "xl"),
    (10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i"),
]


def to_roman(n: int) -> str:
    if n <= 0:
        raise ValueError("Roman numerals are only defined for positive integers.")
    result = []
    for value, symbol in _ROMAN_TABLE:
        count, n = divmod(n, value)
        result.append(symbol * count)
    return "".join(result)


@dataclass(frozen=True)
class Section:
    label: str
    path: str  # local temp filesystem path to this section's own PDF
    page_count: int


def compute_arabic_starts(sections: list[Section]) -> list[int]:
    """The 1-indexed Arabic page number each section's first page displays
    — sections[0] always starts at 1, regardless of how many sections
    there are or how long the cover/TOC turn out to be.
    """
    starts = []
    running = 1
    for section in sections:
        starts.append(running)
        running += section.page_count
    return starts


def total_main_content_pages(sections: list[Section]) -> int:
    return sum(s.page_count for s in sections)


@dataclass(frozen=True)
class TocEntry:
    label: str
    page_number: int  # the Arabic number to print next to it in the TOC


def build_toc_entries(sections: list[Section]) -> list[TocEntry]:
    starts = compute_arabic_starts(sections)
    return [TocEntry(section.label, start) for section, start in zip(sections, starts)]


def build_page_labels(has_cover: bool, toc_page_count: int, main_content_page_count: int) -> list[str | None]:
    """One entry per physical page of the FINAL assembled PDF, in order —
    None means "no visible number" (the cover only).
    """
    if toc_page_count < 0 or main_content_page_count < 0:
        raise ValueError("Page counts must be non-negative.")
    labels: list[str | None] = []
    if has_cover:
        labels.append(None)
    labels.extend(to_roman(i + 1) for i in range(toc_page_count))
    labels.extend(str(i + 1) for i in range(main_content_page_count))
    return labels


def render_page_number_overlay(labels: list[str | None], page_size=A4) -> bytes:
    """One transparent page per label (blank where the label is None, i.e.
    the cover) — pdf_assembler merges each onto the matching physical page
    of the assembled PDF. Bottom-center placement, a reasonable margin
    above the page edge (professional proposal convention; nothing in
    this codebase's existing PDFs — leadApprovalPdf.ts, feeNotePdf.ts —
    establishes a different one to match).
    """
    buf = BytesIO()
    width, _ = page_size
    c = canvas.Canvas(buf, pagesize=page_size)
    bottom_margin = 36  # 0.5"

    for label in labels:
        if label is not None:
            c.setFont("Helvetica", 10)
            c.drawCentredString(width / 2, bottom_margin, label)
        c.showPage()

    c.save()
    return buf.getvalue()

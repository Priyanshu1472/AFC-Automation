"""Optional cover page — there is no existing proposal cover anywhere in
this codebase (checked: no cover field/table/PDF anywhere in the Proposal
Preparation schema or its documents), so this is a small ReportLab-drawn
placeholder (title, client, date), never mandatory. Pass cover=False to
proposal_generator to skip it entirely — the architecture doesn't assume
one exists (task spec section 21).
"""
from datetime import datetime
from io import BytesIO

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas


def render_cover_pdf(title: str, client_name: str | None) -> bytes:
    buf = BytesIO()
    width, height = A4
    c = canvas.Canvas(buf, pagesize=A4)

    c.setFont("Helvetica-Bold", 22)
    c.drawCentredString(width / 2, height * 0.55, title or "Proposal")

    if client_name:
        c.setFont("Helvetica", 14)
        c.drawCentredString(width / 2, height * 0.55 - 32, client_name)

    c.setFont("Helvetica", 10)
    c.drawCentredString(width / 2, height * 0.12, datetime.now().strftime("%d %B %Y"))

    c.showPage()
    c.save()
    return buf.getvalue()

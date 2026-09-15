FROM python:3.12-slim

# LibreOffice headless (writer covers .doc/.docx, calc covers .xls/.xlsx,
# draw owns the PDF-import filter that convert_pdf_to_docx needs — without
# it, converting a PDF to .docx fails with "source file could not be
# loaded" even though writer/calc alone convert office docs to PDF just
# fine) plus a JRE (some LibreOffice filters — including PDF import —
# warn/fail without one: "failed to launch javaldx") and a broader font
# set so a converted document doesn't silently substitute a
# visually-different font for whatever the source used.
RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-draw \
    default-jre-headless \
    fonts-liberation \
    fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# This process only makes outbound calls to Supabase (polling — no
# public endpoint at all), so it runs as a non-root user with no
# exposed port.
RUN useradd --create-home --shell /usr/sbin/nologin worker
USER worker

CMD ["python", "-m", "app.worker"]

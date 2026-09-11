// src/utils/knowledgeDocumentEmbed.js
// Extends ProjectDetailsPage's DOC/PDF export to also embed the project's
// uploaded documents (project_documents + the "project-documents" storage
// bucket — see KnowledgeFormParts.jsx's DocumentUpload/openProjectDocument,
// whose exact bucket/path convention this reuses directly via
// supabase.storage.from(BUCKET).download(), the same client-side read
// pattern already used elsewhere for this bucket, e.g. AfcChecklistPanel's
// Knowledge Repository picker). No new storage mechanism, no new table.
//
// By-file-type strategy mirrors the Proposal module's merge feature
// (src/utils/proposalMergeBuilder.js) for the DOCX side — image embeds
// directly, a PDF's pages render to images (pdf.js) and drop into the
// Word doc, a .docx converts via mammoth.js into real styled paragraphs,
// anything else gets a clearly-labelled placeholder (never silently
// dropped). The PDF side is new: pdf-lib actually merges an uploaded PDF's
// real vector pages (not a rasterized copy), embeds images directly, and
// rasterizes HTML (the project info table, and a converted .docx) via
// html2canvas into paginated image pages. All three libraries (docx,
// pdfjs-dist, mammoth) are already loaded this same CDN-dynamic-import way
// elsewhere in this codebase — pdf-lib/html2canvas follow the identical
// pattern rather than becoming new package.json dependencies.

const IMAGE_EXT_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const PDFJS_VERSION = "4.6.82";
const MAMMOTH_VERSION = "1.12.2";
const HTML2CANVAS_VERSION = "1.4.1";
const PDFLIB_VERSION = "1.17.1";
const BUCKET = "project-documents";
const MAX_DOCX_IMAGE_WIDTH_PX = 750; // matches proposalMergeBuilder's own embed width

function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(fileName || "");
  return m ? m[1].toLowerCase() : "";
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// Reuses the exact bucket DocumentUpload/openProjectDocument already
// established (KnowledgeFormParts.jsx) — RLS already grants any
// non-Business-Associate authenticated role SELECT on it, so a direct
// client-side download needs no edge function. Missing/corrupted objects
// surface as a thrown Error, caught per-document by the callers below so
// one bad file never aborts the whole export.
async function fetchProjectDocumentBytes(doc, supabase) {
  const { data, error } = await supabase.storage.from(BUCKET).download(doc.storage_path);
  if (error || !data) throw new Error(`"${doc.file_name}" could not be retrieved from storage.`);
  return new Uint8Array(await data.arrayBuffer());
}

// ════════════════════════════════════════════════════════════════
//  DOCX embedding — appended to the existing project-info table's
//  children, in the already-open docx.js Document.
// ════════════════════════════════════════════════════════════════

function headingParagraphDocx(text, docx, pageBreakBefore) {
  const { Paragraph, TextRun, HeadingLevel } = docx;
  return new Paragraph({ heading: HeadingLevel.HEADING2, pageBreakBefore, children: [new TextRun(text)] });
}

async function imageParagraphDocx(rawBytes, rawExt, docx) {
  const { Paragraph, ImageRun } = docx;
  // Word itself doesn't reliably support WebP — re-encode as PNG first
  // (same conversion used on the PDF side, see toPngIfNeeded below).
  const { bytes, ext } = await toPngIfNeeded(rawBytes, rawExt);
  const bitmap = await createImageBitmap(new Blob([bytes], { type: IMAGE_EXT_MIME[ext] || "image/png" }));
  const scale = Math.min(1, MAX_DOCX_IMAGE_WIDTH_PX / bitmap.width);
  return new Paragraph({
    children: [new ImageRun({ data: bytes, transformation: { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) } })],
  });
}

// Every PDF page becomes its own Word page (own heading + pageBreakBefore)
// so flipping through the export reads like flipping through the source
// PDF — pdf.js renders each page to an image (its own Word-embeddable
// form has no lighter-weight option for arbitrary PDFs client-side).
async function pdfPageParagraphsDocx(bytes, docx, label, pageBreakBeforeFirst, onPageProgress) {
  const { Paragraph, TextRun, ImageRun } = docx;
  const pdfjsLib = await import(/* @vite-ignore */ `https://esm.sh/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`);
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://esm.sh/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.min.mjs`;

  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;
  const paragraphs = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    onPageProgress?.(i, pdf.numPages);
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await withTimeout(
      page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise,
      30000,
      `Timed out rendering page ${i} of ${pdf.numPages}.`
    );
    const pageBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const pageBytes = new Uint8Array(await pageBlob.arrayBuffer());
    const scale = Math.min(1, MAX_DOCX_IMAGE_WIDTH_PX / viewport.width);

    const headingText = pdf.numPages > 1 ? `${label} — Page ${i} of ${pdf.numPages}` : label;
    paragraphs.push(headingParagraphDocx(headingText, docx, i > 1 || pageBreakBeforeFirst));
    paragraphs.push(new Paragraph({
      children: [new ImageRun({ data: pageBytes, transformation: { width: Math.round(viewport.width * scale), height: Math.round(viewport.height * scale) } })],
    }));
  }
  return paragraphs;
}

const HEADING_TAGS = { h1: "HEADING1", h2: "HEADING2", h3: "HEADING3", h4: "HEADING4", h5: "HEADING5", h6: "HEADING6" };

function runsFromNode(node, TextRun, style = {}) {
  const runs = [];
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      if (child.textContent) runs.push(new TextRun({ text: child.textContent, bold: style.bold, italics: style.italic, underline: style.underline ? {} : undefined }));
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const tag = child.tagName.toLowerCase();
      if (tag === "br") { runs.push(new TextRun({ text: "", break: 1 })); return; }
      const childStyle = { ...style };
      if (tag === "strong" || tag === "b") childStyle.bold = true;
      if (tag === "em" || tag === "i") childStyle.italic = true;
      if (tag === "u") childStyle.underline = true;
      runs.push(...runsFromNode(child, TextRun, childStyle));
    }
  });
  return runs;
}

// Converts a .docx to real docx.js Paragraphs carrying the source's own
// bold/italic/underline/heading formatting, via mammoth.js's HTML output.
// Lists become "• "/"1. "-prefixed paragraphs rather than native Word
// numbering. Legacy .doc (pre-XML binary format) is NOT handled here —
// mammoth only reads .docx — it falls through to the generic placeholder.
async function docxParagraphsFromBytes(bytes, docx) {
  const { Paragraph, TextRun, HeadingLevel } = docx;
  const mammoth = await import(/* @vite-ignore */ `https://esm.sh/mammoth@${MAMMOTH_VERSION}`);
  const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer }, { styleMap: ["u => u"] });
  const body = new DOMParser().parseFromString(result.value, "text/html").body;

  const paragraphs = [];
  body.childNodes.forEach((el) => {
    if (el.nodeType !== Node.ELEMENT_NODE) return;
    const tag = el.tagName.toLowerCase();
    if (HEADING_TAGS[tag]) {
      const runs = runsFromNode(el, TextRun);
      if (runs.length) paragraphs.push(new Paragraph({ heading: HeadingLevel[HEADING_TAGS[tag]], children: runs }));
    } else if (tag === "ul" || tag === "ol") {
      let n = 0;
      el.querySelectorAll(":scope > li").forEach((li) => {
        n++;
        const prefix = tag === "ul" ? "• " : `${n}. `;
        const runs = runsFromNode(li, TextRun);
        if (runs.length) paragraphs.push(new Paragraph({ children: [new TextRun(prefix), ...runs] }));
      });
    } else {
      const runs = runsFromNode(el, TextRun);
      if (runs.length) paragraphs.push(new Paragraph({ children: runs }));
    }
  });

  if (paragraphs.length === 0) return [new Paragraph({ children: [new TextRun("(This document appears to be empty.)")] })];
  return paragraphs;
}

/**
 * Returns the extra docx.js Paragraph nodes to append after the project's
 * existing info table — [] if the project has no uploaded documents, so
 * the DOCX comes out byte-for-byte the same shape as before this feature.
 * `docx` is the already-dynamically-imported class bag (same object
 * ProjectDetailsPage.jsx already builds for buildProjectRows), extended
 * here to also need ImageRun/HeadingLevel from that same import.
 */
export async function buildKnowledgeDocumentsDocxChildren(documents, docx, supabase, onProgress, { standalone = false } = {}) {
  const { Paragraph, TextRun, HeadingLevel } = docx;
  if (!documents || documents.length === 0) return [];

  // pageBreakBefore is right when this is appended after a project-info
  // table (the "Both" export) but would just leave a blank leading page
  // when documents are the ONLY content in the file (the standalone
  // "Supportings" export).
  const children = [
    new Paragraph({ heading: HeadingLevel.HEADING1, pageBreakBefore: !standalone, children: [new TextRun("Uploaded Documents")] }),
  ];

  for (let idx = 0; idx < documents.length; idx++) {
    const doc = documents[idx];
    onProgress?.(idx + 1, documents.length, doc.file_name);
    const label = `${doc.name} — ${doc.file_name}`;
    const ext = extOf(doc.file_name);
    try {
      const bytes = await fetchProjectDocumentBytes(doc, supabase);
      if (IMAGE_EXT_MIME[ext]) {
        children.push(headingParagraphDocx(label, docx, idx > 0));
        children.push(await imageParagraphDocx(bytes, ext, docx));
      } else if (ext === "pdf") {
        children.push(...await pdfPageParagraphsDocx(
          bytes, docx, label, idx > 0,
          (page, total) => onProgress?.(idx + 1, documents.length, `${doc.file_name} (page ${page}/${total})`)
        ));
      } else if (ext === "docx") {
        children.push(headingParagraphDocx(label, docx, idx > 0));
        children.push(...await docxParagraphsFromBytes(bytes, docx));
      } else {
        children.push(headingParagraphDocx(label, docx, idx > 0));
        children.push(new Paragraph({
          children: [new TextRun(`This file type (.${ext || "unknown"}) could not be automatically embedded here. The original file remains available in the Knowledge Repository.`)],
        }));
      }
    } catch (err) {
      children.push(headingParagraphDocx(label, docx, idx > 0));
      children.push(new Paragraph({ children: [new TextRun(`Could not include "${doc.file_name}": ${err.message}`)] }));
    }
  }
  return children;
}

// ════════════════════════════════════════════════════════════════
//  PDF embedding — a real generated PDF (pdf-lib), not the browser's
//  print-to-PDF ProjectDetailsPage used before. Needed specifically so an
//  uploaded PDF's actual pages can be merged in at full fidelity, which
//  window.print() has no way to do.
// ════════════════════════════════════════════════════════════════

const PDF_PAGE = { width: 595.28, height: 841.89 }; // A4, points (72pt/in)
const PDF_MARGIN = 36; // 0.5in
const PDF_CONTENT_W = PDF_PAGE.width - PDF_MARGIN * 2;
const PDF_CONTENT_H = PDF_PAGE.height - PDF_MARGIN * 2;
const HTML_RASTER_WIDTH_PX = 760;

async function loadPdfLib() {
  return await import(/* @vite-ignore */ `https://esm.sh/pdf-lib@${PDFLIB_VERSION}`);
}

async function loadHtml2Canvas() {
  const mod = await import(/* @vite-ignore */ `https://esm.sh/html2canvas@${HTML2CANVAS_VERSION}`);
  return mod.default || mod;
}

// pdf-lib's StandardFonts only encode WinAnsi (~Latin-1) — a user-typed
// filename with e.g. Devanagari or CJK characters would otherwise throw
// and abort the whole export. Replacing anything outside that range keeps
// the label legible for the overwhelming majority of real filenames
// without ever crashing the build.
function safeWinAnsi(text) {
  return String(text ?? "").replace(/[^\x00-\xFF]/g, "?");
}

// Renders arbitrary HTML off-screen (fixed pixel width, matching the
// Times New Roman / bordered-table styling the app's own print preview
// already uses) and rasterizes it — this is how both the project-info
// section and a converted .docx attachment become real PDF pages.
async function rasterizeHtml(html, widthPx) {
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed", left: "-10000px", top: "0", width: `${widthPx}px`,
    background: "#ffffff", color: "#000000",
    fontFamily: '"Times New Roman", Times, serif', fontSize: "13px",
  });
  container.innerHTML = `<style>
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #000; padding: 5px 7px; vertical-align: top; }
    th { font-weight: bold; background: #f0f0f0; }
    p { margin: 0 0 5px 0; }
    ul, ol { margin: 3px 0 0 16px; padding: 0; }
    img { max-width: 100%; }
  </style>${html}`;
  document.body.appendChild(container);
  try {
    const html2canvas = await loadHtml2Canvas();
    return await html2canvas(container, { backgroundColor: "#ffffff", scale: 2, windowWidth: widthPx });
  } finally {
    container.remove();
  }
}

// Slices a (possibly page-spanning-tall) canvas into successive full PDF
// pages sized to the content area, embedding each slice as a PNG page.
async function addCanvasAsPages(pdfDoc, canvas) {
  const { width: srcW, height: srcH } = canvas;
  const scale = PDF_CONTENT_W / srcW; // pt per source px
  const pageSlicePx = Math.max(1, Math.floor(PDF_CONTENT_H / scale));
  const totalPages = Math.max(1, Math.ceil(srcH / pageSlicePx));

  for (let p = 0; p < totalPages; p++) {
    const sy = p * pageSlicePx;
    const sh = Math.min(pageSlicePx, srcH - sy);
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = srcW;
    sliceCanvas.height = sh;
    sliceCanvas.getContext("2d").drawImage(canvas, 0, sy, srcW, sh, 0, 0, srcW, sh);
    const blob = await new Promise((resolve) => sliceCanvas.toBlob(resolve, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const png = await pdfDoc.embedPng(bytes);
    const page = pdfDoc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
    const drawH = sh * scale;
    page.drawImage(png, { x: PDF_MARGIN, y: PDF_PAGE.height - PDF_MARGIN - drawH, width: PDF_CONTENT_W, height: drawH });
  }
}

// A plain divider page between the project info and each attachment (and,
// for a file that couldn't be embedded, the ONLY page for it) — makes
// clear in the merged PDF itself which document follows, since a directly
// copied PDF's own pages can't be annotated after the fact.
function addDividerPage(pdfDoc, fonts, title, subtitle, { align = "left" } = {}) {
  const page = pdfDoc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
  try {
    const titleText = safeWinAnsi(title);
    const titleSize = 16;
    const titleX = align === "center" ? (PDF_PAGE.width - fonts.bold.widthOfTextAtSize(titleText, titleSize)) / 2 : PDF_MARGIN;
    page.drawText(titleText, { x: titleX, y: PDF_PAGE.height / 2 + 24, size: titleSize, font: fonts.bold });
    if (subtitle) {
      const subSize = 11;
      const words = safeWinAnsi(subtitle).match(/.{1,90}(\s|$)/g) || [subtitle];
      words.forEach((line, i) => {
        const text = line.trim();
        const x = align === "center" ? (PDF_PAGE.width - fonts.regular.widthOfTextAtSize(text, subSize)) / 2 : PDF_MARGIN;
        page.drawText(text, { x, y: PDF_PAGE.height / 2 - (i * 16), size: subSize, font: fonts.regular });
      });
    }
  } catch (err) {
    console.error("Divider page text failed:", err);
  }
}

// The lead cover page for a documents-only export (e.g. "Download
// Supportings") — the project name is the prominent line, with the
// section label underneath it in a smaller size, both centered.
function addCoverPage(pdfDoc, fonts, heading, subheading) {
  const page = pdfDoc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
  try {
    const headingSize = 22;
    const subSize = 15;
    let y = PDF_PAGE.height / 2 + 24;
    if (heading) {
      const headingText = safeWinAnsi(heading);
      const x = (PDF_PAGE.width - fonts.bold.widthOfTextAtSize(headingText, headingSize)) / 2;
      page.drawText(headingText, { x, y, size: headingSize, font: fonts.bold });
      y -= headingSize + 14;
    }
    const subText = safeWinAnsi(subheading);
    const subX = (PDF_PAGE.width - fonts.bold.widthOfTextAtSize(subText, subSize)) / 2;
    page.drawText(subText, { x: subX, y, size: subSize, font: fonts.bold });
  } catch (err) {
    console.error("Cover page text failed:", err);
  }
}

// pdf-lib can only embed PNG/JPEG — a .webp upload (an explicitly allowed
// type on this bucket) needs converting first. The browser can always
// decode webp natively, so this re-encodes it as PNG via canvas rather
// than treating it as unsupported.
async function toPngIfNeeded(bytes, ext) {
  if (ext !== "webp") return { bytes, ext };
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/webp" }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), ext: "png" };
}

async function embedImagePage(pdfDoc, rawBytes, rawExt) {
  const { bytes, ext } = await toPngIfNeeded(rawBytes, rawExt);
  const img = ext === "png" ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  const scale = Math.min(1, PDF_CONTENT_W / img.width, PDF_CONTENT_H / img.height);
  const w = img.width * scale, h = img.height * scale;
  const page = pdfDoc.addPage([PDF_PAGE.width, PDF_PAGE.height]);
  page.drawImage(img, { x: PDF_MARGIN + (PDF_CONTENT_W - w) / 2, y: PDF_MARGIN + (PDF_CONTENT_H - h) / 2, width: w, height: h });
}

// The actual "merge", not a rasterized copy — copies the uploaded PDF's
// own real pages (full text/vector fidelity) straight into the export.
async function mergePdfPages(pdfDoc, PDFLib, bytes) {
  const src = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const copied = await pdfDoc.copyPages(src, src.getPageIndices());
  copied.forEach((pg) => pdfDoc.addPage(pg));
}

/**
 * Builds the full downloadable PDF: the existing project-info HTML
 * (unchanged content/appearance, just rasterized instead of printed),
 * followed by every uploaded document — PDFs merged in at full fidelity,
 * images embedded directly, .docx rendered then paginated, anything else
 * called out on its own divider page rather than silently skipped.
 * Returns a Blob ready for download. `documents` may be [] — the export
 * then contains only the project-info pages, unchanged from before.
 */
// Appends ONE project's info pages + its own uploaded documents into an
// already-open pdf-lib document — the shared body both
// buildKnowledgeProjectPdf (one project) and buildKnowledgeShortlistPdf
// (several, back to back) call, so a shortlist export can't drift from
// what a single project's own download produces.
// The actual per-document attachment loop — shared by appendProjectToPdf
// (the "Both" export, called after the info pages) and
// buildKnowledgeSupportingsPdf (documents only, no project info section).
async function appendDocumentsToPdf(pdfDoc, PDFLib, fonts, documents, supabase, onProgress) {
  for (let idx = 0; idx < documents.length; idx++) {
    const doc = documents[idx];
    onProgress?.(idx, documents.length, doc.file_name);
    const ext = extOf(doc.file_name);
    try {
      const bytes = await fetchProjectDocumentBytes(doc, supabase);
      if (ext === "pdf") {
        addDividerPage(pdfDoc, fonts, doc.name, null, { align: "center" });
        await mergePdfPages(pdfDoc, PDFLib, bytes);
      } else if (IMAGE_EXT_MIME[ext]) {
        addDividerPage(pdfDoc, fonts, doc.name, null, { align: "center" });
        await embedImagePage(pdfDoc, bytes, ext === "jpeg" ? "jpg" : ext);
      } else if (ext === "docx") {
        addDividerPage(pdfDoc, fonts, doc.name, null, { align: "center" });
        const mammoth = await import(/* @vite-ignore */ `https://esm.sh/mammoth@${MAMMOTH_VERSION}`);
        const result = await mammoth.convertToHtml({ arrayBuffer: bytes.buffer });
        const canvas = await rasterizeHtml(result.value || "<p>(This document appears to be empty.)</p>", HTML_RASTER_WIDTH_PX);
        await addCanvasAsPages(pdfDoc, canvas);
      } else {
        addDividerPage(pdfDoc, fonts, doc.name, `This file type (.${ext || "unknown"}) could not be automatically embedded. The original remains available in the Knowledge Repository.`, { align: "center" });
      }
    } catch (err) {
      addDividerPage(pdfDoc, fonts, doc.name, `This document could not be included: ${err.message}`, { align: "center" });
    }
  }
}

async function appendProjectToPdf(pdfDoc, PDFLib, fonts, { projectInfoHtml, documents, supabase, onProgress }) {
  const total = (documents?.length || 0) + 1;
  onProgress?.(1, total, "Project information");
  await appendProjectProfilePage(pdfDoc, fonts, null, projectInfoHtml);

  if (documents && documents.length > 0) {
    await appendDocumentsToPdf(pdfDoc, PDFLib, fonts, documents, supabase, (i, t, name) => onProgress?.(i + 2, total, name));
  }
}

// One project's info page(s), labelled with its own centered title page
// when part of a multi-project run (label is null for the single-project
// download, which needs no extra label of its own).
async function appendProjectProfilePage(pdfDoc, fonts, label, projectInfoHtml) {
  if (label) addDividerPage(pdfDoc, fonts, label, null, { align: "center" });
  const canvas = await rasterizeHtml(projectInfoHtml, HTML_RASTER_WIDTH_PX);
  await addCanvasAsPages(pdfDoc, canvas);
}

// One project's uploaded documents, under its own project-name cover page —
// the shortlist analogue of buildKnowledgeSupportingsPdf's single cover.
async function appendProjectSupportingDocuments(pdfDoc, PDFLib, fonts, label, documents, supabase, onProgress) {
  addCoverPage(pdfDoc, fonts, label, "Supporting Documents");
  await appendDocumentsToPdf(pdfDoc, PDFLib, fonts, documents, supabase, onProgress);
}

async function newPdfDocWithFonts() {
  const PDFLib = await loadPdfLib();
  const { PDFDocument, StandardFonts } = PDFLib;
  const pdfDoc = await PDFDocument.create();
  const fonts = {
    regular: await pdfDoc.embedFont(StandardFonts.TimesRoman),
    bold: await pdfDoc.embedFont(StandardFonts.TimesRomanBold),
  };
  return { PDFLib, pdfDoc, fonts };
}

export async function buildKnowledgeProjectPdf({ projectInfoHtml, documents, supabase, onProgress }) {
  const { PDFLib, pdfDoc, fonts } = await newPdfDocWithFonts();
  await appendProjectToPdf(pdfDoc, PDFLib, fonts, { projectInfoHtml, documents, supabase, onProgress });
  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

/**
 * The uploaded documents only — no project-info pages — for the
 * "Download Supportings" action. `documents` must be non-empty (the
 * caller disables that option when there's nothing to include).
 */
export async function buildKnowledgeSupportingsPdf({ documents, title, supabase, onProgress }) {
  const { PDFLib, pdfDoc, fonts } = await newPdfDocWithFonts();
  addCoverPage(pdfDoc, fonts, title, "Supporting Documents");
  await appendDocumentsToPdf(pdfDoc, PDFLib, fonts, documents, supabase, onProgress);
  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

/**
 * Shortlist "Download Profile" — every project's info page(s) only, no
 * documents, each under its own centered project-name title page.
 * `items`: [{ label, projectInfoHtml }].
 */
export async function buildKnowledgeShortlistProfilesPdf({ items, onProgress }) {
  const { pdfDoc, fonts } = await newPdfDocWithFonts();
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i + 1, items.length, item.label);
    await appendProjectProfilePage(pdfDoc, fonts, item.label, item.projectInfoHtml);
  }
  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

/**
 * Shortlist "Download Supportings" — every project's uploaded documents
 * only, each grouped under its own project-name cover page. Projects with
 * no documents are skipped. `items`: [{ label, documents }].
 */
export async function buildKnowledgeShortlistSupportingsPdf({ items, supabase, onProgress }) {
  const { PDFLib, pdfDoc, fonts } = await newPdfDocWithFonts();
  const withDocs = items.filter((it) => it.documents?.length);
  for (let i = 0; i < withDocs.length; i++) {
    const item = withDocs[i];
    await appendProjectSupportingDocuments(
      pdfDoc, PDFLib, fonts, item.label, item.documents, supabase,
      (docIdx, docTotal, name) => onProgress?.(i + 1, withDocs.length, `${item.label}: ${name}`)
    );
  }
  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

/**
 * Shortlist "Download Both" — every project's profile page(s) first, then
 * (after a section break) every project's uploaded documents — not
 * interleaved per project, matching the "Download Profile" then
 * "Download Supportings" order. `items`: [{ label, projectInfoHtml, documents }].
 */
export async function buildKnowledgeShortlistBothPdf({ items, supabase, onProgress }) {
  const { PDFLib, pdfDoc, fonts } = await newPdfDocWithFonts();
  const withDocs = items.filter((it) => it.documents?.length);
  const total = items.length + withDocs.length;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i + 1, total, `${item.label} — profile`);
    await appendProjectProfilePage(pdfDoc, fonts, item.label, item.projectInfoHtml);
  }

  for (let i = 0; i < withDocs.length; i++) {
    const item = withDocs[i];
    await appendProjectSupportingDocuments(
      pdfDoc, PDFLib, fonts, item.label, item.documents, supabase,
      (docIdx, docTotal, name) => onProgress?.(items.length + i + 1, total, `${item.label}: ${name}`)
    );
  }

  const bytes = await pdfDoc.save();
  return new Blob([bytes], { type: "application/pdf" });
}

/** Small shared "save this Blob to disk" trigger — used by every Knowledge
 * Repository export (single project and shortlist, DOC and PDF alike). */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Opens a generated PDF in a new browser tab (the browser's own PDF
 * viewer) instead of forcing a download — saving the file is then left to
 * the user, via that viewer's own download button. Falls back to a direct
 * download if the tab is blocked by a popup blocker, so the export is
 * never silently lost. */
export function openPdfInNewTab(blob, fallbackFilename) {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank");
  if (!win) {
    downloadBlob(blob, fallbackFilename);
    URL.revokeObjectURL(url);
    return;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

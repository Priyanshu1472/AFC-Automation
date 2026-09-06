// src/utils/proposalMergeBuilder.js
// Builds one merged, editable .docx from a set of already-uploaded proposal
// documents. Mirrors docxBuilder.js's dynamic-import convention (`docx`
// isn't an npm dependency in this repo — it's loaded from esm.sh at call
// time, same as ShortlistsPage.jsx / ProjectDetailsPage.jsx already do).
//
// - PDF: each page is rendered to an image and placed on its own Word page
//   (matches how AFC's real proposals are assembled — see the reference
//   file CIL_AFC_NS_Technical Proposal.docx, ~84 embedded scanned-page
//   images), with its own heading so a reader can tell which document and
//   page they're looking at.
// - .docx: converted via mammoth.js to HTML, then walked into real docx.js
//   Paragraph/TextRun nodes carrying the same bold/italic/underline/
//   heading-level formatting (mammoth reads a Word doc's actual paragraph
//   and character styles, so this reflects the source file, not a guess).
//   Lists come through as "• "/"1. "-prefixed paragraphs rather than
//   native Word numbering — visually equivalent, avoids wiring up
//   numbering.xml. Tables/images inside the source .docx are not carried
//   over (mammoth's HTML output drops them by default).
// - image / .xlsx / .doc / .xls: unchanged — images embed directly, the
//   rest get a placeholder paragraph (no viable client-side renderer).

const IMAGE_EXT_MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const PDFJS_VERSION = "4.6.82";
const MAMMOTH_VERSION = "1.12.2";
const MAX_WIDTH_PX = 750; // ~A4 content width (11906 twips) minus 720-twip margins, at 96dpi

function extOf(fileName) {
  const m = /\.([a-z0-9]+)$/i.exec(fileName || "");
  return m ? m[1].toLowerCase() : "";
}

async function fetchDocumentBytes(item, proposalId, supabase) {
  const { data, error } = await supabase.functions.invoke("get-proposal-document-url", {
    body: { path: item.filePath, proposal_id: proposalId },
  });
  if (error || !data?.url) throw new Error(`Failed to fetch "${item.fileName}".`);
  const res = await fetch(data.url);
  if (!res.ok) throw new Error(`Failed to download "${item.fileName}".`);
  return new Uint8Array(await res.arrayBuffer());
}

function headingParagraph(text, Paragraph, TextRun, HeadingLevel, pageBreakBefore) {
  return new Paragraph({ heading: HeadingLevel.HEADING2, pageBreakBefore, children: [new TextRun(text)] });
}

async function imageParagraph(bytes, ext, Paragraph, ImageRun) {
  const bitmap = await createImageBitmap(new Blob([bytes], { type: IMAGE_EXT_MIME[ext] || "image/png" }));
  const scale = Math.min(1, MAX_WIDTH_PX / bitmap.width);
  return new Paragraph({
    children: [new ImageRun({ data: bytes, transformation: { width: Math.round(bitmap.width * scale), height: Math.round(bitmap.height * scale) } })],
  });
}

// pdf.js's canvas render can stall indefinitely on a backgrounded/unfocused
// tab (it leans on rAF-driven progress internally) — race it against a
// generous timeout so one bad page fails loudly instead of hanging the
// whole merge forever. The per-item try/catch in buildMergedProposalDocx
// turns that into a placeholder paragraph, same as any other failure.
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

// Every PDF page becomes its own Word page (own heading + pageBreakBefore),
// not just the document as a whole — so flipping through the merged file
// reads like flipping through the original PDF.
async function pdfPageParagraphs(bytes, Paragraph, TextRun, ImageRun, HeadingLevel, label, isFirstItem, onPageProgress) {
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
      `Timed out rendering page ${i} of ${pdf.numPages}.`,
    );
    const pageBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const pageBytes = new Uint8Array(await pageBlob.arrayBuffer());
    const scale = Math.min(1, MAX_WIDTH_PX / viewport.width);

    const headingText = pdf.numPages > 1 ? `${label} — Page ${i} of ${pdf.numPages}` : label;
    paragraphs.push(headingParagraph(headingText, Paragraph, TextRun, HeadingLevel, i > 1 || isFirstItem === false));
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

// Converts a .docx to real docx.js Paragraphs carrying the source's actual
// bold/italic/underline/heading formatting (via mammoth.js's HTML output,
// which reads the source file's own paragraph/character styles — not
// guessed). Lists become "• "/"1. "-prefixed paragraphs rather than native
// Word numbering (avoids wiring up numbering.xml for a same-effort win).
async function docxParagraphs(bytes, Paragraph, TextRun, HeadingLevel) {
  const mammoth = await import(/* @vite-ignore */ `https://esm.sh/mammoth@${MAMMOTH_VERSION}`);
  // mammoth maps bold/italic to <strong>/<em> by default but drops
  // underline unless told to — this style map (passed as the SECOND
  // argument; mammoth silently ignores it if merged into the first) opts
  // it back in.
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
 * items: [{ label, fileName, filePath }] in the desired final order.
 * onProgress(index, total, label) — optional, called before each item starts.
 */
export async function buildMergedProposalDocx({ items, proposalId, supabase, onProgress }) {
  const { Document, Packer, Paragraph, TextRun, ImageRun, HeadingLevel } = await import(/* @vite-ignore */ "https://esm.sh/docx@8.5.0");

  const children = [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    onProgress?.(idx + 1, items.length, item.label);

    const ext = extOf(item.fileName);
    try {
      const bytes = await fetchDocumentBytes(item, proposalId, supabase);
      if (IMAGE_EXT_MIME[ext]) {
        children.push(headingParagraph(item.label, Paragraph, TextRun, HeadingLevel, idx > 0));
        children.push(await imageParagraph(bytes, ext, Paragraph, ImageRun));
      } else if (ext === "pdf") {
        const pages = await pdfPageParagraphs(
          bytes, Paragraph, TextRun, ImageRun, HeadingLevel, item.label, idx === 0,
          (page, total) => onProgress?.(idx + 1, items.length, `${item.label} (page ${page}/${total})`),
        );
        children.push(...pages);
      } else if (ext === "docx") {
        children.push(headingParagraph(item.label, Paragraph, TextRun, HeadingLevel, idx > 0));
        children.push(...await docxParagraphs(bytes, Paragraph, TextRun, HeadingLevel));
      } else {
        children.push(headingParagraph(item.label, Paragraph, TextRun, HeadingLevel, idx > 0));
        children.push(new Paragraph({
          children: [new TextRun(`Original file: ${item.fileName} — this file type could not be automatically converted to pages. Export it as PDF or .docx and re-upload before merging.`)],
        }));
      }
    } catch (err) {
      children.push(headingParagraph(item.label, Paragraph, TextRun, HeadingLevel, idx > 0));
      children.push(new Paragraph({ children: [new TextRun(`Could not include "${item.fileName}": ${err.message}`)] }));
    }
  }

  const doc = new Document({
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } },
      children,
    }],
  });

  return await Packer.toBlob(doc);
}

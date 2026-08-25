// supabase/functions/_shared/letterPdf.ts
// Shared AFC letterhead PDF engine — header/footer/pagination — used by
// every letter-generating function (send-provisional-letter, and the final
// Empanelment Letter attached on MD accept in advance-empanelment-stage).
// Only the body content (clauses, terms) differs per letter; this file is
// purely the letterhead + text-layout machinery, ported from the previous
// AFC empanelment app's send-provisional-mail / send-welcome-mail functions.

import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function formatDateDDMMYYYY(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

export function formatDateLong(date: Date): string {
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export const GREEN = rgb(0.047, 0.376, 0.165);
export const BLACK = rgb(0.05, 0.05, 0.05);

export interface Segment { text: string; bold: boolean; }
export const plain = (t: string): Segment => ({ text: t, bold: false });
export const bold = (t: string): Segment => ({ text: t, bold: true });

// Embeds an image of either supported raster format, trying PNG first
// (pdf-lib has no format-sniffing embed() — every image on this letterhead
// is either a PNG logo or a PNG/JPEG signature upload).
// deno-lint-ignore no-explicit-any
export async function embedImageAuto(pdf: any, bytes: Uint8Array) {
  try { return await pdf.embedPng(bytes); }
  catch (_) { return await pdf.embedJpg(bytes); }
}

// deno-lint-ignore no-explicit-any
export async function drawHeader(pdf: any, page: any, logoBytes: Uint8Array, fonts: { reg: any; bold: any }, H: number) {
  const logo = await embedImageAuto(pdf, logoBytes);

  const logoDims = logo.scale(1);
  const logoH = 78;
  const logoW = (logoDims.width / logoDims.height) * logoH;

  const afcText = "AFC  INDIA  LIMITED";
  const whollyText = "Wholly Owned by NABARD, Commercial Banks & EXIM Bank";
  const premierText = "Premier Development Institution Committed to Rural Prosperity";
  const whollyW = fonts.reg.widthOfTextAtSize(whollyText, 8);
  const premierW = fonts.bold.widthOfTextAtSize(premierText, 8.5);

  const GAP = 14;
  const TOTAL_W = logoW + GAP + premierW;
  const PAGE_W = 595;
  const BLOCK_X = (PAGE_W - TOTAL_W) / 2;

  const L1Y = H - 24;
  const L2Y = L1Y - 20;
  const L3Y = L2Y - 13;
  const ruleY = L3Y - 4;
  const L4Y = ruleY - 10;

  const textMidY = (L1Y + 14 + L4Y) / 2;
  const LX = BLOCK_X;
  const LY = textMidY - logoH / 2;
  const TX = BLOCK_X + logoW + GAP;

  page.drawImage(logo, { x: LX, y: LY, width: logoW, height: logoH });

  page.drawText(afcText, { x: TX, y: L1Y, size: 20, font: fonts.bold, color: GREEN });
  page.drawText("(A Union Government Company)", { x: TX, y: L2Y, size: 8.5, font: fonts.reg, color: GREEN });
  page.drawText(whollyText, { x: TX, y: L3Y, size: 8, font: fonts.reg, color: GREEN });
  page.drawLine({ start: { x: TX, y: ruleY }, end: { x: TX + whollyW, y: ruleY }, thickness: 0.7, color: GREEN });
  page.drawText(premierText, { x: TX, y: L4Y, size: 8.5, font: fonts.bold, color: GREEN });
}

// deno-lint-ignore no-explicit-any
export function drawFooter(page: any, fonts: { reg: any; bold: any }) {
  const PW = 595;

  page.drawLine({ start: { x: 36, y: 90 }, end: { x: PW - 36, y: 90 }, thickness: 0.9, color: GREEN });

  function lineWidth(items: { text: string; b: boolean }[], size: number): number {
    return items.reduce((acc, { text, b }) => {
      const f = b ? fonts.bold : fonts.reg;
      return acc + f.widthOfTextAtSize(text, size);
    }, 0);
  }

  function drawCenteredMixed(items: { text: string; b: boolean }[], y0: number, size: number) {
    const totalW = lineWidth(items, size);
    let x = (PW - totalW) / 2;
    for (const { text, b } of items) {
      const f = b ? fonts.bold : fonts.reg;
      page.drawText(text, { x, y: y0, size, font: f, color: BLACK });
      x += f.widthOfTextAtSize(text, size);
    }
  }

  function drawCentered(text: string, y0: number, size: number) {
    const w = fonts.reg.widthOfTextAtSize(text, size);
    page.drawText(text, { x: (PW - w) / 2, y: y0, size, font: fonts.reg, color: BLACK });
  }

  drawCenteredMixed([
    { text: "Corporate Office: ", b: true },
    { text: "M-4, Kanchenjunga Building, 18 Barakhamba Road, New Delhi-110001", b: false },
  ], 79, 7.2);

  drawCenteredMixed([
    { text: "Phones: ", b: true },
    { text: "01135452875, 01135453305, 01135455910  ", b: false },
    { text: "E-mail: ", b: true },
    { text: "afc@afcindia.org.in, afcindia.delhi@gmail.com", b: false },
  ], 69, 7);

  drawCenteredMixed([
    { text: "Registered Office: ", b: true },
    { text: "Dhanraj Mahal, C.S.M. Marg, Mumbai - 400 001", b: false },
  ], 59, 7);

  drawCentered("Phone: 91-22-22028924     Web: www.afcindia.org.in", 50, 7);
  drawCentered("CIN: U65990MH1968GOI013983    ISO-9001:2015; ISO-14001:2015 & ISO-27001:2013", 41, 6.5);
  drawCentered("& CMMI level 3 Certified Company", 32, 6.5);
}

export class PageEngine {
  // deno-lint-ignore no-explicit-any
  pdf: any;
  // deno-lint-ignore no-explicit-any
  fonts: { reg: any; bold: any };
  logoBytes: Uint8Array;
  W = 595; H = 842;
  LEFT = 58;
  RIGHT_EDGE = 537;
  CONTENT_TOP = 715;
  FOOTER_SAFE = 100;
  MAX_W: number;
  y = 0;
  LINE_H = 13.5;
  // deno-lint-ignore no-explicit-any
  currentPage: any = null;

  // deno-lint-ignore no-explicit-any
  constructor(pdf: any, fonts: { reg: any; bold: any }, logoBytes: Uint8Array) {
    this.pdf = pdf;
    this.fonts = fonts;
    this.logoBytes = logoBytes;
    this.MAX_W = this.RIGHT_EDGE - this.LEFT;
  }

  async newPage() {
    const page = this.pdf.addPage([this.W, this.H]);
    await drawHeader(this.pdf, page, this.logoBytes, this.fonts, this.H);
    drawFooter(page, this.fonts);
    this.currentPage = page;
    this.y = this.CONTENT_TOP;
  }

  drawTextLine(text: string, size: number, isBold: boolean, color = BLACK) {
    const f = isBold ? this.fonts.bold : this.fonts.reg;
    this.currentPage.drawText(text, { x: this.LEFT, y: this.y, size, font: f, color });
    this.y -= this.LINE_H;
  }

  drawTextRight(text: string, size: number, isBold: boolean) {
    const f = isBold ? this.fonts.bold : this.fonts.reg;
    const w = f.widthOfTextAtSize(text, size);
    this.currentPage.drawText(text, { x: this.RIGHT_EDGE - w, y: this.y, size, font: f, color: BLACK });
  }

  drawTextAt(text: string, x: number, size: number, isBold: boolean) {
    const f = isBold ? this.fonts.bold : this.fonts.reg;
    this.currentPage.drawText(text, { x, y: this.y, size, font: f, color: BLACK });
  }

  drawRule() {
    this.currentPage.drawLine({
      start: { x: this.LEFT, y: this.y },
      end: { x: this.RIGHT_EDGE, y: this.y },
      thickness: 0.5, color: rgb(0.6, 0.6, 0.6),
    });
    this.y -= 6;
  }

  gap(pts: number) { this.y -= pts; }

  drawPara(segments: Segment[], size: number, indent = 0) {
    const xStart = this.LEFT + indent;
    const maxW = this.MAX_W - indent;
    const tokens: { w: string; bold: boolean }[] = [];

    for (const seg of segments) {
      for (const word of seg.text.split(/\s+/).filter(Boolean)) {
        tokens.push({ w: word, bold: seg.bold });
      }
    }

    let lineTokens: typeof tokens = [];
    let lineWidth = 0;

    const flushLine = () => {
      if (!lineTokens.length) return;
      let x = xStart;
      for (let i = 0; i < lineTokens.length; i++) {
        const { w, bold: isBold } = lineTokens[i];
        const f = isBold ? this.fonts.bold : this.fonts.reg;
        this.currentPage.drawText(w, { x, y: this.y, size, font: f, color: BLACK });
        x += f.widthOfTextAtSize(w, size);
        if (i < lineTokens.length - 1) {
          const nf = lineTokens[i + 1].bold ? this.fonts.bold : this.fonts.reg;
          x += nf.widthOfTextAtSize(" ", size);
        }
      }
      this.y -= this.LINE_H;
      lineTokens = [];
      lineWidth = 0;
    };

    for (const token of tokens) {
      const f = token.bold ? this.fonts.bold : this.fonts.reg;
      const spW = f.widthOfTextAtSize(" ", size);
      const wW = f.widthOfTextAtSize(token.w, size);
      const test = lineWidth + (lineTokens.length ? spW : 0) + wW;
      if (test > maxW && lineTokens.length) {
        flushLine();
        lineTokens = [token];
        lineWidth = wW;
      } else {
        lineTokens.push(token);
        lineWidth = lineWidth + (lineTokens.length > 1 ? spW : 0) + wW;
      }
    }
    flushLine();
  }
}

export async function sd(e: PageEngine, fn: () => void) {
  if (e.y < e.FOOTER_SAFE) await e.newPage();
  fn();
}

export async function sdLine(e: PageEngine, text: string, size: number, isBold: boolean) {
  await sd(e, () => e.drawTextLine(text, size, isBold));
}

export async function sdPara(e: PageEngine, segs: Segment[], size: number, indent = 0) {
  if (e.y < e.FOOTER_SAFE) await e.newPage();
  e.drawPara(segs, size, indent);
  if (e.y < e.FOOTER_SAFE) await e.newPage();
}

export async function sdGap(e: PageEngine, pts: number) {
  e.gap(pts);
  if (e.y < e.FOOTER_SAFE) await e.newPage();
}

export async function newPdfDoc() {
  const pdf = await PDFDocument.create();
  const fontReg = await pdf.embedFont(StandardFonts.TimesRoman);
  const fontBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  return { pdf, fonts: { reg: fontReg, bold: fontBold } };
}

// ── Bordered tables ──────────────────────────────────────────────
// Generic table-drawing helpers, added for the Lead Approval Note (a
// heavily tabular form) — not specific to that document, so any future
// letter/note needing a bordered table can reuse these instead of hand-
// drawing rectangles again.

export const RULE_GRAY = rgb(0.45, 0.45, 0.45);
const HEADER_FILL = rgb(0.92, 0.94, 0.92);

// deno-lint-ignore no-explicit-any
function wrapLine(font: any, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
      out.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}

// Splits on explicit newlines first (so callers can pass pre-formatted
// paragraphs/bullet lists), then word-wraps each line independently.
// deno-lint-ignore no-explicit-any
export function wrapMultiline(font: any, text: string | null | undefined, size: number, maxWidth: number): string[] {
  const paragraphs = String(text ?? "").split("\n");
  const lines: string[] = [];
  for (const p of paragraphs) {
    if (!p) { lines.push(""); continue; }
    lines.push(...wrapLine(font, p, size, maxWidth));
  }
  return lines.length ? lines : [""];
}

export interface KeyValueRow { label: string; value: string; }

// A bordered two-column table: bold label cell | wrapped value cell, one
// row per entry, row height auto-sized to whichever column wraps taller.
// Paginates automatically (a row is never split across pages).
export async function drawKeyValueTable(
  e: PageEngine,
  rows: KeyValueRow[],
  opts: { labelWidth?: number; fontSize?: number; lineH?: number; padX?: number; padY?: number } = {}
) {
  const fontSize = opts.fontSize ?? 9;
  const lineH = opts.lineH ?? 12;
  const padX = opts.padX ?? 6;
  const padY = opts.padY ?? 5;
  const labelWidth = opts.labelWidth ?? 150;
  const valueWidth = e.MAX_W - labelWidth;

  for (const row of rows) {
    const labelLines = wrapMultiline(e.fonts.bold, row.label, fontSize, labelWidth - 2 * padX);
    const valueLines = wrapMultiline(e.fonts.reg, row.value || "—", fontSize, valueWidth - 2 * padX);
    const nLines = Math.max(labelLines.length, valueLines.length);
    const rowH = nLines * lineH + 2 * padY;

    if (e.y - rowH < e.FOOTER_SAFE) await e.newPage();

    const topY = e.y;
    const x0 = e.LEFT;
    const xMid = e.LEFT + labelWidth;
    const x1 = e.RIGHT_EDGE;
    const bottomY = topY - rowH;

    e.currentPage.drawRectangle({ x: x0, y: bottomY, width: x1 - x0, height: rowH, borderColor: RULE_GRAY, borderWidth: 0.6 });
    e.currentPage.drawLine({ start: { x: xMid, y: topY }, end: { x: xMid, y: bottomY }, thickness: 0.6, color: RULE_GRAY });

    let ly = topY - padY - fontSize * 0.8;
    for (const l of labelLines) {
      e.currentPage.drawText(l, { x: x0 + padX, y: ly, size: fontSize, font: e.fonts.bold, color: BLACK });
      ly -= lineH;
    }
    let vy = topY - padY - fontSize * 0.8;
    for (const l of valueLines) {
      e.currentPage.drawText(l, { x: xMid + padX, y: vy, size: fontSize, font: e.fonts.reg, color: BLACK });
      vy -= lineH;
    }

    e.y = bottomY;
  }
}

export interface GridColumn { header: string; width: number; }

// A bordered multi-column grid table with a shaded header row, redrawn on
// every new page a row overflows onto (like a real spreadsheet-style
// table). `columns[].width` are proportional weights, scaled to fill the
// page's content width.
export async function drawGridTable(
  e: PageEngine,
  columns: GridColumn[],
  rows: string[][],
  opts: { fontSize?: number; lineH?: number; padX?: number; padY?: number } = {}
) {
  const fontSize = opts.fontSize ?? 8.5;
  const lineH = opts.lineH ?? 11;
  const padX = opts.padX ?? 5;
  const padY = opts.padY ?? 4;
  const totalW = columns.reduce((s, c) => s + c.width, 0);
  const scale = e.MAX_W / totalW;
  const widths = columns.map((c) => c.width * scale);

  function drawRow(cells: string[], bold: boolean, fill: boolean) {
    const cellLines = cells.map((text, i) => wrapMultiline(bold ? e.fonts.bold : e.fonts.reg, text, fontSize, widths[i] - 2 * padX));
    const nLines = Math.max(...cellLines.map((l) => l.length));
    const rowH = nLines * lineH + 2 * padY;
    const topY = e.y;
    let x = e.LEFT;
    for (let i = 0; i < cells.length; i++) {
      e.currentPage.drawRectangle({
        x, y: topY - rowH, width: widths[i], height: rowH,
        borderColor: RULE_GRAY, borderWidth: 0.6,
        ...(fill ? { color: HEADER_FILL } : {}),
      });
      let ty = topY - padY - fontSize * 0.8;
      for (const l of cellLines[i]) {
        e.currentPage.drawText(l, { x: x + padX, y: ty, size: fontSize, font: bold ? e.fonts.bold : e.fonts.reg, color: BLACK });
        ty -= lineH;
      }
      x += widths[i];
    }
    e.y = topY - rowH;
  }

  function headerHeight(): number {
    const cellLines = columns.map((c, i) => wrapMultiline(e.fonts.bold, c.header, fontSize, widths[i] - 2 * padX));
    return Math.max(...cellLines.map((l) => l.length)) * lineH + 2 * padY;
  }

  if (e.y - headerHeight() < e.FOOTER_SAFE) await e.newPage();
  drawRow(columns.map((c) => c.header), true, true);

  for (const row of rows) {
    const cellLines = row.map((text, i) => wrapMultiline(e.fonts.reg, text, fontSize, widths[i] - 2 * padX));
    const rowH = Math.max(...cellLines.map((l) => l.length)) * lineH + 2 * padY;
    if (e.y - rowH < e.FOOTER_SAFE) {
      await e.newPage();
      drawRow(columns.map((c) => c.header), true, true);
    }
    drawRow(row, false, false);
  }
}

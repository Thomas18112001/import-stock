import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import type { AdminClient } from "./auth.server";
import { getPurchaseOrderDetail, logPurchaseOrderEmailSent } from "./purchaseOrderService";

const EMAIL_FROM_FALLBACK = process.env.PO_EMAIL_FROM?.trim() || process.env.SMTP_FROM?.trim() || "";

const BRAND_NAME = process.env.PO_PDF_BRAND_NAME?.trim() || "WearMoi";
const BRAND_ADDRESS = process.env.PO_PDF_BRAND_ADDRESS?.trim() || "375 Avenue Saint-Just";
const BRAND_EMAIL = process.env.PO_PDF_BRAND_EMAIL?.trim() || "frederic.michel@wearmoi.com";
const BRAND_URL = process.env.PO_PDF_BRAND_URL?.trim() || "";
const FIXED_BILL_TO_LINES = [
  "Wearmoi SAS",
  "375 Avenue Saint-Just",
  "83130 La Garde",
  "France",
];

const PAGE = {
  left: 40,
  right: 555,
  footerY: 790,
  tableBottomLimit: 730,
};

function formatDateFr(value: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(date);
}

function formatMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: currency || "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(amount) ? amount : 0);
}

function safeText(value: string, fallback = "-"): string {
  const trimmed = String(value ?? "").trim();
  return trimmed || fallback;
}

function splitLines(value: string): string[] {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function dedupeConsecutive(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (!out.length || out[out.length - 1].toLowerCase() !== line.toLowerCase()) {
      out.push(line);
    }
  }
  return out;
}

function sanitizeSupplierNotes(value: string): string {
  const autoPatterns = [
    /^réassort magasin généré automatiquement/i,
    /^commande prestashop #/i,
  ];
  const lines = splitLines(value).filter((line) => !autoPatterns.some((pattern) => pattern.test(line)));
  return lines.join("\n").trim();
}

async function downloadImageBuffer(url: string): Promise<Buffer | null> {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2_500);
    const response = await fetch(trimmed, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (!contentType.startsWith("image/")) return null;
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch {
    return null;
  }
}

function drawTopHeader(doc: PDFKit.PDFDocument, orderNumber: string, issuedAt: string): void {
  doc.font("Helvetica").fontSize(10).fillColor("#111");
  doc.text(BRAND_NAME, PAGE.left, 22, { lineBreak: false });
  doc.text(`#${orderNumber}`, PAGE.left, 22, { width: PAGE.right - PAGE.left, align: "right", lineBreak: false });

  doc.font("Helvetica-Bold").fontSize(38).text(BRAND_NAME, PAGE.left, 72, { lineBreak: false });
  doc.font("Helvetica-Bold").fontSize(22).text(`#${orderNumber}`, PAGE.left, 78, {
    width: PAGE.right - PAGE.left,
    align: "right",
    lineBreak: false,
  });
  doc.font("Helvetica").fontSize(12).fillColor("#111");
  doc.text(formatDateFr(issuedAt), PAGE.left, 106, { width: PAGE.right - PAGE.left, align: "right", lineBreak: false });
}

function drawFooter(doc: PDFKit.PDFDocument, pageNumber: number, totalPages: number): void {
  doc.switchToPage(pageNumber - 1);
  doc.font("Helvetica").fontSize(10).fillColor("#111");
  doc.text(`${pageNumber} sur ${totalPages}`, PAGE.left, PAGE.footerY, {
    width: PAGE.right - PAGE.left,
    align: "right",
    lineBreak: false,
  });
  doc.fillColor("#111");
}

export async function renderPurchaseOrderPdf(
  admin: AdminClient,
  shopDomain: string,
  purchaseOrderGid: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const detail = await getPurchaseOrderDetail(admin, shopDomain, purchaseOrderGid);
  const order = detail.order;
  const totalArticles = detail.lines.reduce((sum, line) => sum + line.quantityOrdered, 0);
  const pdfNotes = sanitizeSupplierNotes(order.supplierNotes);

  const supplierLines = dedupeConsecutive([
    safeText(order.supplierName),
    ...splitLines(order.supplierAddress),
  ]);
  const shipToLines = dedupeConsecutive([
    safeText(order.destinationLocationName),
    ...splitLines(order.shipToAddress),
  ]);

  const billToLines = FIXED_BILL_TO_LINES;

  const imageByLineId = new Map<string, Buffer>();
  const imageBuffers = await Promise.all(detail.lines.map((line) => downloadImageBuffer(line.imageUrl)));
  for (let index = 0; index < detail.lines.length; index += 1) {
    const img = imageBuffers[index];
    if (img) imageByLineId.set(detail.lines[index].gid, img);
  }

  const doc = new PDFDocument({ size: "A4", margin: PAGE.left, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // PAGE 1
  drawTopHeader(doc, order.number, order.issuedAt);

  const blockTop = 152;
  const col1 = 40;
  const col2 = 220;
  const col3 = 395;

  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("FOURNISSEUR", col1, blockTop, { lineBreak: false });
  doc.text("EXPÉDIER À", col2, blockTop, { lineBreak: false });
  doc.text("FACTURER À", col3, blockTop, { lineBreak: false });

  doc.font("Helvetica").fontSize(10);
  doc.text(supplierLines.join("\n"), col1, blockTop + 16, { width: 160, lineGap: 1 });
  doc.text(shipToLines.join("\n"), col2, blockTop + 16, { width: 160, lineGap: 1 });
  doc.text(billToLines.join("\n"), col3, blockTop + 16, { width: 160, lineGap: 1 });

  const afterBlocksY = 272;
  doc.moveTo(PAGE.left, afterBlocksY).lineTo(PAGE.right, afterBlocksY).lineWidth(1.4).strokeColor("#111").stroke();
  doc.strokeColor("#111");
  doc.lineWidth(1);

  doc.font("Helvetica-Bold").fontSize(8.5);
  doc.text("MODALITÉS DE PAIEMENT", 40, afterBlocksY + 12, { lineBreak: false });
  doc.text("DEVISE DU FOURNISSEUR", 225, afterBlocksY + 12, { lineBreak: false });
  doc.text("ARRIVÉE ESTIMÉE", 385, afterBlocksY + 12, { lineBreak: false });
  doc.font("Helvetica").fontSize(10);
  doc.text(safeText(order.paymentTerms, "Aucune"), 40, afterBlocksY + 30, { lineBreak: false });
  doc.text(safeText(order.currency, "EUR"), 225, afterBlocksY + 30, { lineBreak: false });
  doc.text(formatDateFr(order.expectedArrivalAt), 385, afterBlocksY + 30, { lineBreak: false });

  const tableTop = afterBlocksY + 50;
  doc.moveTo(PAGE.left, tableTop).lineTo(PAGE.right, tableTop).lineWidth(1.2).strokeColor("#111").stroke();
  doc.strokeColor("#111");
  doc.lineWidth(1);

  const cols = {
    image: 40,
    product: 78,
    supplierSku: 246,
    qty: 380,
    cost: 414,
    tax: 454,
    total: 500,
  };

  const drawTableHeader = (y: number) => {
    doc.font("Helvetica-Bold").fontSize(8);
    doc.text("PRODUITS", cols.image, y, { lineBreak: false });
    doc.text("SKU DU FOURNISSEUR", cols.supplierSku, y, { width: 118, lineBreak: false });
    doc.text("QTÉ", cols.qty, y, { width: 20, align: "right", lineBreak: false });
    doc.text("COÛT", cols.cost, y, { width: 42, align: "right", lineBreak: false });
    doc.text("TAXE", cols.tax, y, { width: 30, align: "right", lineBreak: false });
    doc.text(`TOTAL (${safeText(order.currency, "EUR")})`, cols.total, y, { width: 55, align: "right", lineBreak: false });
    doc.moveTo(PAGE.left, y + 16).lineTo(PAGE.right, y + 16).strokeColor("#c7c7c7").stroke();
    doc.strokeColor("#111");
  };

  let rowY = tableTop + 14;
  drawTableHeader(rowY);
  rowY += 22;

  for (const line of detail.lines) {
    const productTitle = safeText(line.productTitle || line.sku);
    const variantText = safeText(line.variantTitle, "-");
    const productWidth = 160;

    doc.font("Helvetica-Bold").fontSize(9);
    const titleHeight = doc.heightOfString(productTitle, { width: productWidth, lineGap: 0 });
    doc.font("Helvetica").fontSize(10);
    const rowHeight = Math.max(56, Math.ceil(titleHeight + 26));

    if (rowY + rowHeight > PAGE.tableBottomLimit) {
      doc.addPage();
      drawTopHeader(doc, order.number, order.issuedAt);
      const page2TableTop = 160;
      doc.moveTo(PAGE.left, page2TableTop).lineTo(PAGE.right, page2TableTop).lineWidth(1.2).strokeColor("#111").stroke();
      doc.strokeColor("#111");
      doc.lineWidth(1);
      rowY = page2TableTop + 14;
      drawTableHeader(rowY);
      rowY += 22;
    }

    const imageBuffer = imageByLineId.get(line.gid);
    const imageY = rowY + Math.floor((rowHeight - 34) / 2);
    if (imageBuffer) {
      try {
        doc.image(imageBuffer, cols.image, imageY, { fit: [34, 34], align: "center", valign: "center" });
      } catch {
        doc.rect(cols.image, imageY, 34, 34).strokeColor("#d0d0d0").stroke();
      }
    } else {
      doc.rect(cols.image, imageY, 34, 34).strokeColor("#d0d0d0").stroke();
    }
    doc.strokeColor("#111");

    let textY = rowY + 8;
    doc.font("Helvetica-Bold").fontSize(9).text(productTitle, cols.product, textY, { width: productWidth, lineGap: 0 });
    textY += titleHeight + 4;
    doc.font("Helvetica").fontSize(10).text(variantText, cols.product, textY, { width: productWidth, lineGap: 0 });

    const supplierSkuDisplay = safeText(line.sku, "-");

    const numY = rowY + Math.max(12, Math.floor((rowHeight - 10) / 2));
    doc.font("Helvetica").fontSize(10);
    doc.text(supplierSkuDisplay, cols.supplierSku, numY, { width: 118, lineBreak: false });
    doc.text(String(line.quantityOrdered), cols.qty, numY, { width: 20, align: "right", lineBreak: false });
    doc.text(formatMoney(line.unitCost, order.currency), cols.cost, numY, { width: 42, align: "right", lineBreak: false });
    doc.text(`${Number(line.taxRate || 0).toFixed(0)}%`, cols.tax, numY, { width: 30, align: "right", lineBreak: false });
    doc.text(formatMoney(line.lineTotalTtc, order.currency), cols.total, numY, { width: 55, align: "right", lineBreak: false });

    doc.moveTo(PAGE.left, rowY + rowHeight).lineTo(PAGE.right, rowY + rowHeight).strokeColor("#d0d0d0").stroke();
    doc.strokeColor("#111");
    rowY += rowHeight;
  }

  doc.moveTo(PAGE.left, rowY + 2).lineTo(PAGE.right, rowY + 2).lineWidth(1.4).strokeColor("#111").stroke();
  doc.strokeColor("#111");
  doc.lineWidth(1);

  // PAGE 2
  doc.addPage();
  doc.font("Helvetica").fontSize(10);
  doc.text(BRAND_NAME, PAGE.left, 22, { lineBreak: false });
  doc.text(`#${order.number}`, PAGE.left, 22, { width: PAGE.right - PAGE.left, align: "right", lineBreak: false });

  const sectionTop = 76;
  const leftColX = 40;
  const rightColX = 300;

  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("NUMÉRO DE RÉFÉRENCE", leftColX, sectionTop, { lineBreak: false });
  doc.text("RÉSUMÉ DES COÛTS", rightColX, sectionTop, { lineBreak: false });

  doc.font("Helvetica").fontSize(10.5);
  doc.text(safeText(order.referenceNumber, ""), leftColX, sectionTop + 30, { width: 230, lineGap: 1 });

  doc.font("Helvetica-Bold").fontSize(10);
  doc.text("REMARQUES POUR LE FOURNISSEUR", leftColX, sectionTop + 52, { lineBreak: false });
  if (pdfNotes) {
    doc.font("Helvetica").fontSize(10.5).text(pdfNotes, leftColX, sectionTop + 82, { width: 230, lineGap: 1 });
  }

  doc.font("Helvetica").fontSize(10.5);
  doc.text("Taxes (incluses)", rightColX, sectionTop + 30, { width: 170, lineBreak: false });
  doc.text(formatMoney(order.taxTotal, order.currency), 500, sectionTop + 30, { width: 55, align: "right", lineBreak: false });
  doc.text(`Sous-total (${totalArticles} articles)`, rightColX, sectionTop + 60, { width: 170, lineBreak: false });
  doc.text(formatMoney(order.subtotalHt, order.currency), 500, sectionTop + 60, { width: 55, align: "right", lineBreak: false });
  doc.text("Expédition", rightColX, sectionTop + 90, { width: 170, lineBreak: false });
  doc.text(formatMoney(0, order.currency), 500, sectionTop + 90, { width: 55, align: "right", lineBreak: false });

  doc.moveTo(rightColX, sectionTop + 110).lineTo(PAGE.right, sectionTop + 110).lineWidth(1.4).strokeColor("#111").stroke();
  doc.strokeColor("#111");
  doc.lineWidth(1);
  doc.font("Helvetica-Bold").fontSize(12);
  doc.text("Total", rightColX, sectionTop + 122, { width: 170, lineBreak: false });
  doc.text(formatMoney(order.totalTtc, order.currency), 500, sectionTop + 122, {
    width: 55,
    align: "right",
    lineBreak: false,
  });

  doc.moveTo(PAGE.left, 330).lineTo(PAGE.right, 330).strokeColor("#d0d0d0").stroke();
  doc.strokeColor("#111");

  const brandUrl = BRAND_URL || `https://${shopDomain}`;
  doc.font("Helvetica-Bold").fontSize(12).text(BRAND_NAME, PAGE.left, 348, { lineBreak: false });
  doc.font("Helvetica").fontSize(11);
  doc.text(BRAND_ADDRESS, PAGE.left, 372, { lineBreak: false });
  doc.text(BRAND_EMAIL, PAGE.left, 392, { lineBreak: false });
  doc.text(brandUrl, PAGE.left, 412, { lineBreak: false });

  // Footers
  const pageRange = doc.bufferedPageRange();
  for (let pageNumber = 1; pageNumber <= pageRange.count; pageNumber += 1) {
    drawFooter(doc, pageNumber, pageRange.count);
  }

  doc.end();
  const buffer = await done;
  const issueDate = order.issuedAt ? new Date(order.issuedAt).toISOString().slice(0, 10) : "date";
  return {
    filename: `${order.number}_${issueDate}.pdf`,
    buffer,
  };
}

function isEmailLike(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export async function sendPurchaseOrderEmail(
  admin: AdminClient,
  shopDomain: string,
  actor: string,
  purchaseOrderGid: string,
  recipient: string,
): Promise<void> {
  const to = recipient.trim();
  if (!isEmailLike(to)) {
    throw new Error("Adresse email fournisseur invalide.");
  }

  const smtpHost = process.env.SMTP_HOST?.trim() || "";
  const smtpPortRaw = process.env.SMTP_PORT?.trim() || "587";
  const smtpUser = process.env.SMTP_USER?.trim() || "";
  const smtpPass = process.env.SMTP_PASS?.trim() || "";
  const from = EMAIL_FROM_FALLBACK;
  const smtpPort = Number(smtpPortRaw);
  if (!smtpHost || !smtpUser || !smtpPass || !Number.isFinite(smtpPort) || !from) {
    throw new Error("Configuration email incomplète (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS/SMTP_FROM).");
  }

  const detail = await getPurchaseOrderDetail(admin, shopDomain, purchaseOrderGid);
  const pdf = await renderPurchaseOrderPdf(admin, shopDomain, purchaseOrderGid);
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const subject = `Bon de réassort ${detail.order.number}`;
  await transporter.sendMail({
    from,
    to,
    subject,
    text: `Bonjour,\n\nVeuillez trouver en pièce jointe le bon de réassort ${detail.order.number}.\n\nCordialement.`,
    attachments: [
      {
        filename: pdf.filename,
        content: pdf.buffer,
        contentType: "application/pdf",
      },
    ],
  });

  await logPurchaseOrderEmailSent(admin, shopDomain, actor, purchaseOrderGid, { recipient: to, subject });
}

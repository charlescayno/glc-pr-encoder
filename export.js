// Booklet exports: TOP Sheet PDF, PR Booklet Summary PDF and XLSX. Libraries are bundled in ./vendor and load on demand (cached for offline use).
import { flatten, money, round2 } from "./logic.js";

const LIBS = {
    jspdf: "./vendor/jspdf.umd.min.js",
    autotable: "./vendor/jspdf.plugin.autotable.min.js",
    exceljs: "./vendor/exceljs.min.js",
};
const loaded = {};
function loadScript(url) {
    return loaded[url] || (loaded[url] = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = url; s.onload = res; s.onerror = () => { delete loaded[url]; rej(new Error("Could not load " + url)); };
        document.head.appendChild(s);
    }));
}
async function pdfDoc() {
    await loadScript(LIBS.jspdf);
    await loadScript(LIBS.autotable);
    return new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
}

const qtyText = n => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
const mdy = iso => { if (!iso) return ""; const [y, m, d] = iso.split("-"); return `${Number(m)}/${Number(d)}/${y}`; };
const fileBase = s => `${s.firstPr}-${s.lastPr}`;

function save(doc, name) { doc.save(name); }

const HEAD_STYLE = { fillColor: [235, 235, 235], textColor: 0, fontStyle: "bold", lineColor: 0, lineWidth: 0.5 };
// Everything inside the bordered tables (header, body, footer) is centered horizontally and vertically in its cell.
const centerHead = d => { d.cell.styles.halign = "center"; d.cell.styles.valign = "middle"; };
const BODY_STYLE = { textColor: 0, lineColor: 0, lineWidth: 0.5, fontSize: 10 };

function headerLine(doc, s) {
    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.text(`PR No.: ${s.firstPr}-${s.lastPr}`, 40, 46);
    doc.text(`Date: ${s.dateRange}`, 572, 46, { align: "right" });
}

function sectionTable(doc, y, label, sec) {
    // Section title (CASH / ONLINE PAYMENT) sits above the table.
    doc.setFont("helvetica", "bold").setFontSize(11);
    doc.text(label, 40, y + 10);
    doc.autoTable({
        startY: y + 18, margin: { left: 40, right: 40 }, theme: "grid",
        head: [["Sold Item", "QTY", "Selling Price", "Total"]],
        body: sec.rows.length ? sec.rows.map(r => [r.desc, qtyText(r.qty), money(r.price), money(r.total)]) : [["None", "", "", ""]],
        foot: [[{ content: "TOTAL", colSpan: 3 }, money(sec.total)]],
        headStyles: { ...HEAD_STYLE, halign: "center" }, footStyles: HEAD_STYLE, styles: BODY_STYLE,
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        didParseCell: centerHead,
    });
    return doc.lastAutoTable.finalY + 20;
}

// TOP sheet page: booklet range, then the cash and online item tallies.
function drawTopSheet(doc, s) {
    headerLine(doc, s);
    const y = sectionTable(doc, 62, "CASH", s.cash);
    sectionTable(doc, y, "ONLINE PAYMENT", s.online);
}

// One PDF (letter size): page 1 is the TOP sheet, the following pages are the booklet summary.
async function buildBookletPdf(s, bookEntries, counts, preparedBy) {
    const doc = await pdfDoc();
    drawTopSheet(doc, s);
    doc.addPage();
    drawBookletSummary(doc, s, bookEntries, counts, preparedBy);
    return doc;
}

export async function downloadBookletPdf(s, bookEntries, counts, preparedBy) {
    save(await buildBookletPdf(s, bookEntries, counts, preparedBy), `${fileBase(s)} PR Booklet.pdf`);
}

// Prints the PDF (same pages as the download) through a hidden frame, so the printout matches the PDF exactly.
export async function printBookletPdf(s, bookEntries, counts, preparedBy) {
    const doc = await buildBookletPdf(s, bookEntries, counts, preparedBy);
    const url = URL.createObjectURL(new Blob([doc.output("arraybuffer")], { type: "application/pdf" }));
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    frame.onload = () => {
        try { frame.contentWindow.focus(); frame.contentWindow.print(); }
        catch { window.open(url, "_blank"); } // browser would not print inside a frame: open it so Ctrl+P works
        setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 60 * 1000);
    };
    frame.src = url;
    document.body.appendChild(frame);
}

// Opens the PDF in a new browser tab (no download). `win` is a tab opened on the click, so popup blockers allow it.
export async function viewBookletPdf(s, bookEntries, counts, preparedBy, win) {
    const doc = await buildBookletPdf(s, bookEntries, counts, preparedBy);
    const blob = new Blob([doc.output("arraybuffer")], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    if (win && !win.closed) win.location.href = url; else window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60 * 1000);
}

// Booklet summary: every receipt row, cash/online totals, cash count and signature lines.
function drawBookletSummary(doc, s, bookEntries, counts, preparedBy) {
    const rows = flatten(bookEntries);
    const online = rows.map(r => !!r.mop && r.mop.trim().toLowerCase() !== "cash");
    const body = rows.map(r => {
        const mop = r.first && r.mop && r.mop !== "Cash" ? r.mop : "";
        return [r.first ? mdy(r.entry.date) : "", r.first ? r.pr : "", r.first ? r.buyer : "", r.desc, qtyText(r.qty), money(r.price), money(r.total), money(r.grand), mop];
    });
    doc.autoTable({
        startY: 30, margin: { left: 30, right: 30 }, theme: "grid", body,
        head: [["DATE", "PR NUMBER", "BUYER", "SOLD ITEMS", "QTY", "UNIT PRICE", "TOTAL", "GRAND TOTAL", ""]],
        headStyles: { ...HEAD_STYLE, halign: "center" }, styles: { ...BODY_STYLE, fontSize: 8, cellPadding: 2 },
        columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
        rowPageBreak: "avoid",
        // Invoice / online payment receipts (every item row of the receipt) are highlighted blue.
        didParseCell: d => {
            centerHead(d);
            if (d.section === "body" && online[d.row.index]) d.cell.styles.fillColor = [189, 215, 255];
        },
    });
    // "NOTHING FOLLOWS" sits right under the last row, with Cash Sales / Online Payment / Total Sales right after it.
    // Only the cash count and signatures move to the next page when they do not fit.
    let y = doc.lastAutoTable.finalY + 14;
    if (y > 770) { doc.addPage(); y = 40; }
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text("*** NOTHING FOLLOWS ***", 306, y, { align: "center" });
    y += 22;
    // Cash count breakdown: always printed; counts and amounts stay blank when nothing was counted.
    const counted = counts.filter(c => c.count > 0);
    // Totals on the left and the cash count on the right, side by side; both move to a new page only if the cash count does not fit.
    if (y + Math.max(80, ((counted.length || counts.length) + 2) * 17) > 780) { doc.addPage(); y = 40; }
    const sales = round2(s.cash.total + s.online.total);
    const topY = y;
    doc.autoTable({
        startY: topY, margin: { left: 30, right: 330 }, theme: "plain", styles: { fontSize: 10, fontStyle: "bold", textColor: 0 },
        body: [["Cash Sales", money(s.cash.total)], ["Online Payment", money(s.online.total)], ["Total Sales", money(sales)]],
        columnStyles: { 1: { halign: "right" } },
    });
    const totalsEnd = doc.lastAutoTable.finalY;
    doc.autoTable({
        startY: topY, margin: { left: 330, right: 30 }, theme: "grid", styles: { ...BODY_STYLE, fontSize: 9, cellPadding: 2 },
        head: [["Cash Count", "Count", "Amount"]],
        // Only the denominations that were actually counted; if nothing was counted, the blank list is kept.
        body: (counted.length ? counted : counts).map(c => [`${money(c.value)} ${c.kind || ""}`.trim(), c.count > 0 ? c.count : "", c.count > 0 ? money(c.amount) : ""]),
        foot: [[{ content: "TOTAL COUNTED", colSpan: 2 }, counted.length ? money(round2(counted.reduce((t, c) => t + c.amount, 0))) : ""]],
        headStyles: { ...HEAD_STYLE, halign: "center" }, footStyles: HEAD_STYLE, columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
        didParseCell: centerHead,
    });
    y = Math.max(totalsEnd, doc.lastAutoTable.finalY) + 8;
    const notes = [s.voidText ? `VOID: ${s.voidText}` : "", s.unusedText ? `NOT USED: ${s.unusedText}` : ""].filter(Boolean);
    doc.setFont("helvetica", "normal").setFontSize(9);
    if (y + notes.length * 12 + 44 + 120 > 780) { doc.addPage(); y = 40; } // signatures stay together
    notes.forEach(n => { doc.text(n, 30, y + 8); y += 12; });
    y += 44; // one blank line more above Prepared By
    doc.setFontSize(10);
    doc.text(`Prepared By: ${preparedBy || ""}`, 30, y);
    doc.text("Checked By:", 30, y + 50);   // extra room between lines for signatures
    doc.text("Received By:", 30, y + 100);
}

// ---- XLSX: same two pages as the PDF (sheet 1 = TOP Sheet, sheet 2 = PR Booklet), with the same look ----
const THIN = { style: "thin", color: { argb: "FF000000" } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const GREY = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEBEBEB" } };
const BLUE = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBDD7FF" } };
const CENTER = { horizontal: "center", vertical: "middle", wrapText: true };
const NUM = "#,##0.00";
const QTY = "#,##0.##";

// Styles one table cell: bordered and centered; `head` adds the grey bold header look.
function styleCell(cell, { head = false, fill = null, fmt = null } = {}) {
    cell.border = BORDER;
    cell.alignment = CENTER;
    if (head) { cell.font = { bold: true }; cell.fill = GREY; }
    if (fill) cell.fill = fill;
    if (fmt) cell.numFmt = fmt;
}

// Writes one bordered table at (row, col): header, body rows, optional footer. Returns the next free row.
function writeTable(ws, row, col, head, body, foot, fmts = [], fills = []) {
    const put = (r, values, opts) => values.forEach((v, i) => {
        const c = ws.getCell(r, col + i);
        c.value = v;
        styleCell(c, { ...opts, fmt: opts.head || opts.foot ? (opts.foot && typeof v === "number" ? NUM : null) : fmts[i] });
        if (opts.foot) { c.font = { bold: true }; c.fill = GREY; }
    });
    put(row, head, { head: true });
    body.forEach((vals, i) => put(row + 1 + i, vals, { fill: fills[i] || null }));
    let end = row + body.length;
    if (foot) {
        end += 1;
        put(end, foot.values, { foot: true });
        if (foot.span > 1) ws.mergeCells(end, col, end, col + foot.span - 1);
    }
    return end + 1;
}

function cashCountRows(counts) {
    const counted = counts.filter(c => c.count > 0);
    return {
        counted,
        body: (counted.length ? counted : counts).map(c => [`${money(c.value)} ${c.kind || ""}`.trim(), c.count > 0 ? c.count : "", c.count > 0 ? c.amount : ""]),
        total: counted.length ? round2(counted.reduce((t, c) => t + c.amount, 0)) : "",
    };
}

// Builds the workbook with an ExcelJS constructor (kept separate from the download so it can be tested).
export function buildSummaryWorkbook(ExcelJS, s, bookEntries, counts, preparedBy) {
    const wb = new ExcelJS.Workbook();
    const letter = { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };

    // ---- Sheet 1: TOP Sheet ----
    const top = wb.addWorksheet("TOP Sheet", { pageSetup: letter });
    top.columns = [{ width: 32 }, { width: 10 }, { width: 16 }, { width: 16 }];
    top.getCell("A1").value = `PR No.: ${s.firstPr}-${s.lastPr}`;
    top.getCell("D1").value = `Date: ${s.dateRange}`;
    top.getCell("A1").font = top.getCell("D1").font = { bold: true, size: 12 };
    top.getCell("D1").alignment = { horizontal: "right" };
    let r = 3;
    for (const [label, sec] of [["CASH", s.cash], ["ONLINE PAYMENT", s.online]]) {
        top.getCell(r, 1).value = label;
        top.getCell(r, 1).font = { bold: true, size: 11 };
        r = writeTable(top, r + 1, 1, ["Sold Item", "QTY", "Selling Price", "Total"],
            sec.rows.length ? sec.rows.map(x => [x.desc, x.qty, x.price, x.total]) : [["None", "", "", ""]],
            { values: ["TOTAL", "", "", sec.total], span: 3 }, [null, QTY, NUM, NUM]) + 1;
    }

    // ---- Sheet 2: PR Booklet ----
    const bk = wb.addWorksheet("PR Booklet", { pageSetup: letter });
    bk.columns = [{ width: 12 }, { width: 12 }, { width: 16 }, { width: 24 }, { width: 8 }, { width: 13 }, { width: 13 }, { width: 14 }, { width: 34 }];
    const rows = flatten(bookEntries);
    const body = rows.map(x => [x.first ? mdy(x.entry.date) : "", x.first ? x.pr : "", x.first ? x.buyer : "", x.desc, x.qty, x.price, x.total, x.grand,
        x.first && x.mop && x.mop !== "Cash" ? x.mop : ""]);
    // Invoice / online payment receipts are highlighted blue, on every item row of the receipt.
    const fills = rows.map(x => (!!x.mop && x.mop.trim().toLowerCase() !== "cash") ? BLUE : null);
    r = writeTable(bk, 1, 1, ["DATE", "PR NUMBER", "BUYER", "SOLD ITEMS", "QTY", "UNIT PRICE", "TOTAL", "GRAND TOTAL", ""], body, null,
        [null, null, null, null, QTY, NUM, NUM, NUM, null], fills);
    bk.getCell(r, 1).value = "*** NOTHING FOLLOWS ***";
    bk.mergeCells(r, 1, r, 9);
    bk.getCell(r, 1).font = { bold: true };
    bk.getCell(r, 1).alignment = { horizontal: "center" };
    r += 2;

    // Totals on the left, cash count on the right (same side-by-side layout as the PDF).
    const sales = round2(s.cash.total + s.online.total);
    [["Cash Sales", s.cash.total], ["Online Payment", s.online.total], ["Total Sales", sales]].forEach(([label, amount], i) => {
        const lc = bk.getCell(r + i, 1), ac = bk.getCell(r + i, 4);
        lc.value = label; ac.value = amount;
        bk.mergeCells(r + i, 1, r + i, 3);
        lc.font = ac.font = { bold: true };
        lc.alignment = { horizontal: "left" };
        ac.alignment = { horizontal: "right" };
        ac.numFmt = NUM;
    });
    const cc = cashCountRows(counts);
    const ccEnd = writeTable(bk, r, 6, ["Cash Count", "Count", "Amount"], cc.body, { values: ["TOTAL COUNTED", "", cc.total], span: 2 }, [null, "#,##0", NUM]);
    r = Math.max(r + 3, ccEnd) + 1;

    [s.voidText ? `VOID: ${s.voidText}` : "", s.unusedText ? `NOT USED: ${s.unusedText}` : ""].filter(Boolean)
        .forEach(n => { bk.getCell(r, 1).value = n; r += 1; });
    r += 1;
    bk.getCell(r, 1).value = `Prepared By: ${preparedBy || ""}`;
    bk.getCell(r + 3, 1).value = "Checked By:";
    bk.getCell(r + 6, 1).value = "Received By:";
    return wb;
}

export async function downloadSummaryXlsx(s, bookEntries, counts, preparedBy) {
    await loadScript(LIBS.exceljs);
    const wb = buildSummaryWorkbook(window.ExcelJS, s, bookEntries, counts, preparedBy);
    const buf = await wb.xlsx.writeBuffer();
    const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    const a = document.createElement("a");
    a.href = url; a.download = `${fileBase(s)} PR Booklet.xlsx`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60 * 1000);
}

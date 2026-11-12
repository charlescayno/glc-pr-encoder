// Booklet exports: TOP Sheet PDF, PR Booklet Summary PDF and XLSX. Libraries are bundled in ./vendor and load on demand (cached for offline use).
import { flatten, money, round2, itemColor, categoryGroups } from "./logic.js";

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
// Item names are printed in the color of their book cover.
const hexRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
function colorItem(d, col) {
    if (d.section !== "body" || d.column.index !== col) return;
    const c = itemColor(d.cell.raw);
    if (c) { d.cell.styles.textColor = hexRgb(c); d.cell.styles.fontStyle = "bold"; }
}
const BODY_STYLE = { textColor: 0, lineColor: 0, lineWidth: 0.5, fontSize: 10 };

// Top sheet (same layout as the TOP finance report): PR range and date, then CASH and ONLINE PAYMENT item tallies
// grouped by category (green bars), all on one page. The font shrinks as needed to keep it to one page.
const BAND = [155, 194, 230], GREEN = [146, 208, 80], YELLOW = [255, 255, 0];
const dashDate = s => String(s).replace(/(\d{1,2})\/(\d{1,2})\/(\d{4})/g, (_, m, d, y) => `${m.padStart(2, "0")}-${d.padStart(2, "0")}-${y}`);

function topSheetRows(s) {
    const rows = [], kinds = [];
    const add = (cells, kind) => { rows.push(cells); kinds.push(kind); };
    [["CASH", s.cash], ["ONLINE PAYMENT", s.online]].forEach(([label, sec], i) => {
        if (i) add(["", "", "", ""], "gap");
        add([label, "", "", ""], "band");
        add(["ITEM NAME", "QTY", "Selling Price", "Total"], "head");
        categoryGroups(sec).forEach(g => {
            add([g.name, "", "", ""], "cat");
            g.rows.forEach(r => add([r.desc, qtyText(r.qty), money(r.price), money(r.total)], "item"));
            add(["", "", "", ""], "gap");
        });
        add(["TOTAL", "", "", money(sec.total)], "total");
    });
    return { rows, kinds };
}

function drawTopSheet(doc, s) {
    const { rows, kinds } = topSheetRows(s);
    const left = 40, widths = [215, 50, 90, 75], top = 66, avail = 792 - 30 - top;
    // Largest font (10 down to 6) whose rows all fit on the page.
    let size = 10;
    const rowH = z => z * 1.15 + 2 * Math.max(1.2, z * 0.2);
    while (size > 6 && rows.length * rowH(size) > avail) size -= 0.5;
    const pad = Math.max(1.2, size * 0.2);
    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.setFillColor(...YELLOW).rect(left, 33, 215, 17, "F");
    doc.setTextColor(0).text(`PR No.: ${s.firstPr}-${s.lastPr}`, left + 3, 46);
    doc.text(`Date: ${dashDate(s.dateRange)}`, left + widths[0] + widths[1] + 4, 46);
    doc.autoTable({
        startY: top, margin: { left, right: 612 - left - widths.reduce((a, b) => a + b, 0) }, theme: "grid", body: rows,
        styles: { ...BODY_STYLE, fontSize: size, cellPadding: { top: pad, bottom: pad, left: 2, right: 3 } },
        columnStyles: widths.reduce((o, w, i) => (o[i] = { cellWidth: w, halign: i ? "right" : "left" }, o), {}),
        rowPageBreak: "avoid",
        didParseCell: d => {
            const k = kinds[d.row.index];
            if (d.section !== "body") return;
            if (k === "band") { d.cell.styles.fillColor = BAND; d.cell.styles.fontStyle = "bold"; d.cell.styles.halign = "left"; }
            if (k === "head") { d.cell.styles.fillColor = BAND; d.cell.styles.fontStyle = "bold"; d.cell.styles.halign = d.column.index ? "center" : "left"; }
            if (k === "cat") { d.cell.styles.fillColor = GREEN; d.cell.styles.fontStyle = "bold"; d.cell.styles.halign = "left"; }
            if (k === "total") d.cell.styles.fontStyle = "bold";
            if (k === "gap" && d.row.index > 0 && kinds[d.row.index + 1] === "band") { d.cell.styles.lineWidth = 0; d.cell.styles.fillColor = false; } // space between CASH and ONLINE PAYMENT
        },
        didDrawCell: d => { // underline the column titles
            if (d.section !== "body" || kinds[d.row.index] !== "head") return;
            const w = doc.setFont("helvetica", "bold").setFontSize(size).getTextWidth(String(d.cell.raw));
            const x = d.column.index ? d.cell.x + (d.cell.width - w) / 2 : d.cell.x + 2;
            const y = d.cell.y + d.cell.height - pad - 0.5;
            doc.setLineWidth(0.5).line(x, y, x + w, y);
        },
    });
}

// One PDF (letter size): the TOP sheet (one page), then the booklet summary (logs).
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
            centerHead(d); colorItem(d, 3);
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

// ---- XLSX: same pages as the PDF (TOP Sheet, PR Booklet), with the same look ----
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

// Item name in the color of its book cover (bold), same as on screen and in the PDF.
function colorItemCell(cell, desc) {
    const c = itemColor(desc);
    if (c) cell.font = { bold: true, color: { argb: "FF" + c.slice(1).toUpperCase() } };
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

    // ---- Sheet 1: TOP Sheet (same layout as the PDF: PR range, CASH and ONLINE PAYMENT items by category) ----
    const top = wb.addWorksheet("TOP Sheet", { pageSetup: { paperSize: 1, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 1 } });
    top.columns = [{ width: 44 }, { width: 10 }, { width: 16 }, { width: 14 }];
    const argb = c => ({ type: "pattern", pattern: "solid", fgColor: { argb: "FF" + c.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase() } });
    const bandFill = argb(BAND), greenFill = argb(GREEN);
    top.getCell("A1").value = `PR No.: ${s.firstPr}-${s.lastPr}`;
    top.getCell("A1").fill = argb(YELLOW);
    top.getCell("C1").value = `Date: ${dashDate(s.dateRange)}`;
    top.getCell("A1").font = top.getCell("C1").font = { bold: true, size: 12 };
    const { rows: tRows, kinds } = topSheetRows(s);
    let r = 3;
    tRows.forEach((cells, i) => {
        const k = kinds[i];
        if (k === "gap" && kinds[i + 1] === "band") { r += 1; return; } // space between CASH and ONLINE PAYMENT
        const sec = i < kinds.indexOf("band", 1) ? s.cash : s.online;
        const rawRow = k === "item" ? sec.rows.find(x => x.desc === cells[0] && money(x.price) === cells[2]) : null;
        const vals = rawRow ? [rawRow.desc, rawRow.qty, rawRow.price, rawRow.total] : k === "total" ? ["TOTAL", "", "", sec.total] : cells;
        vals.forEach((v, j) => {
            const c = top.getCell(r, 1 + j);
            c.value = v === "" ? null : v;
            c.border = BORDER;
            c.alignment = { horizontal: k === "head" && j ? "center" : j ? "right" : "left", vertical: "middle" };
            if (k === "item" && j) c.numFmt = j === 1 ? QTY : NUM;
            if (k === "total" && j === 3) c.numFmt = NUM;
            if (k === "band" || k === "head") { c.fill = bandFill; c.font = { bold: true, underline: k === "head" }; }
            if (k === "cat") { c.fill = greenFill; c.font = { bold: true }; }
            if (k === "total") c.font = { bold: true };
        });
        if (k === "band") top.mergeCells(r, 1, r, 4);
        r += 1;
    });
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
    rows.forEach((x, i) => colorItemCell(bk.getCell(2 + i, 4), x.desc));
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
// Booklet exports: TOP Sheet PDF, PR Booklet Summary PDF and XLSX. Libraries load on demand from a CDN.
import { flatten, money, round2 } from "./logic.js";

const LIBS = {
    jspdf: "https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js",
    autotable: "https://cdn.jsdelivr.net/npm/jspdf-autotable@3.8.2/dist/jspdf.plugin.autotable.min.js",
    xlsx: "https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js",
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
const BODY_STYLE = { textColor: 0, lineColor: 0, lineWidth: 0.5, fontSize: 10 };

function headerLine(doc, s) {
    doc.setFont("helvetica", "bold").setFontSize(12);
    doc.text(`PR No.: ${s.firstPr}-${s.lastPr}`, 40, 46);
    doc.text(`Date: ${s.dateRange}`, 572, 46, { align: "right" });
}

function sectionTable(doc, y, label, sec) {
    doc.autoTable({
        startY: y, margin: { left: 40, right: 40 }, theme: "grid",
        head: [["Item Name", "QTY", "Selling Price", "Total"]],
        body: sec.rows.length ? sec.rows.map(r => [r.desc, qtyText(r.qty), money(r.price).replace(/\.00$/, ""), money(r.total)]) : [["None", "", "", ""]],
        foot: [[{ content: "TOTAL", colSpan: 3 }, money(sec.total)]],
        headStyles: HEAD_STYLE, footStyles: HEAD_STYLE, styles: BODY_STYLE,
        columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
        didParseCell: d => { if (d.section === "foot" && d.column.index === 3) d.cell.styles.halign = "right"; },
    });
    const end = doc.lastAutoTable.finalY;
    doc.setFont("helvetica", "bold").setFontSize(11);
    doc.text(label, 40, end + 16);
    return end + 34;
}

// TOP sheet page: booklet range, then the cash and online item tallies.
function drawTopSheet(doc, s) {
    headerLine(doc, s);
    let y = sectionTable(doc, 60, "CASH", s.cash);
    sectionTable(doc, y + 8, "ONLINE PAYMENT", s.online);
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
        headStyles: HEAD_STYLE, styles: { ...BODY_STYLE, fontSize: 8, cellPadding: 2 },
        columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" }, 7: { halign: "right" } },
        rowPageBreak: "avoid",
        // Invoice / online payment receipts (every item row of the receipt) are highlighted blue.
        didParseCell: d => {
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
    if (y + 80 > 780) { doc.addPage(); y = 40; }
    const sales = round2(s.cash.total + s.online.total);
    doc.autoTable({
        startY: y, margin: { left: 30, right: 330 }, theme: "plain", styles: { fontSize: 10, fontStyle: "bold", textColor: 0 },
        body: [["Cash Sales", money(s.cash.total)], ["Online Payment", money(s.online.total)], ["Total Sales", money(sales)]],
        columnStyles: { 1: { halign: "right" } },
    });
    y = doc.lastAutoTable.finalY + 8;
    if (y + 420 > 780) { doc.addPage(); y = 40; } // cash count + notes + signatures stay together
    // Cash count breakdown: always printed; counts and amounts stay blank when nothing was counted.
    const counted = counts.filter(c => c.count > 0);
    doc.autoTable({
        startY: y, margin: { left: 30, right: 330 }, theme: "grid", styles: { ...BODY_STYLE, fontSize: 9, cellPadding: 2 },
        head: [["Cash Count", "Count", "Amount"]],
        // Only the denominations that were actually counted; if nothing was counted, the blank list is kept.
        body: (counted.length ? counted : counts).map(c => [`${money(c.value)} ${c.kind || ""}`.trim(), c.count > 0 ? c.count : "", c.count > 0 ? money(c.amount) : ""]),
        foot: [[{ content: "TOTAL COUNTED", colSpan: 2 }, counted.length ? money(round2(counted.reduce((t, c) => t + c.amount, 0))) : ""]],
        headStyles: HEAD_STYLE, footStyles: HEAD_STYLE, columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
        didParseCell: d => { if (d.section === "foot" && d.column.index === 2) d.cell.styles.halign = "right"; },
    });
    y = doc.lastAutoTable.finalY + 8;
    const notes = [s.voidText ? `VOID: ${s.voidText}` : "", s.unusedText ? `NOT USED: ${s.unusedText}` : ""].filter(Boolean);
    doc.setFont("helvetica", "normal").setFontSize(9);
    notes.forEach(n => { doc.text(n, 30, y + 8); y += 12; });
    y += 22;
    doc.setFontSize(10);
    doc.text(`Prepared By: ${preparedBy || ""}`, 30, y);
    doc.text("Checked By:", 30, y + 50);   // extra room between lines for signatures
    doc.text("Received By:", 30, y + 100);
}

// XLSX with the tally sheet (cash, online, void, not used, cash count) and the full receipts table.
export async function downloadSummaryXlsx(s, bookEntries, counts) {
    await loadScript(LIBS.xlsx);
    const X = window.XLSX;
    const tally = [[`PR No.: ${s.firstPr}-${s.lastPr}`, "", "", `Date: ${s.dateRange}`], []];
    const block = (title, sec) => {
        tally.push([title], ["Item Name", "QTY", "Selling Price", "Total"]);
        sec.rows.forEach(r => tally.push([r.desc, r.qty, r.price, r.total]));
        tally.push(["TOTAL", "", "", sec.total], []);
    };
    block("CASH", s.cash);
    block("ONLINE PAYMENT", s.online);
    tally.push(["Total Sales", "", "", round2(s.cash.total + s.online.total)], []);
    if (s.voidText) tally.push(["VOID", s.voidText]);
    if (s.unusedText) tally.push(["NOT USED", s.unusedText]);
    const cc = counts.filter(c => c.count > 0);
    if (cc.length) {
        tally.push([], ["CASH COUNT"], ["Denomination", "Count", "Amount"]);
        cc.forEach(c => tally.push([c.value, c.count, c.amount]));
        tally.push(["TOTAL COUNTED", "", round2(cc.reduce((t, c) => t + c.amount, 0))]);
    }
    const ws1 = X.utils.aoa_to_sheet(tally);
    ws1["!cols"] = [{ wch: 28 }, { wch: 10 }, { wch: 14 }, { wch: 16 }];
    const rec = [["DATE", "PR NUMBER", "BUYER", "SOLD ITEMS", "QTY", "UNIT PRICE", "TOTAL", "GRAND TOTAL", "MOP"],
        ...flatten(bookEntries).map(r => [r.first ? mdy(r.entry.date) : "", r.first ? r.pr : "", r.first ? r.buyer : "", r.desc, r.qty, r.price, r.total, r.grand, r.first ? r.mop : ""])];
    const ws2 = X.utils.aoa_to_sheet(rec);
    ws2["!cols"] = [{ wch: 11 }, { wch: 11 }, { wch: 16 }, { wch: 22 }, { wch: 8 }, { wch: 11 }, { wch: 12 }, { wch: 13 }, { wch: 30 }];
    const wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, ws1, "Booklet Summary");
    X.utils.book_append_sheet(wb, ws2, "Receipts");
    X.writeFile(wb, `${fileBase(s)} PR Booklet Summary.xlsx`);
}

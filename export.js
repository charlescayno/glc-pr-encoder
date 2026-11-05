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
        head: [["Product Title", "QTY", "Selling Price", "Total"]],
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

// One-page TOP sheet: booklet range, then the cash and online item tallies.
export async function downloadTopSheet(s) {
    const doc = await pdfDoc();
    headerLine(doc, s);
    let y = sectionTable(doc, 60, "CASH", s.cash);
    sectionTable(doc, y + 8, "ONLINE PAYMENT", s.online);
    save(doc, `TOP Sheet ${fileBase(s)}.pdf`);
}

// Full booklet summary: every receipt row, cash/online totals, cash count and signature lines.
export async function downloadBookletSummary(s, bookEntries, counts, preparedBy) {
    const doc = await pdfDoc();
    const rows = flatten(bookEntries);
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
    });
    const need = 330;
    let y = doc.lastAutoTable.finalY + 14;
    if (y + need > 780) { doc.addPage(); y = 40; }
    doc.setFont("helvetica", "bold").setFontSize(10);
    doc.text("*** NOTHING FOLLOWS ***", 306, y, { align: "center" });
    y += 22;
    const sales = round2(s.cash.total + s.online.total);
    doc.autoTable({
        startY: y, margin: { left: 30, right: 330 }, theme: "plain", styles: { fontSize: 10, fontStyle: "bold", textColor: 0 },
        body: [["Cash Sales", money(s.cash.total)], ["Online Payment", money(s.online.total)], ["Total Sales", money(sales)]],
        columnStyles: { 1: { halign: "right" } },
    });
    y = doc.lastAutoTable.finalY + 8;
    const cc = counts.filter(c => c.count > 0);
    if (cc.length) {
        doc.autoTable({
            startY: y, margin: { left: 30, right: 330 }, theme: "grid", styles: { ...BODY_STYLE, fontSize: 9, cellPadding: 2 },
            body: cc.map(c => [money(c.value), c.count, money(c.amount)]),
            foot: [[{ content: "", colSpan: 2 }, money(round2(cc.reduce((t, c) => t + c.amount, 0)))]],
            footStyles: HEAD_STYLE, columnStyles: { 0: { halign: "right" }, 1: { halign: "right" }, 2: { halign: "right" } },
        });
        y = doc.lastAutoTable.finalY + 8;
    }
    const notes = [s.voidText ? `VOID: ${s.voidText}` : "", s.unusedText ? `NOT USED: ${s.unusedText}` : ""].filter(Boolean);
    doc.setFont("helvetica", "normal").setFontSize(9);
    notes.forEach(n => { doc.text(n, 30, y + 8); y += 12; });
    y += 22;
    doc.setFontSize(10);
    doc.text(`Prepared By: ${preparedBy || ""}`, 30, y);
    doc.text("Checked By:", 30, y + 22);
    doc.text("Received By:", 30, y + 44);
    save(doc, `PR Booklet Summary ${fileBase(s)}.pdf`);
}

// XLSX with the tally sheet (cash, online, void, not used, cash count) and the full receipts table.
export async function downloadSummaryXlsx(s, bookEntries, counts) {
    await loadScript(LIBS.xlsx);
    const X = window.XLSX;
    const tally = [[`PR No.: ${s.firstPr}-${s.lastPr}`, "", "", `Date: ${s.dateRange}`], []];
    const block = (title, sec) => {
        tally.push([title], ["Product Title", "QTY", "Selling Price", "Total"]);
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
    X.writeFile(wb, `PR Booklet Summary ${fileBase(s)}.xlsx`);
}

// "Weekly Inventory & Sales Monitoring Sheet" view: opened in its own browser window.
// Rows are CATEGORY | DESCRIPTION, columns are weeks (first table) and months (second table), cells are quantities sold.
import { salesMatrix, salesMatrixCSV, money } from "./logic.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const qty = n => (n ? Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "");

function tableHtml(title, kind, m) {
    if (!m.periods.length) return `<h2>${esc(title)}</h2><p class="empty">No receipts encoded yet.</p>`;
    const head = m.periods.map(p => `<th class="col">${esc(p.label)}</th>`).join("");
    // Merge the category cell down its group, like the sheet.
    const spans = new Map();
    let start = 0;
    m.rows.forEach((r, i) => {
        if (i > 0 && m.rows[i - 1].category === r.category) spans.get(start).n++;
        else { start = i; spans.set(i, { n: 1 }); }
    });
    const body = m.rows.map((r, i) => `<tr>${spans.has(i) ? `<td class="cat" rowspan="${spans.get(i).n}">${esc(r.category)}</td>` : ""}
        <td class="desc">${esc(r.desc)}</td>${r.qtys.map(n => `<td class="n">${qty(n)}</td>`).join("")}<td class="n tot">${qty(r.total)}</td></tr>`).join("");
    const sum = f => Math.round(m.periods.reduce((s, p) => s + f(p), 0) * 100) / 100;
    const foot = `<tr class="foot"><td colspan="2">TOTAL UNITS SOLD</td>${m.periods.map(p => `<td class="n">${qty(p.units)}</td>`).join("")}<td class="n">${qty(sum(p => p.units))}</td></tr>
        <tr class="foot"><td colspan="2">TOTAL SALES (&#8369;)</td>${m.periods.map(p => `<td class="n">${money(p.total)}</td>`).join("")}<td class="n">${money(sum(p => p.total))}</td></tr>
        <tr class="foot sub"><td colspan="2">Cash</td>${m.periods.map(p => `<td class="n">${money(p.cash)}</td>`).join("")}<td class="n">${money(sum(p => p.cash))}</td></tr>
        <tr class="foot sub"><td colspan="2">Online payment</td>${m.periods.map(p => `<td class="n">${money(p.online)}</td>`).join("")}<td class="n">${money(sum(p => p.online))}</td></tr>`;
    const csv = "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + salesMatrixCSV(m, kind));
    return `<div class="bar"><h2>${esc(title)}</h2><a class="btn" download="sales-per-${kind}.csv" href="${csv}">Download CSV</a></div>
        <div class="wrap"><table><thead><tr><th class="cat">CATEGORY:</th><th class="desc">DESCRIPTION:</th>${head}<th class="col">TOTAL</th></tr></thead>
        <tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

const STYLE = `
body { font-family: Calibri, Arial, sans-serif; margin: 1rem 1.5rem; color: #000; background: #fff; }
h1 { font-size: 1.2rem; margin: 0 0 .2rem; } h2 { font-size: 1rem; margin: 1.5rem 0 .4rem; }
.note { font-size: .8rem; color: #555; margin: 0 0 .5rem; }
.bar { display: flex; align-items: center; gap: 1rem; } .bar h2 { margin-right: auto; }
.btn { font: inherit; font-size: .8rem; padding: .3rem .7rem; border: 1px solid #888; border-radius: 4px; background: #f3f3f3; color: #000; text-decoration: none; cursor: pointer; }
.wrap { overflow: auto; max-height: 85vh; }
table { border-collapse: collapse; font-size: .82rem; background: #d6e1db; }
th, td { border: 1px solid #000; padding: .15rem .45rem; white-space: nowrap; }
th { font-weight: 700; text-align: left; position: sticky; top: 0; z-index: 2; background: #d6e1db; }
th.col { text-align: center; }
td.cat { font-weight: 700; vertical-align: top; text-transform: uppercase; white-space: normal; min-width: 7.5rem; background: #d6e1db; }
td.desc { font-weight: 600; background: #d6e1db; }
td.n { text-align: right; background: #fff; min-width: 5.5rem; font-variant-numeric: tabular-nums; }
td.tot { font-weight: 700; background: #eef3f0; }
tr.foot td { font-weight: 700; background: #d6e1db; } tr.foot td.n { background: #eef3f0; } tr.foot.sub td { font-weight: 400; }
.empty { color: #555; }
@media print { .btn { display: none; } .wrap { max-height: none; overflow: visible; } th { position: static; } body { margin: 0; } @page { size: landscape; margin: 8mm; } }
`;

// Opens the sheet in a new window. Must be called from a click so the browser does not block the popup.
export function openSalesSheet(entries) {
    const win = window.open("", "glc-sales-sheet", "width=1280,height=860,scrollbars=yes,resizable=yes");
    if (!win) return false;
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Weekly Inventory &amp; Sales Monitoring Sheet</title><style>${STYLE}</style></head><body>
        <div class="bar"><h1>WEEKLY INVENTORY &amp; SALES MONITORING SHEET</h1><button class="btn" onclick="window.print()">Print</button></div>
        <p class="note">Quantities sold, by PR date. Weeks run Sunday to Saturday. Void / not-used PR numbers are not counted. A book without "old" or "new" in its name is counted as NEW.</p>
        ${tableHtml("SALES PER WEEK", "week", salesMatrix(entries, "week"))}
        ${tableHtml("SALES PER MONTH", "month", salesMatrix(entries, "month"))}
        </body></html>`;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    return true;
}

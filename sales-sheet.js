// "Weekly Inventory & Sales Monitoring Sheet" page (full page inside the app, like the PR review).
// Rows are CATEGORY | DESCRIPTION, columns are weeks (first table) and months (second table), cells are quantities sold.
import { salesMatrix, salesMatrixCSV, money } from "./logic.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const qty = n => (n ? Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 }) : "");

function tableHtml(title, kind, m) {
    if (!m.periods.length) return `<h2>${esc(title)}</h2><p class="ss-empty">No receipts encoded yet.</p>`;
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
    const foot = `<tr class="foot"><td colspan="2" class="lbl">TOTAL UNITS SOLD</td>${m.periods.map(p => `<td class="n">${qty(p.units)}</td>`).join("")}<td class="n tot">${qty(sum(p => p.units))}</td></tr>
        <tr class="foot"><td colspan="2" class="lbl">TOTAL SALES (&#8369;)</td>${m.periods.map(p => `<td class="n">${money(p.total)}</td>`).join("")}<td class="n tot">${money(sum(p => p.total))}</td></tr>
        <tr class="foot sub"><td colspan="2" class="lbl">Cash</td>${m.periods.map(p => `<td class="n">${money(p.cash)}</td>`).join("")}<td class="n tot">${money(sum(p => p.cash))}</td></tr>
        <tr class="foot sub"><td colspan="2" class="lbl">Online payment</td>${m.periods.map(p => `<td class="n">${money(p.online)}</td>`).join("")}<td class="n tot">${money(sum(p => p.online))}</td></tr>`;
    const csv = "data:text/csv;charset=utf-8," + encodeURIComponent("\uFEFF" + salesMatrixCSV(m, kind));
    return `<div class="ss-bar"><h2>${esc(title)}</h2><a class="btn btn-secondary" download="sales-per-${kind}.csv" href="${csv}">Download CSV</a></div>
        <div class="ss-wrap"><table class="ss-table"><thead><tr><th class="cat">CATEGORY:</th><th class="desc">DESCRIPTION:</th>${head}<th class="col tot">TOTAL</th></tr></thead>
        <tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

// Fills the sales page body with the weekly and monthly tables.
export function renderSalesSheet(el, entries) {
    el.innerHTML = `<p class="ss-note">Quantities sold, by PR date. Weeks run Sunday to Saturday. Void / not-used PR numbers are not counted. A book without "old" or "new" in its name is counted as NEW.</p>
        ${tableHtml("SALES PER WEEK", "week", salesMatrix(entries, "week"))}
        ${tableHtml("SALES PER MONTH", "month", salesMatrix(entries, "month"))}`;
}
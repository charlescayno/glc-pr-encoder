// Analytics page (full page inside the app, like the sales summary): totals, daily trend, categories, payments, weekdays, top items.
import { analytics, periodOf, money } from "./logic.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const peso = n => "\u20B1" + money(n);
const num = n => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}`; };
const longDate = iso => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const localISO = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (iso, days) => { const [y, m, d] = iso.split("-").map(Number); return localISO(new Date(y, m - 1, d + days)); };

// Horizontal bars: label, value text and a bar scaled to the largest value.
function barList(rows, valueOf, textOf, cls = "") {
    const max = Math.max(0, ...rows.map(valueOf));
    if (!rows.length || max <= 0) return `<p class="ss-empty">No data for this period.</p>`;
    return `<div class="an-bars">${rows.map(r => `<div class="an-bar-row ${cls}">
        <span class="an-bar-label" title="${esc(r.label)}">${esc(r.label)}</span>
        <span class="an-bar-track"><i style="width:${Math.max(1, (valueOf(r) / max) * 100).toFixed(1)}%"></i></span>
        <span class="an-bar-val">${textOf(r)}</span></div>`).join("")}</div>`;
}

// Column chart as inline SVG. Long ranges are grouped by week so the bars stay readable.
function trendChart(days) {
    if (!days.length) return `<p class="ss-empty">No receipts in this period.</p>`;
    let pts = days.map(d => ({ label: shortDate(d.date), tip: `${longDate(d.date)}: ${peso(d.total)} (${d.receipts} receipts)`, total: d.total }));
    let unit = "day";
    if (days.length > 45) {
        const weeks = new Map();
        for (const d of days) { const p = periodOf(d.date, "week"); const w = weeks.get(p.key) || { key: p.key, from: p.from, to: p.to, total: 0, receipts: 0 }; w.total += d.total; w.receipts += d.receipts; weeks.set(p.key, w); }
        pts = [...weeks.values()].sort((a, b) => a.key.localeCompare(b.key)).map(w => ({ label: shortDate(w.from), tip: `${shortDate(w.from)} - ${shortDate(w.to)}: ${peso(w.total)} (${w.receipts} receipts)`, total: w.total }));
        unit = "week";
    }
    const W = 860, H = 230, L = 62, B = 34, T = 10, R = 8;
    const max = Math.max(...pts.map(p => p.total)) || 1;
    const step = (W - L - R) / pts.length, bw = Math.min(46, step * 0.72);
    const y = v => T + (H - T - B) * (1 - v / max);
    const grid = [0, 0.5, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(max * f)}" y2="${y(max * f)}" class="an-grid"/><text x="${L - 6}" y="${y(max * f) + 4}" text-anchor="end" class="an-axis">${num(Math.round(max * f))}</text>`).join("");
    const every = Math.ceil(pts.length / 14);
    const bars = pts.map((p, i) => {
        const x = L + i * step + (step - bw) / 2, h = (H - T - B) * (p.total / max);
        return `<rect x="${x.toFixed(1)}" y="${(y(p.total)).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="2" class="an-col"><title>${esc(p.tip)}</title></rect>`
            + (i % every === 0 ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle" class="an-axis">${esc(p.label)}</text>` : "");
    }).join("");
    return `<svg class="an-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales per ${unit}">${grid}${bars}</svg><div class="an-sub">Sales per ${unit} (pesos). Hover a bar for details.</div>`;
}

const card = (label, value, sub = "") => `<div class="an-card"><div class="an-card-label">${esc(label)}</div><div class="an-card-val">${value}</div>${sub ? `<div class="an-card-sub">${sub}</div>` : ""}</div>`;

// state: { from, to } kept between renders. Fills `el` and re-renders when the range changes.
export function renderAnalytics(el, entries, marks, state = {}) {
    const a = analytics(entries, marks, state);
    const today = localISO();
    const first = entries.map(e => e.date).filter(Boolean).sort()[0] || "";
    const onlinePct = a.total > 0 ? Math.round((a.online / a.total) * 100) : 0;
    const wdBest = a.weekdays.reduce((b, w) => (w.avg > (b ? b.avg : 0) ? w : b), null);
    el.innerHTML = `
        <div class="an-range no-print">
            <label>From <input type="date" id="anFrom" value="${esc(state.from || "")}" min="${esc(first)}"></label>
            <label>To <input type="date" id="anTo" value="${esc(state.to || "")}"></label>
            <button type="button" class="btn btn-secondary" data-an="all">All time</button>
            <button type="button" class="btn btn-secondary" data-an="month">This month</button>
            <button type="button" class="btn btn-secondary" data-an="30">Last 30 days</button>
            <button type="button" class="btn btn-secondary" data-an="7">Last 7 days</button>
        </div>
        <p class="ss-note">${a.receipts ? `${esc(longDate(a.from))} to ${esc(longDate(a.to))}, ${a.activeDays} day${a.activeDays === 1 ? "" : "s"} with receipts.` : "No receipts in this period."} Void / not-used PR numbers are not counted as sales.</p>
        <div class="an-cards">
            ${card("Total sales", peso(a.total), `Cash ${peso(a.cash)} &middot; Online ${peso(a.online)} (${onlinePct}%)`)}
            ${card("Receipts", num(a.receipts), `${num(a.units)} units sold`)}
            ${card("Average receipt", peso(a.avgReceipt), `${num(a.avgItems)} items per receipt`)}
            ${card("Best day", a.bestDay ? peso(a.bestDay.total) : "-", a.bestDay ? `${esc(longDate(a.bestDay.date))}, ${a.bestDay.receipts} receipts` : "")}
            ${card("Biggest receipt", a.biggest ? peso(a.biggest.total) : "-", a.biggest ? `PR ${esc(a.biggest.pr)}, ${esc(a.biggest.buyer)}` : "")}
            ${card("PR numbers", a.marks.missing ? `${a.marks.missing} missing` : "None missing", `${a.marks.void} void &middot; ${a.marks.unused} not used &middot; ${a.marks.missing} missing (all time)`)}
        </div>
        <h2>Sales trend</h2>${trendChart(a.days)}
        <div class="an-grid2">
            <div><h2>By category</h2>${barList(a.categories.filter(c => c.total > 0).sort((x, y) => y.total - x.total).map(c => ({ label: c.category, ...c })), r => r.total, r => `${peso(r.total)} <small>${Number(r.share.toFixed(1))}% &middot; ${num(r.units)} units</small>`)}</div>
            <div><h2>By payment method</h2>${barList(a.methods.map(m => ({ label: m.method, ...m })), r => r.total, r => `${peso(r.total)} <small>${Number(r.share.toFixed(1))}%</small>`, "alt")}</div>
        </div>
        ${a.channels.length ? `<h2>Online payments by channel${a.channelsNone > 0 ? ` <small class="an-h2-sub">${peso(a.channelsNone)} online without a channel</small>` : ""}</h2>
        ${barList(a.channels.map(c => ({ label: c.channel, ...c })), r => r.total, r => `${peso(r.total)} <small>${Number(r.share.toFixed(1))}%</small>`, "alt")}` : ""}
        <h2>Busiest weekdays <small class="an-h2-sub">average sales per day that had receipts${wdBest && wdBest.avg ? `, best: ${WEEKDAYS[wdBest.day]}` : ""}</small></h2>
        ${barList(a.weekdays.map(w => ({ label: WEEKDAYS[w.day], ...w })), r => r.avg, r => r.activeDays ? `${peso(r.avg)} <small>${r.activeDays} day${r.activeDays === 1 ? "" : "s"}</small>` : `<small>-</small>`, "alt")}
        <h2>Top items <small class="an-h2-sub">by sales amount</small></h2>
        ${barList(a.topItems.slice(0, 10).map(i => ({ label: i.desc, ...i })), r => r.total, r => `${peso(r.total)} <small>${num(r.qty)} sold</small>`)}`;

    const set = patch => renderAnalytics(el, entries, marks, { ...state, ...patch });
    el.querySelector("#anFrom").addEventListener("change", e => set({ from: e.target.value }));
    el.querySelector("#anTo").addEventListener("change", e => set({ to: e.target.value }));
    el.querySelectorAll("[data-an]").forEach(b => b.addEventListener("click", () => {
        const k = b.dataset.an;
        if (k === "all") set({ from: "", to: "" });
        else if (k === "month") set({ from: today.slice(0, 8) + "01", to: "" });
        else set({ from: shift(today, -(Number(k) - 1)), to: "" });
    }));
}

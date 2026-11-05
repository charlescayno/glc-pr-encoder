// Pure logic (no DOM, no Firebase) so it can be unit-tested in Node.

export function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function money(n) {
    return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// "2026-09-13" -> "09-13-2026"
export function fmtDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-');
    return `${m}-${d}-${y}`;
}

export function mopText(e) {
    const mop = (e.mop || '').trim();
    const ref = (e.mopRef || '').trim();
    if (!mop) return ref ? `REF # ${ref}` : '';
    return ref ? `${mop.toUpperCase()} REF # ${ref}` : mop;
}

export function entryTotal(e) {
    return round2((e.items || []).reduce((s, it) => s + round2(it.qty * it.price), 0));
}

export function sortEntries(entries) {
    return [...entries].sort((a, b) => Number(a.pr) - Number(b.pr));
}

export function filterEntries(entries, { q = '', from = '', to = '' } = {}) {
    const needle = q.trim().toLowerCase();
    return entries.filter(e => {
        if (from && e.date < from) return false;
        if (to && e.date > to) return false;
        if (!needle) return true;
        const hay = [e.pr, e.buyer, mopText(e), fmtDate(e.date), ...(e.items || []).map(i => i.desc)]
            .join(' ').toLowerCase();
        return hay.includes(needle);
    });
}

// One output row per line item. Grand total is cumulative per line, as in the spreadsheet.
export function flatten(entries) {
    const rows = [];
    let grand = 0;
    for (const e of sortEntries(entries)) {
        (e.items || []).forEach((it, idx) => {
            const total = round2(it.qty * it.price);
            grand = round2(grand + total);
            rows.push({
                entry: e,
                first: idx === 0,
                date: fmtDate(e.date),
                pr: e.pr,
                buyer: e.buyer,
                desc: it.desc,
                qty: it.qty,
                price: it.price,
                total,
                grand,
                mop: mopText(e),
            });
        });
    }
    return rows;
}

const HEAD = ['DATE', 'PR NUMBER', 'BUYER', 'SOLD ITEMS', 'QTY', 'UNIT PRICE', 'TOTAL', 'GRAND TOTAL', 'MOP'];

function tableCells(rows) {
    return rows.map(r => [
        r.first ? r.date : '',
        r.first ? r.pr : '',
        r.first ? r.buyer : '',
        r.desc,
        r.qty,
        money(r.price),
        money(r.total),
        money(r.grand),
        r.first ? r.mop : '',
    ]);
}

export function toTSV(rows) {
    const clean = s => String(s).replace(/[\t\r\n]+/g, ' ');
    return [HEAD, ...tableCells(rows)].map(r => r.map(clean).join('\t')).join('\n');
}

export function toCSV(rows) {
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    return [HEAD, ...tableCells(rows)].map(r => r.map(q).join(',')).join('\r\n');
}

export function nextPr(entries) {
    const nums = entries.map(e => Number(e.pr)).filter(n => Number.isFinite(n));
    return nums.length ? Math.max(...nums) + 1 : 1;
}

// Returns { duplicate: bool, gap: bool, expected: number }
export function checkPr(entries, pr, editingId = null) {
    const n = Number(pr);
    const duplicate = entries.some(e => Number(e.pr) === n && e.id !== editingId);
    const expected = nextPr(entries.filter(e => e.id !== editingId));
    const gap = !duplicate && Number.isFinite(n) && n > expected;
    return { duplicate, gap, expected };
}

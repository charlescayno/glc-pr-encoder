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

// One payment line, e.g. "Cash 150.00" or "INVOICE REF # 689746 250.00"
export function paymentText(p) {
    const ref = (p.ref || '').trim();
    const label = p.method === 'Cash' ? 'Cash' : (ref ? `${p.method.toUpperCase()} REF # ${ref}` : p.method);
    return `${label} ${money(p.amount)}`;
}

// A split PR (part cash, part online) keeps its payments in e.payments.
export function mopText(e) {
    if (Array.isArray(e.payments) && e.payments.length) return e.payments.map(paymentText).join(' + ');
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

// A PR booklet is 50 sheets: 42701-42750, 42751-42800, ...
export const BOOKLET_SIZE = 50;

export function bookletStart(pr) {
    return Math.floor((Number(pr) - 1) / BOOKLET_SIZE) * BOOKLET_SIZE + 1;
}

export function bookletLabel(start) {
    return `${start} - ${start + BOOKLET_SIZE - 1}`;
}

// Usage of one booklet: how many sheets are encoded and which numbers are missing
// (missing = unused numbers up to the highest encoded sheet in that booklet).
export function bookletStats(entries, start) {
    const nums = entries.map(e => Number(e.pr)).filter(n => bookletStart(n) === start);
    const used = new Set(nums);
    const highest = nums.length ? Math.max(...nums) : start - 1;
    const missing = [];
    for (let n = start; n <= highest; n++) if (!used.has(n)) missing.push(n);
    return { start, end: start + BOOKLET_SIZE - 1, used: used.size, missing, complete: used.size === BOOKLET_SIZE };
}

export function bookletStarts(entries) {
    return [...new Set(entries.map(e => bookletStart(e.pr)))].sort((a, b) => a - b);
}

// ---- Item shorthand ----------------------------------------------------------------
// Every catalog item gets automatic codes, e.g.
//   "Gospel Tracts English (New)"   -> gte   (initials, text in brackets ignored)
//   "GLC Book 7: The Family Life"   -> b7
//   "GLC Book 5: Starting Point (Old)" -> b5o  (book number + bracket initial)
//   "GLC Book 1: Filipino One by One"  -> fb1
// plus an optional custom code typed in the catalog editor.
function itemAutoCodes(desc) {
    const paren = (/\(([^)]*)\)/.exec(desc) || [])[1] || '';
    const main = desc.replace(/\([^)]*\)/g, ' ').trim();
    const words = main.split(/[\s:]+/).filter(Boolean);
    const initials = words.map(w => w[0].toLowerCase()).join('');
    const pi = paren ? paren.trim()[0].toLowerCase() : '';
    const codes = new Set([initials]);
    if (words[0] && words[0].toLowerCase() === 'glc') codes.add(words.slice(1).map(w => w[0].toLowerCase()).join(''));
    if (pi) codes.add(initials + pi);
    const book = /book\s+(\d+)/i.exec(main);
    if (book) {
        const base = (/filipino/i.test(main) ? 'fb' : 'b') + book[1];
        codes.add(base);
        if (pi) codes.add(base + pi);
    }
    return { codes: [...codes].filter(Boolean), hasParen: !!paren };
}

const normCode = s => String(s || '').toLowerCase().replace(/[\s\-_.]+/g, '');

// Returns { status: 'none' | 'one' | 'many', items: [catalogItem...] }
export function resolveShortcut(catalog, text) {
    const t = normCode(text);
    if (!t) return { status: 'none', items: [] };
    // An exact item name always wins over a code.
    if (catalog.some(c => c.desc.trim().toLowerCase() === String(text).trim().toLowerCase())) return { status: 'none', items: [] };
    const custom = catalog.filter(c => normCode(c.code) === t);
    if (custom.length) return { status: custom.length === 1 ? 'one' : 'many', items: custom };
    let hits = catalog.filter(c => itemAutoCodes(c.desc).codes.includes(t));
    if (hits.length > 1) {
        const plain = hits.filter(c => !itemAutoCodes(c.desc).hasParen);
        if (plain.length === 1) hits = plain; // "b7" -> the plain item rather than "(New)"
    }
    return { status: hits.length === 0 ? 'none' : hits.length === 1 ? 'one' : 'many', items: hits };
}

// Cash vs online split of flattened rows. Online = every non-cash MOP (Invoice, GCash, Maya, Bank Transfer, ...).
// An empty MOP (older receipts) counts as cash.
// Split PRs add each payment's own amount to cash or online.
export function paymentSplit(rows) {
    const out = { cash: 0, online: 0, byMethod: {} };
    const add = (m, amount) => {
        out.byMethod[m] = round2((out.byMethod[m] || 0) + amount);
        if (m === 'Cash') out.cash = round2(out.cash + amount);
        else out.online = round2(out.online + amount);
    };
    const seen = new Set();
    for (const r of rows) {
        const e = r.entry;
        if (Array.isArray(e.payments) && e.payments.length) {
            if (seen.has(e)) continue; // count a split PR once, not once per line item
            seen.add(e);
            e.payments.forEach(p => add((p.method || '').trim() || 'Cash', Number(p.amount) || 0));
        } else {
            add((e.mop || '').trim() || 'Cash', r.total);
        }
    }
    return out;
}

export function filterEntries(entries, { q = '', from = '', to = '', booklet = '' } = {}) {
    const needle = q.trim().toLowerCase();
    return entries.filter(e => {
        if (booklet && bookletStart(e.pr) !== Number(booklet)) return false;
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
    const gap = !duplicate && Number.isFinite(n) && n > expected && entries.length > 0;
    return { duplicate, gap, expected };
}

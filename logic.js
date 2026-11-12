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
    const bank = p.method === 'Bank Transfer' && p.bank ? ` - ${String(p.bank).trim()}` : '';
    const label = p.method === 'Cash' ? 'Cash' : (ref ? `${p.method.toUpperCase()}${bank} REF # ${ref}` : p.method + bank);
    return `${label} ${money(p.amount)}`;
}

// A split PR (part cash, part online) keeps its payments in e.payments.
export function mopText(e) {
    if (Array.isArray(e.payments) && e.payments.length) return e.payments.map(paymentText).join(' + ');
    const mop = (e.mop || '').trim();
    const ref = (e.mopRef || '').trim();
    if (!mop) return ref ? `REF # ${ref}` : '';
    const bank = mop === 'Bank Transfer' && e.mopBank ? ` - ${String(e.mopBank).trim()}` : '';
    return ref ? `${mop.toUpperCase()}${bank} REF # ${ref}` : mop + bank;
}

export function entryTotal(e) {
    return round2((e.items || []).reduce((s, it) => s + round2(it.qty * it.price), 0));
}

export function sortEntries(entries) {
    return [...entries].sort((a, b) => Number(a.pr) - Number(b.pr));
}

// Amount in words for the "Received the Amount of" line: 120 -> "One hundred twenty pesos only"
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function wordsBelow1000(n) {
    const parts = [];
    if (n >= 100) { parts.push(ONES[Math.floor(n / 100)] + ' hundred'); n %= 100; }
    if (n >= 20) { parts.push(TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '')); }
    else if (n > 0) parts.push(ONES[n]);
    return parts.join(' ');
}
export function pesoWords(amount) {
    const total = Math.round(Number(amount || 0) * 100);
    let pesos = Math.floor(total / 100);
    const cents = total % 100;
    let words = '';
    if (pesos === 0) words = 'zero';
    else {
        const scales = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [1, '']];
        const out = [];
        for (const [size, name] of scales) {
            const chunk = Math.floor(pesos / size);
            if (chunk > 0) { out.push(wordsBelow1000(chunk) + (name ? ' ' + name : '')); pesos %= size; }
        }
        words = out.join(' ');
    }
    const head = words.charAt(0).toUpperCase() + words.slice(1);
    const unit = Math.floor(total / 100) === 1 ? 'peso' : 'pesos';
    return cents ? `${head} ${unit} and ${String(cents).padStart(2, '0')}/100 only` : `${head} ${unit} only`;
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
// `marks` (void / not used sheets found during review) are no longer counted as missing.
export function bookletStats(entries, start, marks = []) {
    const nums = entries.map(e => Number(e.pr)).filter(n => bookletStart(n) === start);
    const used = new Set(nums);
    const marked = new Set(marks.map(m => Number(m.pr)));
    const highest = nums.length ? Math.max(...nums) : start - 1;
    const missing = [];
    for (let n = start; n <= highest; n++) if (!used.has(n) && !marked.has(n)) missing.push(n);
    return { start, end: start + BOOKLET_SIZE - 1, used: used.size, missing, complete: used.size === BOOKLET_SIZE };
}

// ---- Review: walk through every PR number of a booklet ----------------------------------
// Each item is one PR number from the first sheet up to the highest one encoded or marked:
//   type 'entry'   an encoded PR (checked = verified against the paper sheet)
//   type 'mark'    a number the reviewer marked 'void' or 'unused'
//   type 'missing' a number with no entry and no mark yet (the review stops on it)
export function reviewSequence(entries, marks, start) {
    const end = start + BOOKLET_SIZE - 1;
    const byPr = new Map(entries.filter(e => bookletStart(e.pr) === start).map(e => [Number(e.pr), e]));
    const markByPr = new Map(marks.filter(m => bookletStart(m.pr) === start).map(m => [Number(m.pr), m]));
    const nums = [...byPr.keys(), ...markByPr.keys()];
    if (!nums.length) return [];
    const highest = Math.min(Math.max(...nums), end);
    const seq = [];
    for (let n = start; n <= highest; n++) {
        if (byPr.has(n)) {
            const entry = byPr.get(n);
            seq.push({ pr: n, type: 'entry', entry, checked: !!entry.checkedAt, resolved: !!entry.checkedAt });
        } else if (markByPr.has(n)) {
            seq.push({ pr: n, type: 'mark', mark: markByPr.get(n), status: markByPr.get(n).status, resolved: true });
        } else {
            seq.push({ pr: n, type: 'missing', resolved: false });
        }
    }
    return seq;
}

export function reviewProgress(seq) {
    const entries = seq.filter(s => s.type === 'entry');
    const checked = entries.filter(s => s.checked).length;
    const marks = seq.filter(s => s.type === 'mark').length;
    const missing = seq.filter(s => s.type === 'missing').length;
    const times = [
        ...entries.filter(s => s.checked).map(s => s.entry.checkedAt),
        ...seq.filter(s => s.type === 'mark').map(s => s.mark.at || 0),
    ];
    return {
        total: seq.length, entries: entries.length, checked, marks, missing,
        unchecked: entries.length - checked,
        done: seq.length > 0 && seq.every(s => s.resolved),
        lastAt: times.length ? Math.max(...times) : 0,
    };
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

// The shorthand to show next to an item: the custom code if it has one, else the shortest automatic code that picks only this item.
export function itemShortcut(catalog, item) {
    const { codes, hasParen } = itemAutoCodes(item.desc);
    const book = /book\s+(\d+)/i.exec(item.desc.replace(/\([^)]*\)/g, ' '));
    const pref = [];
    if (item.code) pref.push(item.code);
    if (book) {
        const base = (/filipino/i.test(item.desc) ? 'fb' : 'b') + book[1];
        pref.push(...(hasParen ? codes.filter(c => c.startsWith(base) && c !== base) : [base]), base);
    }
    pref.push(...codes);
    const hit = pref.find(c => { const r = resolveShortcut(catalog, c); return r.items.length === 1 && r.items[0] === item; });
    return hit || pref.find(Boolean) || '';
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

export function filterEntries(entries, { q = '', from = '', to = '', booklet = '', unchecked = false } = {}) {
    const needle = q.trim().toLowerCase();
    return entries.filter(e => {
        if (unchecked && e.checkedAt) return false;
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
                category: prCategory(e),
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
    return rows.map(r => r.mark ? ['', r.pr, '', markLabel(r.status), '', '', '', '', ''] : [
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

// Next PR number to encode: one past the highest number that was encoded OR marked void / not used.
export function nextPr(entries, marks = []) {
    const nums = [...entries, ...marks].map(e => Number(e.pr)).filter(n => Number.isFinite(n));
    return nums.length ? Math.max(...nums) + 1 : 1;
}

// First number at or after n that is not already marked void / not used.
export function skipMarked(n, marks = []) {
    const taken = new Set(marks.map(m => Number(m.pr)));
    while (taken.has(n)) n++;
    return n;
}

export function markLabel(status) { return status === 'void' ? 'VOID' : 'NOT USED'; }

// Returns { duplicate, gap, expected, marked }. marked is 'void' / 'unused' when that number was marked.
export function checkPr(entries, pr, editingId = null, marks = []) {
    const n = Number(pr);
    const duplicate = entries.some(e => Number(e.pr) === n && e.id !== editingId);
    const expected = nextPr(entries.filter(e => e.id !== editingId), marks);
    const gap = !duplicate && Number.isFinite(n) && n > expected && entries.length > 0;
    const m = marks.find(x => Number(x.pr) === n);
    return { duplicate, gap, expected, marked: m ? m.status : null };
}

// Insert void / not-used numbers between the receipt rows, in PR order (they carry no amounts).
export function withMarks(rows, marks, { booklet = '' } = {}) {
    const have = new Set(rows.map(r => Number(r.pr)));
    const extra = marks
        .filter(m => !have.has(Number(m.pr)) && (!booklet || bookletStart(m.pr) === Number(booklet)))
        .map(m => ({ mark: true, pr: Number(m.pr), status: m.status, at: m.at }));
    return [...rows, ...extra].sort((a, b) => Number(a.pr) - Number(b.pr));
}
// Parse rows pasted from the spreadsheet (tab separated, same columns as the output table).
// Rows without a PR number continue the previous receipt. Totals and header rows are ignored.
export function parseSheet(text) {
    const out = [];
    let cur = null;
    const skipped = [];
    const num = s => Number(String(s).replace(/[,\s\u20B1]/g, ''));
    for (const raw of String(text || '').split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const c = raw.split('\t').map(s => s.trim());
        if (/^date$/i.test(c[0]) || /pr\s*number/i.test(c[1] || '')) continue;
        const [d, pr, buyer, desc, qty, price, , , mop] = c;
        const m = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(d || '');
        if (/^\d+$/.test(pr || '') && m) {
            cur = {
                id: `pr_${Number(pr)}`, pr: Number(pr),
                date: `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`,
                buyer: !buyer || /^an+onymous$/i.test(buyer) ? 'Anonymous' : buyer,
                mop: 'Cash', mopRef: '', items: [],
            };
            out.push(cur);
        } else if (!cur || !desc) {
            if (!desc) { skipped.push(raw); continue; }
        }
        if (!cur || !desc) continue;
        const q = num(qty), p = num(price);
        if (!(q > 0) || !Number.isFinite(p)) { skipped.push(raw); continue; }
        cur.items.push({ desc, qty: q, price: p });
        if (mop && cur.mop === 'Cash') {
            const r = /^(invoice|gcash|bank[^\s]*)?\s*(?:ref(?:erence)?\.?)?\s*(?:no\.?|#)?\s*(.*)$/i.exec(mop);
            const kind = /^gcash/i.test(mop) ? 'GCash' : /^bank/i.test(mop) ? 'Bank Transfer' : 'Invoice';
            cur.mop = kind;
            cur.mopRef = (/^(invoice|gcash|bank)/i.test(mop) ? mop.replace(/^\S+\s*(ref(erence)?\.?)?\s*(no\.?|#)?\s*/i, '') : mop).trim();
        }
    }
    return { entries: out, skipped };
}

// End-of-review summary: items sold in the booklet, split into CASH and ONLINE PAYMENT (anything not cash),
// grouped by item + selling price. For a split PR the cash amount is filled first, in item order,
// and the remaining quantity goes online.
export function bookletSummary(entries) {
    const sorted = sortEntries(entries);
    const sections = { cash: new Map(), online: new Map() };
    const add = (kind, desc, price, qty) => {
        if (!(qty > 0)) return;
        const key = desc + '\u0000' + price;
        const m = sections[kind];
        const cur = m.get(key) || { desc, price, qty: 0 };
        cur.qty = Math.round((cur.qty + qty) * 100) / 100;
        m.set(key, cur);
    };
    for (const e of sorted) {
        const pays = Array.isArray(e.payments) && e.payments.length ? e.payments : null;
        if (!pays) {
            const kind = !(e.mop || '').trim() || e.mop === 'Cash' ? 'cash' : 'online';
            (e.items || []).forEach(i => add(kind, i.desc, i.price, i.qty));
            continue;
        }
        let cashLeft = pays.filter(p => !p.method || p.method === 'Cash').reduce((s, p) => round2(s + (Number(p.amount) || 0)), 0);
        for (const i of e.items || []) {
            const lineTotal = round2(i.qty * i.price);
            const takeCash = Math.min(lineTotal, cashLeft);
            cashLeft = round2(cashLeft - takeCash);
            const cashQty = i.price > 0 ? Math.round((takeCash / i.price) * 100) / 100 : 0;
            add('cash', i.desc, i.price, cashQty);
            add('online', i.desc, i.price, Math.round((i.qty - cashQty) * 100) / 100);
        }
    }
    const finish = m => {
        const rows = [...m.values()].sort((a, b) => a.desc.localeCompare(b.desc) || a.price - b.price)
            .map(r => ({ ...r, total: round2(r.qty * r.price) }));
        return { rows, total: round2(rows.reduce((s, r) => s + r.total, 0)) };
    };
    const prs = sorted.map(e => Number(e.pr));
    const dates = sorted.map(e => e.date).filter(Boolean).sort();
    const md = iso => { const [y, m, d] = iso.split('-'); return `${Number(m)}/${Number(d)}/${y}`; };
    return {
        cash: finish(sections.cash),
        online: finish(sections.online),
        firstPr: prs.length ? Math.min(...prs) : null,
        lastPr: prs.length ? Math.max(...prs) : null,
        dateRange: dates.length ? (dates[0] === dates[dates.length - 1] ? md(dates[0]) : `${md(dates[0])} \u2013 ${md(dates[dates.length - 1])}`) : '',
    };
}

// Same summary as tab-separated text, ready to paste into Excel / Google Sheets.
export function summaryTSV(s) {
    const qty = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 });
    const block = (title, sec) => [
        [title], ['Item', 'QTY', 'Selling Price', 'Total'],
        ...sec.rows.map(r => [r.desc, qty(r.qty), money(r.price), money(r.total)]),
        ['TOTAL', '', '', money(sec.total)], [],
    ];
    return [[`PR No.: ${s.firstPr}-${s.lastPr}`, '', '', `Date: ${s.dateRange}`], [],
        ...block('CASH', s.cash), ...block('ONLINE PAYMENT', s.online),
        ...(s.voidText ? [['VOID', s.voidText]] : []), ...(s.unusedText ? [['NOT USED', s.unusedText]] : [])].map(r => r.join('\t')).join('\n');
}

// "42746, 42747, 42748, 42750" -> "42746-42748, 42750"
export function compressRanges(nums) {
    const a = [...new Set(nums.map(Number))].sort((x, y) => x - y);
    const out = [];
    for (let i = 0; i < a.length;) {
        let j = i;
        while (j + 1 < a.length && a[j + 1] === a[j] + 1) j++;
        out.push(j > i ? `${a[i]}-${a[j]}` : String(a[i]));
        i = j + 1;
    }
    return out.join(', ');
}

// Void / not-used numbers of one booklet, as ready-to-show text ('' when none).
export function markSummary(marks, start) {
    const inBook = marks.filter(m => bookletStart(m.pr) === start);
    const pick = s => inBook.filter(m => m.status === s).map(m => m.pr);
    const v = pick('void'), u = pick('unused');
    return { void: v, unused: u, voidText: compressRanges(v), unusedText: compressRanges(u) };
}

// Book cover colors, so every item name can be shown in the color of its book (null = no special color).
const BOOK_COLORS = {
    1: '#C9A21B', 2: '#5E9A27', 3: '#A8174F', 4: '#0A6CB8', 5: '#D9701E', 6: '#4A2D63',
    7: '#11788A', 9: '#0B7A5C', 10: '#A85A10', 11: '#5A1818', 12: '#12304F',
};
export function itemColor(desc) {
    const s = String(desc || '');
    const m = /\bbook\s*(\d+)\b/i.exec(s);
    if (m) return BOOK_COLORS[Number(m[1])] || null;
    if (/gospel\s*tract/i.test(s)) return '#1B8EA0';
    if (/life\s*goals/i.test(s)) return '#6B7280';
    return null;
}

// ---- Weekly / monthly sales summary ------------------------------------------------------
// Groups the sheet categories of the "Weekly Inventory & Sales Monitoring Sheet".
export function salesCategory(desc) {
    const s = String(desc || '');
    if (/jacket|polo|t[\s-]*shirt/i.test(s) && !/\btlr\b|true\s*life/i.test(s)) return 'MERCH';
    if (/gospel\s*tract/i.test(s)) return 'GOSPEL TRACTS';
    if (/\bbook\s*\d+|\bglc\s*book/i.test(s) && !/motivate/i.test(s)) return 'GLC BOOKS';
    return 'DISCIPLESHIP MATERIALS';
}
export const SALES_CATEGORIES = ['GLC BOOKS', 'GOSPEL TRACTS', 'DISCIPLESHIP MATERIALS', 'MERCH'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const isoOf = d => d.toISOString().slice(0, 10);
const utc = iso => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const shortDate = iso => { const [y, m, d] = iso.split('-').map(Number); return `${MONTHS[m - 1].slice(0, 3)} ${d}`; };

// A week runs Sunday to Saturday. Returns { key, from, to, label } for the period holding iso.
export function periodOf(iso, kind) {
    const d = utc(iso);
    if (kind === 'month') {
        const from = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
        const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
        return { key: isoOf(from), from: isoOf(from), to: isoOf(to), label: `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}` };
    }
    const from = new Date(d); from.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const to = new Date(from); to.setUTCDate(from.getUTCDate() + 6);
    return { key: isoOf(from), from: isoOf(from), to: isoOf(to), label: `${shortDate(isoOf(from))} \u2013 ${shortDate(isoOf(to))}, ${to.getUTCFullYear()}` };
}

// Sales per week ('week') or per month ('month'), oldest first. Void / not-used numbers carry no entry, so they are never counted.
// Each period: receipts (PR count), units (items sold), cash, online, total, per-category and per-item breakdown.
export function salesSummary(entries, kind = 'week') {
    const groups = new Map();
    for (const e of entries) {
        if (!e.date) continue;
        const p = periodOf(e.date, kind);
        if (!groups.has(p.key)) groups.set(p.key, { ...p, entries: [] });
        groups.get(p.key).entries.push(e);
    }
    return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).map(g => {
        const rows = flatten(g.entries);
        const split = paymentSplit(rows);
        const cats = new Map(SALES_CATEGORIES.map(c => [c, { category: c, units: 0, total: 0 }]));
        const items = new Map();
        let units = 0;
        for (const r of rows) {
            units = round2(units + r.qty);
            const c = cats.get(salesCategory(r.desc));
            c.units = round2(c.units + r.qty); c.total = round2(c.total + r.total);
            const it = items.get(r.desc) || { desc: r.desc, category: salesCategory(r.desc), qty: 0, total: 0 };
            it.qty = round2(it.qty + r.qty); it.total = round2(it.total + r.total);
            items.set(r.desc, it);
        }
        const prs = g.entries.map(e => Number(e.pr));
        return {
            key: g.key, from: g.from, to: g.to, label: g.label,
            receipts: g.entries.length, firstPr: Math.min(...prs), lastPr: Math.max(...prs),
            units, cash: split.cash, online: split.online, total: round2(split.cash + split.online),
            categories: [...cats.values()],
            items: [...items.values()].sort((a, b) => SALES_CATEGORIES.indexOf(a.category) - SALES_CATEGORIES.indexOf(b.category) || a.desc.localeCompare(b.desc)),
        };
    });
}

export function salesSummaryCSV(periods, kind = 'week') {
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const head = [kind === 'month' ? 'MONTH' : 'WEEK', 'RECEIPTS', 'UNITS SOLD', ...SALES_CATEGORIES.map(c => c + ' (UNITS)'), 'CASH', 'ONLINE', 'TOTAL SALES'];
    const line = p => [p.label, p.receipts, p.units, ...p.categories.map(c => c.units), p.cash.toFixed(2), p.online.toFixed(2), p.total.toFixed(2)];
    const sum = f => round2(periods.reduce((s, p) => s + f(p), 0));
    const total = ['TOTAL', sum(p => p.receipts), sum(p => p.units), ...SALES_CATEGORIES.map((_, i) => sum(p => p.categories[i].units)),
        sum(p => p.cash).toFixed(2), sum(p => p.online).toFixed(2), sum(p => p.total).toFixed(2)];
    return [head, ...periods.map(line), total].map(r => r.map(q).join(',')).join('\r\n');
}

// ---- Monitoring sheet layout: CATEGORY | DESCRIPTION rows, one column per week / month ------------
const SIZES = ['Small', 'Medium', 'Large', 'XL', '2XL', '3XL', '4XL'];
const sized = (cat, name, sizes) => sizes.map(s => ({ category: cat, desc: `${name} - ${s}` }));
export const SHEET_ROWS = [
    ...[
        'GLC Book 1: One by One (NEW)', 'GLC Book 1: One by One (OLD)', 'GLC Book 2: Spiritual Disciplines (NEW)', 'GLC Book 2: Spiritual Disciplines (OLD)',
        'GLC Book 3: The Holy Spirit', 'GLC Book 4: CCF DNA (NEW)', 'GLC Book 4: CCF DNA (OLD)', 'GLC Book 5: Starting Point for small group (NEW)',
        'GLC Book 5: Starting Point for small group (OLD)', 'GLC Book 6: Basic Doctrine', 'GLC Book 7: The Family Life (NEW)', 'GLC Book 7: The Family Life (OLD)',
        'GLC Book 9: The Multiplier', 'GLC Book 10: Reliability of the Bible', 'GLC Book 11: Spiritual Warfare', 'GLC Book 12: Leadership Skills',
        'GLC Book 1 (Filipino): One by One', 'GLC Book 2 (Filipino): Spiritual Disciple', 'GLC Book 4 (Filipino): CCF DNA',
    ].map(desc => ({ category: 'GLC BOOKS', desc })),
    ...['Gospel Tract Tagalog', 'Gospel Tract English', 'Gospel Tract (Elevate/LMMR)'].map(desc => ({ category: 'GOSPEL TRACTS', desc })),
    ...[
        'PCS Bookmark', 'PCS Card', 'Holy Spirit Booklet', 'Life Goals Magazine', 'Memory Verse Booklet (Volume 2)', 'Real Talk Booklet', 'Heart Of A Champion',
        'Dgroup Kit', '70X7 Workbook', '70X7 USB', 'Accountability Card', 'Discipleship Covenant Card', 'DJ Passport', 'Motivate Book (Chinese)',
        'Motivate Book (English)', 'Dare 2 Share', 'Superbook Workbook', '2Be1 Workbook', 'TLR Workbook (Facilitator)', 'TLR Workbook (Participant)',
    ].map(desc => ({ category: 'DISCIPLESHIP MATERIALS', desc })),
    ...sized('DISCIPLESHIP MATERIALS', 'TLR Shirt', ['Small', 'Medium', 'Large', 'XL', '2XL', '3XL']),
    ...sized('MERCH', 'BLACK GLC Jacket', SIZES),
    ...sized('MERCH', 'GRAY GLC Polo Shirt', SIZES.slice(0, 6)),
    ...sized('MERCH', 'GREEN GLC Polo Shirt', SIZES.slice(0, 6)),
    ...sized('MERCH', 'BLUE GLC T SHIRT', SIZES.slice(0, 4)),
];

const BOOK_TITLES = {
    3: 'GLC Book 3: The Holy Spirit', 6: 'GLC Book 6: Basic Doctrine', 9: 'GLC Book 9: The Multiplier', 10: 'GLC Book 10: Reliability of the Bible',
    11: 'GLC Book 11: Spiritual Warfare', 12: 'GLC Book 12: Leadership Skills',
};
const BOOK_NEWOLD = {
    1: 'GLC Book 1: One by One', 2: 'GLC Book 2: Spiritual Disciplines', 4: 'GLC Book 4: CCF DNA',
    5: 'GLC Book 5: Starting Point for small group', 7: 'GLC Book 7: The Family Life',
};
const FIL_TITLES = { 1: 'GLC Book 1 (Filipino): One by One', 2: 'GLC Book 2 (Filipino): Spiritual Disciple', 4: 'GLC Book 4 (Filipino): CCF DNA' };

function sizeOf(s) {
    const t = s.toLowerCase();
    if (/\b4\s*xl\b/.test(t)) return '4XL';
    if (/\b3\s*xl\b/.test(t)) return '3XL';
    if (/\b2\s*xl\b/.test(t)) return '2XL';
    if (/\bxl\b|extra\s*large/.test(t)) return 'XL';
    if (/\bsmall\b|\(s\)|\bsm\b/.test(t)) return 'Small';
    if (/\bmedium\b|\(m\)|\bmed\b/.test(t)) return 'Medium';
    if (/\blarge\b|\(l\)/.test(t)) return 'Large';
    return '';
}

// Maps a receipt item name to the description used on the monitoring sheet, or null when it is not on the sheet.
// A book without "(old)" or "(new)" in its name is counted as NEW.
export function sheetDescFor(desc) {
    const s = String(desc || '');
    const t = s.toLowerCase();
    const book = /\bbook\s*(\d+)\b/.exec(t);
    if (book && !/motivate/.test(t)) {
        const n = Number(book[1]);
        if (/filipino|\bfil\b/.test(t)) return FIL_TITLES[n] || null;
        if (BOOK_TITLES[n]) return BOOK_TITLES[n];
        if (BOOK_NEWOLD[n]) return `${BOOK_NEWOLD[n]} (${/\bold\b/.test(t) ? 'OLD' : 'NEW'})`;
        return null;
    }
    if (/gospel\s*tract/.test(t)) return /elevate|lmmr/.test(t) ? 'Gospel Tract (Elevate/LMMR)' : /tagalog/.test(t) ? 'Gospel Tract Tagalog' : 'Gospel Tract English';
    const size = sizeOf(s);
    if ((/\btlr\b|true\s*life/.test(t)) && /shirt/.test(t)) return size && SIZES.indexOf(size) < 6 ? `TLR Shirt - ${size}` : null;
    if (/jacket/.test(t)) return size ? `BLACK GLC Jacket - ${size}` : null;
    if (/polo/.test(t)) { const c = /gr[ae]y/.test(t) ? 'GRAY' : /green/.test(t) ? 'GREEN' : ''; return c && size && SIZES.indexOf(size) < 6 ? `${c} GLC Polo Shirt - ${size}` : null; }
    if (/t[\s-]*shirt/.test(t) && /blue/.test(t)) return size && SIZES.indexOf(size) < 4 ? `BLUE GLC T SHIRT - ${size}` : null;
    const rules = [
        [/bookmark/, 'PCS Bookmark'], [/pcs\s*card/, 'PCS Card'], [/holy\s*spirit\s*booklet/, 'Holy Spirit Booklet'], [/life\s*goals/, 'Life Goals Magazine'],
        [/memory\s*verse/, 'Memory Verse Booklet (Volume 2)'], [/real\s*talk/, 'Real Talk Booklet'], [/heart\s*of\s*a\s*champion/, 'Heart Of A Champion'],
        [/d-?group\s*kit/, 'Dgroup Kit'], [/70\s*x\s*7.*usb|usb.*70\s*x\s*7/, '70X7 USB'], [/70\s*x\s*7/, '70X7 Workbook'],
        [/accountability/, 'Accountability Card'], [/discipleship\s*covenant/, 'Discipleship Covenant Card'], [/dj\s*passport/, 'DJ Passport'],
        [/motivate.*chinese|chinese.*motivate/, 'Motivate Book (Chinese)'], [/motivate/, 'Motivate Book (English)'], [/dare\s*2\s*share/, 'Dare 2 Share'],
        [/superbook/, 'Superbook Workbook'], [/2\s*be\s*1/, '2Be1 Workbook'],
        [/facilitator/, 'TLR Workbook (Facilitator)'], [/participant/, 'TLR Workbook (Participant)'],
    ];
    for (const [re, name] of rules) if (re.test(t)) return name;
    return null;
}

// The sheet as a matrix: SHEET_ROWS (plus an OTHER row per unlisted item) x periods, quantities sold per period.
export function salesMatrix(entries, kind = 'week') {
    const periods = salesSummary(entries, kind);
    const known = new Set(SHEET_ROWS.map(r => r.desc));
    const rows = SHEET_ROWS.map(r => ({ ...r, qtys: periods.map(() => 0), total: 0 }));
    const byDesc = new Map(rows.map(r => [r.desc, r]));
    periods.forEach((p, i) => {
        for (const it of p.items) {
            const d = sheetDescFor(it.desc);
            let row = d && known.has(d) ? byDesc.get(d) : null;
            if (!row) {
                const key = 'OTHER:' + it.desc;
                row = byDesc.get(key);
                if (!row) { row = { category: 'OTHER (NOT ON SHEET)', desc: it.desc, qtys: periods.map(() => 0), total: 0 }; byDesc.set(key, row); rows.push(row); }
            }
            row.qtys[i] = round2(row.qtys[i] + it.qty);
            row.total = round2(row.total + it.qty);
        }
    });
    return { periods, rows };
}

export function salesMatrixCSV(m, kind = 'week') {
    const q = s => `"${String(s).replace(/"/g, '""')}"`;
    const head = ['CATEGORY', 'DESCRIPTION', ...m.periods.map(p => p.label), 'TOTAL'];
    const body = m.rows.map(r => [r.category, r.desc, ...r.qtys.map(n => n || ''), r.total || '']);
    const sum = f => round2(m.periods.reduce((s, p) => s + f(p), 0));
    const foot = ['', 'TOTAL UNITS SOLD', ...m.periods.map(p => p.units), sum(p => p.units)];
    const sales = ['', 'TOTAL SALES (PHP)', ...m.periods.map(p => p.total.toFixed(2)), sum(p => p.total).toFixed(2)];
    return [head, ...body, foot, sales].map(r => r.map(q).join(',')).join('\r\n');
}

// ---- Category per PR (CATEGORY column of the final report), from "PROPER ORDER OF GLC ITEMS FOR WEBSITE" ----
// Items on that sheet use its categories. Event payments (e.g. "True Life Payment") are GLC EVENT, anything else is OTHER.
export function itemCategory(desc) {
    const d = sheetDescFor(desc);
    const row = d && SHEET_ROWS.find(r => r.desc === d);
    if (row) return row.category;
    // Not an exact sheet item (e.g. a jacket sold without a size): still group it by what it is.
    if (/jacket|polo|shirt|merch/i.test(String(desc || ''))) return 'MERCH';
    if (/gospel\s*tract/i.test(String(desc || ''))) return 'GOSPEL TRACTS';
    if (/\bbook\s*\d+/i.test(String(desc || ''))) return 'GLC BOOKS';
    if (/payment|event|registration|retreat|conference|seminar/i.test(String(desc || ''))) return 'GLC EVENT';
    return 'OTHER';
}
// One label per receipt. A receipt that mixes categories lists each once, in order, e.g. "GLC BOOKS / MERCH".
export function prCategory(e) {
    const seen = [];
    for (const it of e.items || []) { const c = itemCategory(it.desc); if (!seen.includes(c)) seen.push(c); }
    return seen.join(' / ');
}
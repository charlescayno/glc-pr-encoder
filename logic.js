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

// The online total is one line (no GCash / BDO / No channel rows under it). Set to true to show the per-channel split again in summaries, exports and analytics.
export const SHOW_CHANNEL_TOTALS = false;
// Online payment channels (the sub-option of Online Payment). The list can be extended from the form and is shared across devices.
export const DEFAULT_CHANNELS = ['GCash', 'BPI', 'BDO', 'PSBank', 'Security Bank', 'Maribank', 'Atome', 'GoTyme', 'InstaPay'];
// Channel name as typed -> the one in the list (case-insensitive), or the trimmed text itself.
export function matchChannel(list, name) {
    const t = String(name || '').trim();
    return (list || []).find(c => c.toLowerCase() === t.toLowerCase()) || t;
}

// One payment line, e.g. "Cash 150.00" or "INVOICE REF # 689746 250.00"
export function paymentText(p) {
    const ref = (p.ref || '').trim();
    const bank = p.method === 'Bank Transfer' && p.bank ? ` - ${String(p.bank).trim()}` : (p.channel ? ` - ${String(p.channel).trim()}` : '');
    const label = p.method === 'Cash' ? 'Cash' : (ref ? `${p.method.toUpperCase()}${bank} REF # ${ref}` : p.method + bank);
    return `${label} ${money(p.amount)}`;
}

// A split PR (part cash, part online) keeps its payments in e.payments.
export function mopText(e) {
    if (Array.isArray(e.payments) && e.payments.length) return e.payments.map(paymentText).join(' + ');
    const mop = (e.mop || '').trim();
    const ref = (e.mopRef || '').trim();
    if (!mop) return ref ? `REF # ${ref}` : '';
    const bank = mop === 'Bank Transfer' && e.mopBank ? ` - ${String(e.mopBank).trim()}` : (e.mopChannel ? ` - ${String(e.mopChannel).trim()}` : '');
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
    const words = main.split(/[\s:]+/).filter(w => /[a-z0-9]/i.test(w)); // ignore lone dashes, e.g. "TLR Shirt - Small"
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
    const out = { cash: 0, online: 0, byMethod: {}, byChannel: {} };
    const add = (m, amount, channel = '') => {
        out.byMethod[m] = round2((out.byMethod[m] || 0) + amount);
        if (m === 'Cash') out.cash = round2(out.cash + amount);
        else {
            out.online = round2(out.online + amount);
            const c = String(channel || '').trim(); // '' = online payment without a channel
            out.byChannel[c] = round2((out.byChannel[c] || 0) + amount);
        }
    };
    const seen = new Set();
    for (const r of rows) {
        const e = r.entry;
        if (Array.isArray(e.payments) && e.payments.length) {
            if (seen.has(e)) continue; // count a split PR once, not once per line item
            seen.add(e);
            e.payments.forEach(p => add((p.method || '').trim() || 'Cash', Number(p.amount) || 0, p.channel));
        } else {
            add((e.mop || '').trim() || 'Cash', r.total, e.mopChannel);
        }
    }
    return out;
}

function entryHasMop(e, mop) {
    if (mop.startsWith('channel:')) { // one online channel, e.g. "channel:GCash"
        const ch = mop.slice(8).toLowerCase();
        const is = (m, c) => !!m && m !== 'Cash' && m !== 'Split' && String(c || '').trim().toLowerCase() === ch;
        return is(e.mop, e.mopChannel) || (e.payments || []).some(p => is(p.method, p.channel));
    }
    // "Online Payment" = any non-cash method (GCash, bank transfer, invoice, ...).
    const same = m => mop === 'Online Payment' ? !!m && m !== 'Cash' && m !== 'Split' : (m === mop || (mop === 'Cheque' && m === 'Check'));
    return same(e.mop) || (e.payments || []).some(p => same(p.method));
}

// Search words are all required (AND). A word can be text, an amount (1500 / 1,500.00) or a PR range (42701-42750).
export function filterEntries(entries, { q = '', from = '', to = '', booklet = '', unchecked = false, mop = '', month = '' } = {}) {
    const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return entries.filter(e => {
        if (unchecked && e.checkedAt) return false;
        if (booklet && bookletStart(e.pr) !== Number(booklet)) return false;
        if (from && e.date < from) return false;
        if (to && e.date > to) return false;
        if (month && !String(e.date || '').startsWith(month)) return false;
        if (mop && !entryHasMop(e, mop)) return false;
        if (!terms.length) return true;
        const total = entryTotal(e);
        const hay = [e.pr, e.buyer, mopText(e), fmtDate(e.date), total.toFixed(2), money(total), ...(e.items || []).map(i => i.desc)]
            .join(' ').toLowerCase();
        return terms.every(t => {
            const r = /^(\d{3,})-(\d{3,})$/.exec(t);
            if (r && Number(r[1]) <= Number(r[2])) return e.pr >= Number(r[1]) && e.pr <= Number(r[2]);
            return hay.includes(t);
        });
    });
}

// Edit distance, used to spot typos of "Anonymous" (Anonyous, Anonnymous...) so they are never suggested.
function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

// Buyer names already used, best first: names starting with what was typed, then the most used, then the most recent.
// Spelling variants that differ only in capitals are merged (the most common spelling is shown). "Anonymous" is never suggested.
export function buyerSuggestions(entries, q = '', limit = 8) {
    const t = String(q).trim().toLowerCase();
    const needle = t === 'anonymous' ? '' : t;
    const groups = new Map();
    for (const e of entries) {
        const name = String(e.buyer || '').trim();
        const key = name.toLowerCase();
        if (!name || (key.length >= 6 && editDistance(key, 'anonymous') <= 2)) continue;
        const g = groups.get(key) || { key, spellings: new Map(), n: 0, last: 0 };
        g.spellings.set(name, (g.spellings.get(name) || 0) + 1);
        g.n++;
        g.last = Math.max(g.last, Number(e.updatedAt) || Date.parse(e.date) || 0);
        groups.set(key, g);
    }
    let list = [...groups.values()].map(g => ({
        name: [...g.spellings].sort((a, b) => b[1] - a[1])[0][0], key: g.key, n: g.n, last: g.last,
    }));
    if (needle) list = list.filter(x => x.key.includes(needle));
    list.sort((a, b) => (b.key.startsWith(needle) - a.key.startsWith(needle)) || b.n - a.n || b.last - a.last);
    list = list.slice(0, limit);
    // Nothing useful to suggest when the only match is exactly what is already typed.
    if (list.length === 1 && list[0].name === String(q).trim()) return [];
    return list.map(({ name, n }) => ({ name, n }));
}

// Is this date far from the other receipts of the same booklet? (a likely typo in month or year)
export function dateFarFromBooklet(entries, pr, iso, excludeId = null, maxDays = 45) {
    const ok = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
    if (!ok(iso) || !(Number(pr) > 0)) return null;
    const start = bookletStart(Number(pr));
    const ds = entries.filter(e => e.id !== excludeId && bookletStart(Number(e.pr)) === start && ok(e.date)).map(e => e.date).sort();
    if (ds.length < 3) return null;
    const day = d => Date.parse(d + 'T00:00:00Z') / 86400000;
    const usual = ds[Math.floor(ds.length / 2)];
    const days = Math.round(Math.abs(day(iso) - day(usual)));
    return days > maxDays ? { usual, days } : null;
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
// Payment text -> method / reference / bank, the same wording the app writes in its own table
// ("GCASH REF # 9876", "BANK TRANSFER - BDO REF # 555", "CHEQUE REF # 12", "OTHERS REF # note"). Old sheets
// ("INVOICE REF # 689746", "Invoice 689746") still read as before.
function parseMopLabel(text) {
    const t = String(text || '').trim();
    if (!t || /^cash$/i.test(t)) return { method: 'Cash', ref: '', bank: '' };
    const kindOf = h => /^online\s*payment/i.test(h) ? 'Online Payment' : /^gcash/i.test(h) ? 'GCash' : /^maya/i.test(h) ? 'Maya' : /^bank/i.test(h) ? 'Bank Transfer'
        : /^(cheque|check)/i.test(h) ? 'Cheque' : /^others?/i.test(h) ? 'Others' : /^invoice/i.test(h) ? 'Invoice' : '';
    const r = /^(.*?)\s*\bREF(?:ERENCE)?\b\.?\s*(?:NO\.?|#)?\s*(.*)$/i.exec(t);
    if (r) {
        const head = r[1].trim();
        const method = kindOf(head) || 'Invoice';
        const bank = method === 'Bank Transfer' ? head.replace(/^bank\s*transfer\s*[-:\u2013]?\s*/i, '').trim() : '';
        const channel = method === 'Online Payment' ? head.replace(/^online\s*payment\s*[-:\u2013]?\s*/i, '').trim() : '';
        return { method, ref: r[2].trim(), bank, channel };
    }
    const op = /^online\s*payment\b[\s\-:\u2013]*(.*)$/i.exec(t); // "Online Payment - GCash" (no reference number)
    if (op) return { method: 'Online Payment', ref: '', bank: '', channel: op[1].trim() };
    const k = /^(invoice|gcash|maya|bank\s*transfer|bank|cheque|check|others?)\b[\s\-:]*(.*)$/i.exec(t);
    if (k) return { method: kindOf(k[1]), ref: k[2].trim(), bank: '' };
    return { method: 'Invoice', ref: t, bank: '' };
}
// "Cash 100.00 + GCASH REF # 1 30.00" -> two payments, or null when the text is not a split.
function parseSplit(text) {
    const parts = String(text || '').split(/\s+\+\s+/);
    if (parts.length < 2) return null;
    const pays = [];
    for (const p of parts) {
        const m = /^(.*?)\s+([\d,]+\.\d{2})$/.exec(p.trim());
        if (!m) return null;
        const lab = parseMopLabel(m[1]);
        const pay = { method: lab.method, amount: Number(m[2].replace(/,/g, '')) };
        if (lab.method !== 'Cash') { if (lab.ref) pay.ref = lab.ref; if (lab.bank) pay.bank = lab.bank; if (lab.channel) pay.channel = lab.channel; }
        pays.push(pay);
    }
    return pays;
}
// Excel wraps cells with commas or quotes in "...", with "" for a literal quote.
const unquoteCell = s => /^".*"$/.test(s) ? s.slice(1, -1).replace(/""/g, '"') : s;

// Parse rows pasted from the spreadsheet (tab separated, same columns as the output table).
// Rows without a PR number continue the previous receipt. Totals and header rows are ignored.
// VOID / NOT USED rows come back in "marks". Dates: MM-DD-YYYY, MM/DD/YYYY or YYYY-MM-DD.
export function parseSheet(text) {
    const out = [];
    const marks = [];
    let cur = null;
    const skipped = [];
    const warnings = [];
    const num = s => Number(String(s).replace(/[,\s\u20B1]/g, ''));
    const parseDate = d => {
        let m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(d || '');
        if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
        m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(d || '');
        return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : '';
    };
    for (const raw of String(text || '').split(/\r?\n/)) {
        if (!raw.trim()) continue;
        const c = raw.split('\t').map(s => unquoteCell(s.trim()));
        if (/^date$/i.test(c[0]) || /pr\s*number/i.test(c[1] || '')) continue;
        const [d, pr, buyer, desc, qty, price, , , mop] = c;
        // The tag is in the items column (copy / CSV) or in the buyer column (PDF / Excel export, where there is no date).
        const tag = /^(void|not\s*used|unused)$/i;
        const word = tag.test(desc || '') ? desc : (!parseDate(d) && tag.test(buyer || '')) ? buyer : '';
        if (/^\d+$/.test(pr || '') && word) {
            marks.push({ pr: Number(pr), status: /^void$/i.test(word) ? 'void' : 'unused' });
            cur = null;
            continue;
        }
        const iso = parseDate(d);
        if (/^\d+$/.test(pr || '') && iso) {
            cur = {
                id: `pr_${Number(pr)}`, pr: Number(pr),
                date: iso,
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
        // The pasted TOTAL column is not used (the site recalculates), but a mismatch usually means shifted or cut-off columns.
        const lineTotal = c[6] ? num(c[6]) : NaN;
        if (Number.isFinite(lineTotal) && Math.abs(lineTotal - round2(q * p)) > 0.01) {
            warnings.push(`PR ${cur.pr}, ${desc}: sheet total ${lineTotal.toFixed(2)}, but qty x price is ${round2(q * p).toFixed(2)}`);
        }
        cur.items.push({ desc, qty: q, price: p });
        if (mop && cur.mop === 'Cash' && !cur.payments) {
            const split = parseSplit(mop);
            if (split) { cur.mop = 'Split'; cur.mopRef = ''; cur.payments = split; }
            else {
                const lab = parseMopLabel(mop);
                if (lab.method !== 'Cash') {
                    cur.mop = lab.method;
                    cur.mopRef = lab.ref;
                    if (lab.bank) cur.mopBank = lab.bank;
                    if (lab.channel) cur.mopChannel = lab.channel;
                }
            }
        }
    }
    return { entries: out, skipped, marks, warnings };
}

// What an import would change, for the preview: new PRs, PRs that replace an existing receipt (with what differs), and marks.
export function importChanges(parsed, existing) {
    const total = e => round2((e.items || []).reduce((t, i) => t + i.qty * i.price, 0));
    const byId = new Map(existing.map(e => [e.id, e]));
    const added = [], replaced = [], same = [];
    for (const e of parsed.entries) {
        const old = byId.get(e.id);
        if (!old) { added.push(e.pr); continue; }
        const diffs = [];
        if (total(old) !== total(e)) diffs.push(`total ${total(old).toFixed(2)} -> ${total(e).toFixed(2)}`);
        if ((old.buyer || 'Anonymous') !== e.buyer) diffs.push(`buyer "${old.buyer || 'Anonymous'}" -> "${e.buyer}"`);
        if ((old.date || '') !== e.date) diffs.push(`date ${old.date || '-'} -> ${e.date}`);
        if ((old.items || []).length !== e.items.length) diffs.push(`${(old.items || []).length} -> ${e.items.length} items`);
        if (diffs.length) replaced.push({ pr: e.pr, diffs }); else same.push(e.pr);
    }
    return { added, replaced, same };
}

// End-of-review summary: items sold in the booklet, split into CASH and ONLINE PAYMENT (anything not cash),
// grouped by item + selling price. For a split PR the cash amount is filled first, in item order,
// and the remaining quantity goes online.
// Online total per channel, biggest first: [{ channel, total }]. Empty when no online payment has a channel yet;
// otherwise online payments without a channel are listed as "No channel" so the lines add up to the online total.
export function channelTotals(entries) {
    const by = paymentSplit(flatten(entries)).byChannel;
    const named = Object.keys(by).filter(Boolean);
    if (!named.length) return [];
    return [...named.map(c => ({ channel: c, total: by[c] })).sort((a, b) => b.total - a.total || a.channel.localeCompare(b.channel)),
        ...(by[''] ? [{ channel: 'No channel', total: by[''] }] : [])];
}
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
        channels: SHOW_CHANNEL_TOTALS ? channelTotals(entries) : [],
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
        ['TOTAL', '', '', money(sec.total)],
        ...(title === 'ONLINE PAYMENT' ? (s.channels || []).map(c => [`  ${c.channel}`, '', '', money(c.total)]) : []), [],
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
    if (/jacket|polo|t[\s-]*shirt/i.test(s) && !/\b(tlr|idc)\b|true\s*life/i.test(s)) return 'MERCH'; // TLR and IDC shirts are discipleship materials
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
    if (/payment|baptismal|graduation|retreat/.test(t)) return null; // event items are not on the sales sheet
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
        [/motivate.*chinese|chinese.*motivate/, 'Motivate Book (Chinese)'], [/motivate/, 'Motivate Book (English)'], [/da[rt]e\s*(2|to)\s*share/, 'Dare 2 Share'],
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
// Items on that sheet use its categories. Event items (payments, certificates, graduation) are GLC EVENTS, anything else is OTHER.
export function itemCategory(desc) {
    const d = sheetDescFor(desc);
    const row = d && SHEET_ROWS.find(r => r.desc === d);
    if (row) return row.category;
    // Not an exact sheet item (e.g. a jacket sold without a size): still group it by what it is.
    if (/\b(idc|tlr)\b|true\s*life/i.test(String(desc || '')) && /shirt/i.test(String(desc || ''))) return 'DISCIPLESHIP MATERIALS'; // TLR / IDC shirts
    if (/jacket|polo|shirt|merch/i.test(String(desc || ''))) return 'MERCH';
    if (/gospel\s*tract/i.test(String(desc || ''))) return 'GOSPEL TRACTS';
    if (/\bbook\s*\d+/i.test(String(desc || ''))) return 'GLC BOOKS';
    if (/payment|event|registration|retreat|conference|seminar|baptismal|graduation/i.test(String(desc || ''))) return 'GLC EVENTS';
    return 'OTHER';
}
// One label per receipt. A receipt that mixes categories lists each once, in order, e.g. "GLC BOOKS / MERCH".
export function prCategory(e) {
    const seen = [];
    for (const it of e.items || []) { const c = itemCategory(it.desc); if (!seen.includes(c)) seen.push(c); }
    return seen.join(' / ');
}
// ---- Price history: what changed between two versions of the catalog ----
// Returns [{ desc, kind: 'changed' | 'added' | 'removed', oldPrice, newPrice }]. Items are matched by name (case-insensitive).
export function priceChanges(prev, next) {
    const key = c => String(c.desc || '').trim().toLowerCase();
    const before = new Map(prev.map(c => [key(c), c]));
    const after = new Map(next.map(c => [key(c), c]));
    const out = [];
    for (const c of next) {
        const p = before.get(key(c));
        if (!p) out.push({ desc: c.desc, kind: 'added', oldPrice: null, newPrice: Number(c.price) || 0 });
        else if ((Number(p.price) || 0) !== (Number(c.price) || 0)) out.push({ desc: c.desc, kind: 'changed', oldPrice: Number(p.price) || 0, newPrice: Number(c.price) || 0 });
    }
    for (const p of prev) if (!after.has(key(p))) out.push({ desc: p.desc, kind: 'removed', oldPrice: Number(p.price) || 0, newPrice: null });
    return out;
}
// ---- Final report: CASH / ONLINE PAYMENT item tallies grouped by category (the sheet after the TOP sheet) ----
export const REPORT_GROUPS = ['GLC BOOKS', 'GOSPEL TRACTS', 'DISCIPLESHIP MATERIALS', 'GLC MERCH', 'GLC EVENTS', 'OTHER'];
export function reportGroup(desc) {
    const c = itemCategory(desc);
    if (c === 'MERCH') return 'GLC MERCH'; // jackets and shirts
    return REPORT_GROUPS.includes(c) ? c : 'OTHER';
}
// sec = { rows: [{desc, qty, price, total}], total } from bookletSummary. Returns [{ name, rows }] in report order, empty groups left out.
export function categoryGroups(sec) {
    const order = desc => { const d = sheetDescFor(desc); const i = d ? SHEET_ROWS.findIndex(r => r.desc === d) : -1; return i < 0 ? 9999 : i; };
    return REPORT_GROUPS.map(name => ({
        name,
        rows: sec.rows.filter(r => reportGroup(r.desc) === name)
            .sort((a, b) => order(a.desc) - order(b.desc) || a.desc.localeCompare(b.desc) || a.price - b.price),
    })).filter(g => g.rows.length);
}
// ---- Analytics -----------------------------------------------------------------------------
// Numbers behind the Analytics page. `from` / `to` (YYYY-MM-DD, both optional) limit the receipts by PR date.
// Void / not-used / missing counts are about the PR numbers themselves, so they always cover everything.
export function analytics(entries, marks = [], { from = '', to = '' } = {}) {
    const es = entries.filter(e => e.date && (!from || e.date >= from) && (!to || e.date <= to));
    const rows = flatten(es);
    const split = paymentSplit(rows);
    const total = round2(split.cash + split.online);
    const units = round2(rows.reduce((s, r) => s + r.qty, 0));

    const dayMap = new Map(), wd = Array.from({ length: 7 }, () => ({ total: 0, receipts: 0, days: new Set() }));
    let biggest = null;
    for (const e of es) {
        const t = entryTotal(e);
        const d = dayMap.get(e.date) || { date: e.date, total: 0, receipts: 0 };
        d.total = round2(d.total + t); d.receipts += 1; dayMap.set(e.date, d);
        const w = wd[utc(e.date).getUTCDay()];
        w.total = round2(w.total + t); w.receipts += 1; w.days.add(e.date);
        if (!biggest || t > biggest.total) biggest = { pr: e.pr, total: t, buyer: e.buyer || 'Anonymous' };
    }
    const days = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));
    const bestDay = days.reduce((b, d) => (!b || d.total > b.total ? d : b), null);

    const cats = new Map(SALES_CATEGORIES.map(c => [c, { category: c, units: 0, total: 0 }]));
    const items = new Map();
    for (const r of rows) {
        const c = cats.get(salesCategory(r.desc));
        c.units = round2(c.units + r.qty); c.total = round2(c.total + r.total);
        const it = items.get(r.desc) || { desc: r.desc, category: salesCategory(r.desc), qty: 0, total: 0 };
        it.qty = round2(it.qty + r.qty); it.total = round2(it.total + r.total);
        items.set(r.desc, it);
    }
    const share = v => (total > 0 ? round2((v / total) * 100) : 0);
    const methods = Object.entries(split.byMethod).map(([method, amount]) => ({ method, total: amount, share: share(amount) })).sort((a, b) => b.total - a.total);

    // PR numbers: void / not used marks, and numbers inside an encoded booklet that have neither a receipt nor a mark.
    const have = new Set([...entries.map(e => Number(e.pr)), ...marks.map(m => Number(m.pr))]);
    let missing = 0;
    for (const b of bookletStarts(entries)) {
        const last = Math.max(...entries.filter(e => bookletStart(e.pr) === b).map(e => Number(e.pr)));
        for (let n = b; n <= last; n++) if (!have.has(n)) missing++;
    }
    return {
        from: days.length ? days[0].date : '', to: days.length ? days[days.length - 1].date : '',
        receipts: es.length, units, total, cash: split.cash, online: split.online,
        avgReceipt: es.length ? round2(total / es.length) : 0,
        avgItems: es.length ? round2(rows.length / es.length) : 0,
        activeDays: days.length, bestDay, biggest, days,
        weekdays: wd.map((w, i) => ({ day: i, total: w.total, receipts: w.receipts, activeDays: w.days.size, avg: w.days.size ? round2(w.total / w.days.size) : 0 })),
        categories: [...cats.values()].map(c => ({ ...c, share: share(c.total) })),
        methods,
        channels: !SHOW_CHANNEL_TOTALS ? [] : Object.entries(split.byChannel).filter(([c, v]) => c && v > 0).map(([channel, amount]) => ({ channel, total: amount, share: share(amount) })).sort((a, b) => b.total - a.total),
        channelsNone: SHOW_CHANNEL_TOTALS ? (split.byChannel[''] || 0) : 0,
        topItems: [...items.values()].sort((a, b) => b.total - a.total || b.qty - a.qty),
        verification: verificationOverview(entries),
        marks: { void: marks.filter(m => m.status === 'void').length, unused: marks.filter(m => m.status === 'unused').length, missing },
    };
}
// ---------- Version history of receipts ----------
export const MAX_VERSIONS = 20;

// Plain-language list of what differs between two versions of a receipt (a = older or null, b = newer or null).
export function diffEntries(a, b) {
    if (!a && !b) return [];
    if (!a) return ['Receipt created'];
    if (!b) return ['Receipt deleted'];
    const out = [];
    const f = (label, x, y) => { if ((x || '') !== (y || '')) out.push(`${label}: ${x || '(none)'} \u2192 ${y || '(none)'}`); };
    f('Date', a.date, b.date);
    f('Buyer', a.buyer, b.buyer);
    f('Payment', mopText(a), mopText(b));
    const key = i => `${i.desc}`;
    const am = new Map((a.items || []).map(i => [key(i), i]));
    const bm = new Map((b.items || []).map(i => [key(i), i]));
    for (const [k, i] of bm) {
        const o = am.get(k);
        if (!o) out.push(`Added ${i.qty} x ${i.desc} @ ${money(i.price)}`);
        else if (Number(o.qty) !== Number(i.qty) || Number(o.price) !== Number(i.price)) out.push(`${i.desc}: ${o.qty} @ ${money(o.price)} \u2192 ${i.qty} @ ${money(i.price)}`);
    }
    for (const [k, i] of am) if (!bm.has(k)) out.push(`Removed ${i.qty} x ${i.desc}`);
    const ta = entryTotal(a), tb = entryTotal(b);
    if (ta !== tb) out.push(`Total: ${money(ta)} \u2192 ${money(tb)}`);
    return out;
}

// Versions of one PR, newest first.
export function versionsForPr(history, pr) {
    return (history || []).filter(v => Number(v.pr) === Number(pr)).sort((x, y) => y.at - x.at);
}

// Ids of the versions of one PR beyond the newest `max` (to delete).
export function versionsToTrim(history, pr, max = MAX_VERSIONS) {
    return versionsForPr(history, pr).slice(max).map(v => v.id);
}

// PRs whose newest version is a deletion and that have no receipt now (restorable), newest deletion first.
export function deletedPrs(history, entries) {
    const have = new Set((entries || []).map(e => Number(e.pr)));
    const latest = new Map();
    for (const v of history || []) { const c = latest.get(Number(v.pr)); if (!c || v.at > c.at) latest.set(Number(v.pr), v); }
    return [...latest.values()].filter(v => v.action === 'deleted' && !have.has(Number(v.pr))).sort((x, y) => y.at - x.at);
}

// Date cascade: after a PR gets a new date, every higher-numbered PR in the same booklet takes that date too.
// Returns the PRs to change (not locked) and the ones skipped because their booklet is locked, both in PR order.
export function cascadeDateTargets(entries, entry, isLocked = () => false) {
    const start = bookletStart(Number(entry.pr));
    const later = (entries || [])
        .filter(e => Number(e.pr) > Number(entry.pr) && bookletStart(Number(e.pr)) === start && e.date !== entry.date)
        .sort((a, b) => a.pr - b.pr);
    return { change: later.filter(e => !isLocked(e.pr)), skipped: later.filter(e => isLocked(e.pr)) };
}

// ---------- Verification time ----------
export const BREAK_MS = 5 * 60 * 1000; // a pause longer than this between two checks is a break, not working time

// From the times PRs were checked: active time (gaps up to BREAK_MS added up), total span, breaks, and whether it is only approximate.
export function verificationStats(times) {
    const t = (times || []).filter(x => x).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
    let active = 0, breaks = 0;
    for (let i = 1; i < t.length; i++) { const g = t[i] - t[i - 1]; if (g <= BREAK_MS) active += g; else breaks += g; }
    const span = t.length ? t[t.length - 1] - t[0] : 0;
    return { checks: t.length, ms: active, spanMs: span, breakMs: breaks, firstAt: t[0] || 0, lastAt: t[t.length - 1] || 0,
        approx: t.length < 2 || breaks > span / 2 };
}
export function bookletVerification(entries, start) {
    return verificationStats(entries.filter(e => bookletStart(Number(e.pr)) === start && e.checkedAt).map(e => e.checkedAt));
}
// "45 s", "23 min", "1 h 12 min"
export function formatDuration(ms) {
    const s = Math.round(Math.max(0, ms) / 1000);
    if (s < 60) return `${s} s`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
}
// Average / fastest / slowest verification time over booklets whose receipts are all checked.
export function verificationOverview(entries) {
    const list = [];
    for (const s of bookletStarts(entries)) {
        const es = entries.filter(e => bookletStart(Number(e.pr)) === s);
        if (!es.length || !es.every(e => e.checkedAt)) continue;
        const v = verificationStats(es.map(e => e.checkedAt));
        if (v.checks >= 2) list.push({ start: s, ms: v.ms, approx: v.approx });
    }
    if (!list.length) return { count: 0, avgMs: 0, fastest: null, slowest: null, approx: 0 };
    const sorted = [...list].sort((a, b) => a.ms - b.ms);
    return { count: list.length, avgMs: Math.round(list.reduce((n, b) => n + b.ms, 0) / list.length), fastest: sorted[0], slowest: sorted[sorted.length - 1], approx: list.filter(b => b.approx).length };
}

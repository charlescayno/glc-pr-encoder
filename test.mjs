// Run with: node test.mjs (or open test.html through a local web server)
const assert = {
    equal(a, b, m) { if (a !== b) throw new Error((m || "equal") + ": " + a + " !== " + b); },
    deepEqual(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("deepEqual: " + JSON.stringify(a) + " vs " + JSON.stringify(b)); },
};
import { flatten, toTSV, checkPr, nextPr, mopText, filterEntries, bookletStart, bookletLabel, bookletStats, bookletStarts, paymentSplit, resolveShortcut, reviewSequence, reviewProgress, pesoWords, parseSheet } from "./logic.js";
import { SHEET_0920 } from "./seed-sheet.js";

const entries = [
    { id: "pr_42751", pr: 42751, date: "2026-09-13", buyer: "Anonymous", mop: "", mopRef: "", items: [{ desc: "Book 1: One by One 4th Edition", qty: 2, price: 50 }] },
    { id: "pr_42752", pr: 42752, date: "2026-09-13", buyer: "Anonymous", mop: "", mopRef: "", items: [{ desc: "Real Talk", qty: 3, price: 25 }] },
    { id: "pr_42753", pr: 42753, date: "2026-09-13", buyer: "Anonymous", mop: "Invoice", mopRef: "689746", items: [{ desc: "Book 1: One by One 4th Edition", qty: 2, price: 50 }] },
    { id: "pr_42754", pr: 42754, date: "2026-09-13", buyer: "Anonymous", mop: "", mopRef: "", items: [{ desc: "Accountability Card", qty: 10, price: 2 }, { desc: "Real Talk", qty: 2, price: 25 }] },
    { id: "pr_42755", pr: 42755, date: "2026-09-13", buyer: "Anonymous", mop: "", mopRef: "", items: [{ desc: "Book 11 : Spiritual Warfare", qty: 1, price: 55 }, { desc: "Book 12 : Leadership Skills", qty: 1, price: 85 }] },
    { id: "pr_42756", pr: 42756, date: "2026-09-13", buyer: "Anonymous", mop: "", mopRef: "", items: [{ desc: "Book 7: Family Life 3rd Edition", qty: 1, price: 80 }] },
];

const rows = flatten([...entries].reverse());
assert.deepEqual(rows.map(r => r.grand), [100, 175, 275, 295, 345, 400, 485, 565]);
assert.deepEqual(rows.map(r => r.total), [100, 75, 100, 20, 50, 55, 85, 80]);
assert.equal(mopText(entries[2]), "INVOICE REF # 689746");
assert.equal(toTSV(rows).split("\n")[5].split("\t")[0], "", "continuation row hides date");
assert.equal(nextPr(entries), 42757);
assert.equal(checkPr(entries, 42753).duplicate, true);
assert.equal(checkPr(entries, 42753, "pr_42753").duplicate, false);
assert.equal(checkPr(entries, 42760).gap, true);
assert.equal(checkPr(entries, 42757).gap, false);
assert.equal(filterEntries(entries, { q: "real talk" }).length, 2);
assert.equal(flatten(filterEntries(entries, { q: "real talk" })).at(-1).grand, 75 + 20 + 50); // whole PR is kept when any line matches
// Booklets of 50 sheets: 42701-42750
assert.equal(bookletStart(42701), 42701);
assert.equal(bookletStart(42750), 42701);
assert.equal(bookletStart(42751), 42751);
assert.equal(bookletStart(42800), 42751);
assert.equal(bookletStart(42801), 42801);
assert.equal(bookletLabel(42701), "42701 - 42750");
const bk = bookletStats([...entries, { id: "x", pr: 42760, items: [] }], 42751);
assert.equal(bk.used, 7);
assert.deepEqual(bk.missing, [42757, 42758, 42759]);
assert.equal(bk.complete, false);
assert.deepEqual(bookletStarts([...entries, { id: "y", pr: 42801, items: [] }]), [42751, 42801]);
assert.equal(filterEntries([...entries, { id: "y", pr: 42801, date: "2026-09-14", items: [] }], { booklet: 42801 }).length, 1);
// Cash vs online split (no MOP counts as cash; Invoice is online)
const split = paymentSplit(flatten(entries));
assert.equal(split.online, 100);            // PR 42753 paid by invoice
assert.equal(split.cash, 565 - 100);
assert.deepEqual(split.byMethod, { Cash: 465, Invoice: 100 });
// Amount in words
assert.equal(pesoWords(30), "Thirty pesos only");
assert.equal(pesoWords(120), "One hundred twenty pesos only");
assert.equal(pesoWords(1), "One peso only");
assert.equal(pesoWords(1255.5), "One thousand two hundred fifty-five pesos and 50/100 only");
assert.equal(pesoWords(0), "Zero pesos only");
assert.equal(pesoWords(1000), "One thousand pesos only");
assert.equal(pesoWords(2500000), "Two million five hundred thousand pesos only");

// Review: sequence, progress, marks
{
    const es = [
        { id: "pr_42751", pr: 42751, date: "2026-09-13", items: [], checkedAt: 111 },
        { id: "pr_42752", pr: 42752, date: "2026-09-13", items: [] },
        { id: "pr_42755", pr: 42755, date: "2026-09-13", items: [] },
        { id: "pr_42801", pr: 42801, date: "2026-09-14", items: [] },
    ];
    let seq = reviewSequence(es, [], 42751);
    assert.deepEqual(seq.map(s => s.pr), [42751, 42752, 42753, 42754, 42755]);
    assert.deepEqual(seq.map(s => s.type), ["entry", "entry", "missing", "missing", "entry"]);
    let pg = reviewProgress(seq);
    assert.equal(pg.checked, 1); assert.equal(pg.entries, 3); assert.equal(pg.missing, 2); assert.equal(pg.done, false);
    const marks = [{ id: "pr_42753", pr: 42753, status: "void", at: 222 }, { id: "pr_42754", pr: 42754, status: "unused", at: 333 }];
    seq = reviewSequence(es, marks, 42751);
    assert.deepEqual(seq.map(s => s.type), ["entry", "entry", "mark", "mark", "entry"]);
    pg = reviewProgress(seq);
    assert.equal(pg.missing, 0); assert.equal(pg.done, false); // two PRs still unchecked
    es[1].checkedAt = 444; es[2].checkedAt = 555;
    pg = reviewProgress(reviewSequence(es, marks, 42751));
    assert.equal(pg.done, true); assert.equal(pg.lastAt, 555);
    assert.deepEqual(reviewSequence(es, [], 42701), []);
    assert.deepEqual(bookletStats(es, 42751, marks).missing, []);
    assert.deepEqual(bookletStats(es, 42751).missing, [42753, 42754]);
    assert.equal(filterEntries(es, { unchecked: true }).length, 1);
}

// Split payment: PR 42760 total 300 = 100 cash + 200 invoice, two line items
const splitEntry = { id: "pr_42760", pr: 42760, date: "2026-09-13", buyer: "Anonymous", mop: "Split", mopRef: "",
    payments: [{ method: "Cash", amount: 100 }, { method: "Invoice", amount: 200, ref: "689746" }],
    items: [{ desc: "Real Talk", qty: 4, price: 25 }, { desc: "Accountability Card", qty: 100, price: 2 }] };
assert.equal(mopText(splitEntry), "Cash 100.00 + INVOICE REF # 689746 200.00");
const sp = paymentSplit(flatten([splitEntry]));
assert.equal(sp.cash, 100);
assert.equal(sp.online, 200);
assert.deepEqual(sp.byMethod, { Cash: 100, Invoice: 200 });

// Item shorthand
const cat = [
    "GLC Book 1: One by One", "GLC Book 1: Filipino One by One", "GLC Book 5: Starting Point for small group (New)",
    "GLC Book 5: Starting Point for small group (Old)", "GLC Book 7: The Family Life (New)", "GLC Book 7: The Family Life",
    "GLC Book 12: Leadership Skills", "Gospel Tracts English (New)", "Gospel Tracts Tagalog (New)", "Dare 2 Share", "Accountability Card", "Real Talk Booklet",
].map((desc, i) => ({ desc, price: i + 1 }));
cat.push({ desc: "Motivate English", price: 250, code: "mot" });
const one = t => { const r = resolveShortcut(cat, t); return r.status === "one" ? r.items[0].desc : r.status; };
assert.equal(one("gte"), "Gospel Tracts English (New)");
assert.equal(one("GTT"), "Gospel Tracts Tagalog (New)");
assert.equal(one("b1"), "GLC Book 1: One by One");
assert.equal(one("fb1"), "GLC Book 1: Filipino One by One");
assert.equal(one("b12"), "GLC Book 12: Leadership Skills");
assert.equal(one("b5"), "many");
assert.equal(one("b5n"), "GLC Book 5: Starting Point for small group (New)");
assert.equal(one("b5o"), "GLC Book 5: Starting Point for small group (Old)");
assert.equal(one("b7"), "GLC Book 7: The Family Life");
assert.equal(one("d2s"), "Dare 2 Share");
assert.equal(one("ac"), "Accountability Card");
assert.equal(one("mot"), "Motivate English");
assert.equal(one("zzz"), "none");
assert.equal(one("Dare 2 Share"), "none", "exact names are never treated as shorthand");
{
    const { entries: es, skipped } = parseSheet(SHEET_0920);
    assert.equal(es.length, 50, "50 PRs");
    assert.equal(skipped.length, 0, "no skipped");
    assert.equal(es[4].mop + "|" + es[4].mopRef, "Invoice|302351");
    assert.equal(es[45].mopRef, "2B6D EF8A0F45");
    assert.equal(es[3].items.length, 2);
    assert.equal(es[0].buyer, "Anonymous");
    const rows = flatten(es);
    assert.equal(rows[rows.length - 1].grand, 8841, "sheet total");
    const hdr = "DATE\tPR NUMBER\tBUYER\tSOLD ITEMS\tQTY\tUNIT PRICE\tTOTAL\tGRAND TOTAL\tMOP\n";
    assert.equal(parseSheet(hdr + SHEET_0920 + "\n\t\t\t\t\t\t8,841.00\t8,841.00").entries.length, 50, "header and total line ignored");
}
console.log("all tests passed");

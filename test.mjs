// Run with: node test.mjs (or open test.html through a local web server)
const assert = {
    ok(v, m) { if (!v) throw new Error(m || "not ok"); },
    equal(a, b, m) { if (a !== b) throw new Error((m || "equal") + ": " + a + " !== " + b); },
    deepEqual(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("deepEqual: " + JSON.stringify(a) + " vs " + JSON.stringify(b)); },
};
import { itemColor, flatten, toTSV, checkPr, nextPr, mopText, filterEntries, dateFarFromBooklet, buyerSuggestions, bookletStart, bookletLabel, bookletStats, bookletStarts, paymentSplit, resolveShortcut, reviewSequence, reviewProgress, pesoWords, bookletSummary, summaryTSV, markSummary, compressRanges, parseSheet, importChanges, analytics, skipMarked, withMarks, salesSummary, salesCategory, periodOf, salesSummaryCSV, sheetDescFor, salesMatrix, SHEET_ROWS, itemShortcut, itemCategory, prCategory, priceChanges, categoryGroups } from "./logic.js";
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
    assert.equal(parseSheet(SHEET_0920).warnings.length, 0, "a good sheet has no total mismatches");
    // Safety checks before importing: total mismatch warning and what would be replaced.
    const bad = parseSheet("9/20/2026\t7\tAna\tReal Talk\t2\t25\t99.00\t99.00\t");
    assert.equal(bad.warnings.length, 1, "wrong total is flagged");
    // Void / not used rows as written by the PDF / Excel export (tag in the buyer column) and by copy / CSV (tag in the items column).
    const mk = parseSheet("\t55802\tNOT USED\t\t\t\t\t\t\n\t55804\tVOID\tCancelled sheet, no sale\t\t\t\t\t\n\t55806\t\tNot used\t\t\t\t\t");
    assert.equal(mk.marks.map(m => m.pr + m.status).join(","), "55802unused,55804void,55806unused", "export marks import back");
    assert.equal(mk.entries.length + "|" + mk.skipped.length, "0|0");
    const old = [{ id: "pr_7", pr: 7, date: "2026-09-20", buyer: "Ana", items: [{ desc: "Real Talk", qty: 1, price: 25 }] },
                 { id: "pr_8", pr: 8, date: "2026-09-20", buyer: "Bo", items: [{ desc: "Real Talk", qty: 1, price: 25 }] }];
    const ch = importChanges(parseSheet("9/20/2026\t7\tAna\tReal Talk\t2\t25\t50.00\t50.00\t\n9/20/2026\t8\tBo\tReal Talk\t1\t25\t25.00\t25.00\t\n9/20/2026\t9\tCy\tReal Talk\t1\t25\t25.00\t25.00\t"), old);
    assert.equal(ch.replaced.length + "|" + ch.same.length + "|" + ch.added.length, "1|1|1", "replaced / identical / new");
    assert.equal(ch.replaced[0].diffs[0], "total 25.00 -> 50.00");
}
{
    const es = [{ id: "pr_1", pr: 1, date: "2026-09-20", buyer: "A", mop: "Cash", items: [{ desc: "x", qty: 1, price: 3 }] },
                { id: "pr_4", pr: 4, date: "2026-09-20", buyer: "A", mop: "Cash", items: [{ desc: "x", qty: 2, price: 3 }] }];
    const mk = [{ pr: 2, status: "void" }, { pr: 3, status: "unused" }];
    assert.equal(nextPr(es, mk), 5);
    assert.equal(nextPr([es[0]], mk), 4, "marks count toward the next number");
    assert.equal(skipMarked(2, mk), 4);
    assert.equal(checkPr([es[0]], 4, null, mk).gap, false, "marked numbers are not a gap");
    assert.equal(checkPr([es[0]], 5, null, mk).gap, true);
    assert.equal(checkPr(es, 2, null, mk).marked, "void");
    const rows = withMarks(flatten(es), mk);
    assert.deepEqual(rows.map(r => r.pr), [1, 2, 3, 4]);
    assert.equal(rows[3].grand, 9, "marks do not change totals");
    assert.equal(toTSV(rows).split("\n")[2], "\t2\t\tVOID\t\t\t\t\t");
    assert.equal(withMarks(flatten(es), mk, { booklet: 51 }).length, 2, "other booklets hide marks");
}
{
    const mk = (pr, mop, items, x = {}) => ({ id: "pr_" + pr, pr, date: "2026-08-23", buyer: "A", mop, mopRef: "", items, ...x });
    const es = [
        mk(1, "Cash", [{ desc: "English", qty: 10, price: 3 }]),
        mk(2, "Invoice", [{ desc: "English", qty: 200, price: 3 }, { desc: "Tagalog", qty: 150, price: 3 }]),
        mk(3, "Split", [{ desc: "Tagalog", qty: 10, price: 3 }, { desc: "English", qty: 10, price: 3 }], { date: "2026-08-30", payments: [{ method: "Cash", amount: 45 }, { method: "GCash", amount: 15 }] }),
    ];
    const s = bookletSummary(es);
    assert.equal(s.dateRange, "8/23/2026 \u2013 8/30/2026");
    assert.equal(s.firstPr + "-" + s.lastPr, "1-3");
    assert.equal(s.cash.total, 75, "cash: 30 + 45");
    assert.equal(s.online.total, 1065, "online: 1050 + 15");
    assert.equal(s.cash.rows.find(r => r.desc === "English").qty, 15, "10 + 5 split");
    assert.equal(s.online.rows.find(r => r.desc === "English").qty, 205);
    assert.equal(s.cash.total + s.online.total, 1140, "nothing lost");
    assert.equal(summaryTSV(s).split("\n")[0], "PR No.: 1-3\t\t\tDate: 8/23/2026 \u2013 8/30/2026");
    assert.equal(summaryTSV(s).includes("English\t205\t3.00\t615.00"), true, "2-decimal price and total");
}
assert.equal(compressRanges([42750,42746,42747,42748,42703]), "42703, 42746-42748, 42750");
{ const m = markSummary([{ pr: 42703, status: "void" }, { pr: 42749, status: "unused" }, { pr: 42750, status: "unused" }, { pr: 42801, status: "void" }], 42701);
  assert.equal(m.voidText, "42703"); assert.equal(m.unusedText, "42749-42750"); assert.equal(m.void.length, 1, "other booklets excluded"); }
assert.equal(itemColor("GLC Book 4: CCF DNA"), "#0A6CB8", "book 4 is blue");
assert.equal(itemColor("Book 11: Spiritual Warfare"), "#5A1818", "book 11 is maroon");
assert.equal(itemColor("GLC Book 1: Filipino One by One"), itemColor("GLC Book 1: One by One"), "same book, same color");
assert.equal(itemColor("Gospel Tracts English (New)"), "#1B8EA0", "tracts are teal");
assert.equal(itemColor("PCS Card"), null, "no color for other items");
// search words (AND), amount, PR range, payment and month filters; date far from the booklet
{
    const es = [
        { id: 'pr_42701', pr: 42701, date: '2026-09-01', buyer: 'ANA', mop: 'Cash', items: [{ desc: 'BOOK A', qty: 1, price: 1500 }] },
        { id: 'pr_42702', pr: 42702, date: '2026-09-03', buyer: 'BEN', mop: 'GCash', items: [{ desc: 'BOOK B', qty: 2, price: 100 }] },
        { id: 'pr_42703', pr: 42703, date: '2026-09-05', buyer: 'CAL', mop: 'Split', payments: [{ method: 'Cash', amount: 50 }, { method: 'GCash', amount: 50 }], items: [{ desc: 'BOOK A', qty: 1, price: 100 }] },
    ];
    assert.equal(filterEntries(es, { q: 'book a ana' }).length, 1);
    assert.equal(filterEntries(es, { q: '1500' }).length, 1);
    assert.equal(filterEntries(es, { q: '42702-42703' }).length, 2);
    assert.equal(filterEntries(es, { mop: 'GCash' }).length, 2); // includes the split's GCash part
    assert.equal(filterEntries(es, { mop: 'Online Payment' }).length, 2); // any non-cash method, incl. the split's online part
    assert.equal(filterEntries(es, { month: '2026-09' }).length, 3);
    assert.equal(filterEntries(es, { month: '2026-10' }).length, 0);
    assert.equal(dateFarFromBooklet(es, 42704, '2026-09-20'), null);
    assert.equal(dateFarFromBooklet(es, 42704, '2025-09-20').days > 300, true);
    assert.equal(dateFarFromBooklet(es.slice(0, 2), 42704, '2025-09-20'), null); // too little data to judge
}
console.log("all tests passed");


// Sales summary per week (Sunday-Saturday) and per month
assert.equal(salesCategory("GLC Book 7: The Family Life (New)"), "GLC BOOKS");
assert.equal(salesCategory("Gospel Tracts English (New)"), "GOSPEL TRACTS");
assert.equal(salesCategory("GLC Jacket (Black)"), "MERCH");
assert.equal(salesCategory("Real Talk Booklet"), "DISCIPLESHIP MATERIALS");
assert.equal(periodOf("2026-09-13", "week").from, "2026-09-13"); // a Sunday
assert.equal(periodOf("2026-09-19", "week").to, "2026-09-19");
assert.equal(periodOf("2026-09-20", "week").from, "2026-09-20");
assert.equal(periodOf("2026-02-10", "month").to, "2026-02-28");
const sales = [
    { id: "a", pr: 1, date: "2026-09-13", items: [{ desc: "GLC Book 1: One by One", qty: 2, price: 50 }], mop: "Cash" },
    { id: "b", pr: 2, date: "2026-09-19", items: [{ desc: "Real Talk Booklet", qty: 2, price: 25 }], mop: "GCash" },
    { id: "c", pr: 3, date: "2026-09-20", items: [{ desc: "Gospel Tracts English (New)", qty: 10, price: 3 }], mop: "Cash" },
    { id: "d", pr: 4, date: "2026-10-01", items: [{ desc: "GLC Jacket (Black)", qty: 1, price: 1000 }], mop: "Cash" },
];
const wk = salesSummary(sales, "week");
assert.deepEqual(wk.map(w => [w.receipts, w.units, w.total]), [[2, 4, 150], [1, 10, 30], [1, 1, 1000]]);
assert.equal(wk[0].online, 50);
assert.equal(wk[0].cash, 100);
const mo = salesSummary(sales, "month");
assert.deepEqual(mo.map(m => [m.label, m.receipts, m.total]), [["September 2026", 3, 180], ["October 2026", 1, 1000]]);
assert.equal(salesSummaryCSV(mo, "month").split("\r\n").length, 4);

// Monitoring sheet matrix
assert.equal(sheetDescFor("GLC Book 7: The Family Life (Old)"), "GLC Book 7: The Family Life (OLD)");
assert.equal(sheetDescFor("Book 1: One by One 4th Edition"), "GLC Book 1: One by One (NEW)");
assert.equal(sheetDescFor("GLC Book 1: Filipino One by One"), "GLC Book 1 (Filipino): One by One");
assert.equal(sheetDescFor("Book 11 : Spiritual Warfare"), "GLC Book 11: Spiritual Warfare");
assert.equal(sheetDescFor("Gospel Tracts Tagalog (New)"), "Gospel Tract Tagalog");
assert.equal(sheetDescFor("70X7 USB"), "70X7 USB");
assert.equal(sheetDescFor("70X7 Work Books"), "70X7 Workbook");
assert.equal(sheetDescFor("Motivate Chinese"), "Motivate Book (Chinese)");
assert.equal(sheetDescFor("GLC Jacket (Black)"), null);
assert.equal(sheetDescFor("BLACK GLC Jacket - 2XL"), "BLACK GLC Jacket - 2XL");
assert.equal(sheetDescFor("GREEN GLC Polo Shirt - Medium"), "GREEN GLC Polo Shirt - Medium");
assert.equal(SHEET_ROWS.length, 71);
assert.equal(SHEET_ROWS.every(r => sheetDescFor(r.desc) === r.desc || /Elevate/.test(r.desc)), true);
const mx = salesMatrix(sales, "week");
assert.equal(mx.rows.find(r => r.desc === "GLC Book 1: One by One (NEW)").qtys[0], 2);
assert.equal(mx.rows.find(r => r.desc === "Gospel Tract English").total, 10);
assert.equal(mx.rows.find(r => r.desc === "GLC Jacket (Black)").category, "OTHER (NOT ON SHEET)");

// Shorthand shown next to each item
const scat = [{ desc: "Gospel Tracts English (New)", price: 3 }, { desc: "GLC Book 7: The Family Life (New)", price: 80 }, { desc: "GLC Book 7: The Family Life", price: 80 },
    { desc: "GLC Book 1: Filipino One by One", price: 50 }, { desc: "Real Talk Booklet", price: 25 }, { desc: "Dgroup kit", price: 200, code: "dk" }];
assert.equal(itemShortcut(scat, scat[0]), "gte");
assert.equal(itemShortcut(scat, scat[2]), "b7");
assert.equal(itemShortcut(scat, scat[1]), "b7n");
assert.equal(itemShortcut(scat, scat[3]), "fb1");
assert.equal(itemShortcut(scat, scat[4]), "rtb");
assert.equal(itemShortcut(scat, scat[5]), "dk");
// CATEGORY column of the final report
assert.equal(itemCategory("Book 6: Basic Doctrines 4th Edition"), "GLC BOOKS");
assert.equal(itemCategory("Motivate Book English"), "DISCIPLESHIP MATERIALS");
assert.equal(itemCategory("Life Goals Magazine 2nd Edition"), "DISCIPLESHIP MATERIALS");
assert.equal(itemCategory("True Life Payment"), "GLC EVENTS");
assert.equal(itemCategory("BLACK GLC Jacket - XL"), "MERCH");
assert.equal(itemCategory("Gospel Tracts English (New)"), "GOSPEL TRACTS");
assert.equal(itemCategory("Mystery item"), "OTHER");
assert.equal(prCategory({ items: [{ desc: "Motivate Book English" }, { desc: "Life Goals Magazine 2nd Edition" }] }), "DISCIPLESHIP MATERIALS");
assert.equal(prCategory({ items: [{ desc: "GLC Book 3: The Holy Spirit" }, { desc: "BLACK GLC Jacket - XL" }] }), "GLC BOOKS / MERCH");
assert.equal(flatten([{ id: "q", pr: 5, date: "2026-09-13", buyer: "x", mop: "Cash", items: [{ desc: "True Life Payment", qty: 1, price: 1300 }] }])[0].category, "GLC EVENTS");
assert.equal(itemCategory("GLC Jacket"), "MERCH"); // no size, still merch
assert.equal(itemCategory("GLC Book 8: Something New"), "GLC BOOKS");

// Price history
const ph = priceChanges(
    [{ desc: "A", price: 10 }, { desc: "B", price: 5 }, { desc: "C", price: 1 }],
    [{ desc: "a", price: 12 }, { desc: "B", price: 5 }, { desc: "D", price: 7 }]);
assert.deepEqual(ph.map(c => [c.desc, c.kind, c.oldPrice, c.newPrice]), [["a", "changed", 10, 12], ["D", "added", null, 7], ["C", "removed", 1, null]]);
assert.equal(priceChanges([{ desc: "A", price: 1 }], [{ desc: "A", price: 1 }]).length, 0);

// Items by category sheet
{
    const sec = { rows: [
        { desc: "TLR Participant's workbook", qty: 2, price: 25, total: 50 },
        { desc: "Book 2: Spiritual Disciplines", qty: 9, price: 60, total: 540 },
        { desc: "Book 1: One by One (NEW)", qty: 14, price: 50, total: 700 },
        { desc: "True Life Retreat Payment", qty: 2, price: 1300, total: 2600 },
        { desc: "GLC Jacket - Large", qty: 1, price: 1000, total: 1000 },
        { desc: "Gospel Tract English", qty: 5, price: 3, total: 15 },
        { desc: "Mystery Thing", qty: 1, price: 1, total: 1 },
    ], total: 4906 };
    const g = categoryGroups(sec);
    assert.deepEqual(g.map(x => x.name), ["GLC BOOKS", "GOSPEL TRACTS", "DISCIPLESHIP MATERIALS", "GLC MERCH", "GLC EVENTS", "OTHER"]);
    assert.equal(g[0].rows[0].desc, "Book 1: One by One (NEW)"); // sheet order, not alphabetical
    assert.deepEqual(g[3].rows.map(r => r.desc), ["GLC Jacket - Large"]);
    assert.deepEqual(g[4].rows.map(r => r.desc), ["True Life Retreat Payment"]);
    assert.equal(itemCategory("Baptismal Certificate"), "GLC EVENTS");
    assert.equal(itemCategory("GLC Graduation"), "GLC EVENTS");
    assert.equal(itemCategory("TLR Payment (Participant)"), "GLC EVENTS");
    assert.equal(categoryGroups({ rows: [], total: 0 }).length, 0);
}

// TLR / IDC shirts and Dare to Share belong to DISCIPLESHIP MATERIALS, not MERCH
for (const d of ["IDC T-Shirt", "IDC T-shirt", "TLR T-SHIRT", "TLR T-Shirt Large", "TLR Shirt", "TLR Shirt - Small", "Dare to Share Workbook", "Dare 2 Share", "Date to Share Workbook"]) {
    assert.equal(itemCategory(d), "DISCIPLESHIP MATERIALS", d);
    assert.equal(salesCategory(d), "DISCIPLESHIP MATERIALS", d);
}
assert.equal(itemCategory("GLC Polo Shirt"), "MERCH");
assert.equal(salesCategory("GLC Polo Shirt"), "MERCH");
assert.equal(sheetDescFor("Dare to Share Workbook"), "Dare 2 Share");

// ---- Analytics ----
{
    const row = (id, pr, date, mop, items) => ({ id: "pr_" + id, pr, date, buyer: "A", mop, mopRef: mop === "Invoice" ? "1" : "", items });
    const es = [
        row(55801, 55801, "2026-10-04", "Cash", [{ desc: "Real Talk", qty: 3, price: 25 }, { desc: "Accountability Card", qty: 10, price: 2 }]),
        row(55803, 55803, "2026-10-05", "Invoice", [{ desc: "Real Talk", qty: 2, price: 25 }]),
        row(55805, 55805, "2026-10-05", "Cash", [{ desc: "Real Talk", qty: 1, price: 25 }]),
        row(55808, 55808, "2026-10-06", "Cash", [{ desc: "Real Talk", qty: 1, price: 25 }]),
    ];
    const mk = [{ pr: 55802, status: "unused" }, { pr: 55804, status: "void" }];
    const a = analytics(es, mk);
    assert.equal(a.receipts + "|" + a.total + "|" + a.cash + "|" + a.online, "4|195|145|50", "totals");
    assert.equal(a.avgReceipt, 48.75, "average receipt");
    assert.equal(a.bestDay.date + "|" + a.bestDay.total, "2026-10-04|95", "best day");
    assert.equal(a.biggest.pr, 55801, "biggest receipt");
    assert.equal(a.weekdays[0].total + "|" + a.weekdays[1].total + "|" + a.weekdays[2].total, "95|75|25", "weekday totals (Oct 4, 2026 is a Sunday)");
    assert.equal(a.days.length + "|" + a.activeDays, "3|3", "days");
    assert.equal(a.categories.find(c => c.category === "DISCIPLESHIP MATERIALS").total, 195, "category total");
    assert.equal(a.methods[0].method + "|" + a.methods[0].share, "Cash|74.36", "payment methods, share in percent");
    assert.equal(a.topItems[0].desc + "|" + a.topItems[0].total, "Real Talk|175", "top item");
    assert.equal(a.marks.void + "|" + a.marks.unused + "|" + a.marks.missing, "1|1|2", "55806 and 55807 are missing; marked numbers are not");
    const r = analytics(es, mk, { from: "2026-10-05" });
    assert.equal(r.receipts + "|" + r.total, "3|100", "date range");
    assert.equal(r.marks.missing, 2, "PR number counts ignore the date range");
    const none = analytics([], []);
    assert.equal(none.receipts + "|" + none.total + "|" + none.avgReceipt + "|" + none.bestDay, "0|0|0|null", "empty data does not break");
}

// ---- Booklet exports (Node only: needs the bundled ExcelJS / jsPDF libraries) ----
if (typeof process !== "undefined" && process.versions && process.versions.node) {
    const { buildSummaryWorkbook, buildBookletPdf } = await import("./export.js");
    const { createRequire } = await import("node:module");
    const fs = await import("node:fs");
    const vm = await import("node:vm");
    const ExcelJS = createRequire(import.meta.url)("./vendor/exceljs.min.js");
    const es = [
        { id: "pr_55801", pr: 55801, date: "2026-10-04", buyer: "Pinky Palaguittu", mop: "Cash", mopRef: "", items: [{ desc: "Real Talk", qty: 3, price: 25 }, { desc: "Accountability Card", qty: 10, price: 2 }] },
        { id: "pr_55803", pr: 55803, date: "2026-10-04", buyer: "Gerry T. Torreja", mop: "Invoice", mopRef: "689746", items: [{ desc: "Real Talk", qty: 2, price: 25 }] },
    ];
    const mk = [{ pr: 55802, status: "unused" }, { pr: 55804, status: "void" }];
    const s = { ...bookletSummary(es), ...markSummary(mk, 55801), firstPr: 55801, lastPr: 55850 };
    const counts = [{ value: 100, kind: "Bill", count: 1, amount: 100 }];

    // XLSX: Void / Not used numbers are rows between the receipts, and nothing else mentions them.
    const ws = buildSummaryWorkbook(ExcelJS, s, es, counts, "Ynah Orgasan").getWorksheet("PR Booklet");
    const cell = (r, c) => { const v = ws.getRow(r).getCell(c).value; return v == null ? "" : v; };
    const body = [];
    for (let r = 2; !String(cell(r, 1)).startsWith("***"); r++) body.push(r);
    assert.equal(body.map(r => cell(r, 2) || "").filter(Boolean).join(","), "55801,55802,55803,55804", "marked numbers sit between the receipts");
    const rowOf = pr => body.find(r => cell(r, 2) === pr);
    assert.equal(cell(rowOf(55802), 3) + "|" + cell(rowOf(55802), 4) + "|" + cell(rowOf(55802), 7), "NOT USED||", "not used row: tag only, no note, no amount");
    assert.equal(cell(rowOf(55804), 3) + "|" + cell(rowOf(55804), 4), "VOID|Cancelled sheet, no sale");
    let allText = "";
    ws.eachRow(row => row.eachCell(c => { allText += " " + c.value; }));
    assert.equal(allText.includes("NOT USED:"), false, "no NOT USED note under the table");
    assert.equal(allText.includes("VOID: 55804"), true, "VOID note is kept");
    assert.equal(allText.includes("Cash Sales"), true);
    assert.equal(cell(rowOf(55804), 7) + cell(rowOf(55804), 8), "", "marked rows add no amount");

    // Export -> paste -> import gives back the same receipts and marks.
    const pasted = body.map(r => Array.from({ length: 9 }, (_, i) => cell(r, i + 1)).join("\t")).join("\n");
    const back = parseSheet(pasted);
    assert.equal(back.entries.map(e => e.pr + e.buyer + e.items.length + e.mop).join(","), "55801Pinky Palaguittu2Cash,55803Gerry T. Torreja1Invoice", "receipts round-trip");
    assert.equal(back.marks.map(m => m.pr + m.status).join(","), "55802unused,55804void", "marks round-trip");
    assert.equal(back.skipped.length + "|" + back.warnings.length, "0|0", "nothing skipped or flagged");

    // PDF: the same rows (the text is stored uncompressed, so it can be searched).
    globalThis.window = globalThis;
    globalThis.document = { head: { appendChild(el) { try { vm.runInThisContext(fs.readFileSync(new URL(el.src, import.meta.url), "utf8")); el.onload(); } catch (e) { el.onerror(e); } } }, createElement: () => ({}) };
    const raw = (await buildBookletPdf(s, es, counts, "Ynah Orgasan")).output();
    assert.equal(raw.includes("(NOT USED)") && raw.includes("(55802)"), true, "PDF has the not used row");
    assert.equal(raw.includes("(VOID)") && raw.includes("(Cancelled sheet, no sale)"), true, "PDF has the void row");
    assert.equal(raw.includes("NOT USED: 55802"), false, "PDF has no NOT USED note under the table");
    assert.equal(raw.includes("(VOID: 55804)"), true, "PDF keeps the VOID note");
    delete globalThis.window; delete globalThis.document;
    // buyer autocomplete
{
    const es = [
        { buyer: 'Ana Cruz', date: '2026-09-01' }, { buyer: 'ANA CRUZ', date: '2026-09-02' }, { buyer: 'Ana Cruz', date: '2026-09-03' },
        { buyer: 'Ben Reyes', date: '2026-09-04' }, { buyer: 'Anonymous', date: '2026-09-05' }, { buyer: 'Cathy Ana', date: '2026-09-06' },
        { buyer: 'Ben Reyes', date: '2026-09-07' },
        { buyer: 'Anonyous', date: '2026-09-08' }, { buyer: 'Anonnymous', date: '2026-09-09' },
    ];
    assert.deepEqual(buyerSuggestions(es, '').map(x => x.name), ['Ana Cruz', 'Ben Reyes', 'Cathy Ana']); // most used first, no Anonymous
    assert.equal(buyerSuggestions(es, 'Anonymous').length, 3); // the default name is not a search
    assert.deepEqual(buyerSuggestions(es, 'ana').map(x => x.name), ['Ana Cruz', 'Cathy Ana']); // prefix match before contains
    assert.equal(buyerSuggestions(es, 'ana')[0].n, 3); // capital variants merged
    assert.deepEqual(buyerSuggestions(es, 'ben re'), [{ name: 'Ben Reyes', n: 2 }]);
    assert.equal(buyerSuggestions(es, 'Ben Reyes').length, 0); // exactly what is typed already
    assert.equal(buyerSuggestions(es, 'zzz').length, 0);
}

console.log("all tests passed (including the exports)");
}

// Online payment channels
{
    const L = await import("./logic.js");
    const mk = (pr, over) => ({ id: "pr_" + pr, pr, date: "2026-09-13", buyer: "A", mop: "Cash", mopRef: "", items: [{ desc: "Gospel Tract English", qty: 10, price: 3 }], ...over });
    const gc = mk(1, { mop: "Online Payment", mopChannel: "GCash", mopRef: "689746" });
    const bdoNoRef = mk(2, { mop: "Online Payment", mopChannel: "BDO" });
    const noCh = mk(3, { mop: "Online Payment", mopRef: "55" });
    const split = mk(4, { mop: "Split", items: [{ desc: "Gospel Tract English", qty: 20, price: 3 }], payments: [{ method: "Cash", amount: 20 }, { method: "Online Payment", amount: 40, ref: "9", channel: "GoTyme" }] });
    const cash = mk(5, {});
    assert.equal(L.mopText(gc), "ONLINE PAYMENT - GCash REF # 689746");
    assert.equal(L.mopText(bdoNoRef), "Online Payment - BDO");
    assert.equal(L.mopText(noCh), "ONLINE PAYMENT REF # 55");
    assert.equal(L.mopText(split), "Cash 20.00 + ONLINE PAYMENT - GoTyme REF # 9 40.00");
    const ps = L.paymentSplit(L.flatten([gc, bdoNoRef, noCh, split, cash]));
    assert.deepEqual(ps.byChannel, { GCash: 30, BDO: 30, "": 30, GoTyme: 40 });
    assert.equal(ps.online, 130);
    const all = [gc, bdoNoRef, noCh, split, cash];
    assert.deepEqual(L.filterEntries(all, { mop: "channel:gcash" }).map(e => e.pr), [1]);
    assert.deepEqual(L.filterEntries(all, { mop: "channel:GoTyme" }).map(e => e.pr), [4]);
    assert.deepEqual(L.filterEntries(all, { mop: "Online Payment" }).map(e => e.pr), [1, 2, 3, 4]);
    assert.deepEqual(L.filterEntries(all, { q: "gcash" }).map(e => e.pr), [1]);
    assert.deepEqual(L.channelTotals(all).map(c => [c.channel, c.total]), [["GoTyme", 40], ["BDO", 30], ["GCash", 30], ["No channel", 30]]);
    assert.deepEqual(L.channelTotals([cash, noCh]), []);
    // the per-channel split is hidden: one online total, no channel rows in summaries, copy text or analytics
    assert.equal(L.SHOW_CHANNEL_TOTALS, false);
    assert.equal(L.bookletSummary(all).channels.length, 0);
    assert.equal(L.analytics(all, [], {}).channels.length, 0);
    assert.equal(L.analytics(all, [], {}).channelsNone, 0);
    const tsv = L.summaryTSV(L.bookletSummary(all));
    assert.ok(!/GCash|BDO|GoTyme|No channel/.test(tsv), "copy summary has no channel rows");
    assert.ok(/ONLINE PAYMENT\n/.test(tsv) && /\nTOTAL\t\t\t/.test(tsv));
    assert.equal(L.matchChannel(["GCash", "BDO"], " gcash "), "GCash");
    assert.equal(L.matchChannel(["GCash"], "Coins.ph"), "Coins.ph");
    // text round trip (export -> import)
    const sheet = ["DATE\tPR NUMBER\tBUYER\tSOLD ITEMS\tQTY\tUNIT PRICE\tTOTAL\tGRAND TOTAL\tMOP"];
    for (const e of all) L.flatten([e]).forEach((r, i) => sheet.push([r.first ? "09-13-2026" : "", r.first ? r.pr : "", r.first ? "A" : "", r.desc, r.qty, r.price, r.total, r.grand, r.first ? r.mop : ""].join("\t")));
    const back = L.parseSheet(sheet.join("\n")).entries;
    assert.equal(back.find(e => e.pr === 1).mopChannel, "GCash");
    assert.equal(back.find(e => e.pr === 1).mopRef, "689746");
    assert.equal(back.find(e => e.pr === 2).mopChannel, "BDO");
    assert.equal(back.find(e => e.pr === 2).mopRef, "");
    assert.equal(back.find(e => e.pr === 3).mopChannel, undefined);
    assert.equal(back.find(e => e.pr === 4).payments[1].channel, "GoTyme");
    assert.equal(back.find(e => e.pr === 4).payments[1].ref, "9");
}

// Version history
{
    const L = await import("./logic.js");
    const base = { id: "pr_7", pr: 7, date: "2026-09-13", buyer: "A", mop: "Cash", items: [{ desc: "Gospel Tract English", qty: 10, price: 3 }] };
    assert.deepEqual(L.diffEntries(null, base), ["Receipt created"]);
    assert.deepEqual(L.diffEntries(base, null), ["Receipt deleted"]);
    assert.deepEqual(L.diffEntries(base, { ...base }), []);
    const ed = { ...base, buyer: "B", mop: "Online Payment", mopChannel: "GCash", items: [{ desc: "Gospel Tract English", qty: 12, price: 3 }, { desc: "Bible", qty: 1, price: 100 }] };
    const d = L.diffEntries(base, ed);
    assert.ok(d.some(x => x.startsWith("Buyer: A")));
    assert.ok(d.some(x => x.startsWith("Payment:") && x.includes("GCash")));
    assert.ok(d.some(x => x.startsWith("Added 1 x Bible")));
    assert.ok(d.some(x => x.includes("Gospel Tract English: 10")));
    assert.ok(d.some(x => x.startsWith("Total:")));
    assert.ok(L.diffEntries(ed, { ...ed, items: [ed.items[0]] }).some(x => x.startsWith("Removed 1 x Bible")));
    // trimming keeps the newest 20 per PR
    const hist = [];
    for (let i = 1; i <= 25; i++) hist.push({ id: `7_${i}`, pr: 7, at: i, action: "edited", data: base });
    hist.push({ id: "8_1", pr: 8, at: 1, action: "added", data: base });
    const trim = L.versionsToTrim(hist, 7);
    assert.equal(trim.length, 5);
    assert.deepEqual(trim.sort(), ["7_1", "7_2", "7_3", "7_4", "7_5"]);
    assert.equal(L.versionsToTrim(hist, 8).length, 0);
    assert.equal(L.versionsForPr(hist, 7)[0].at, 25);
    // deleted PRs: newest version is a deletion and no receipt exists now
    const h2 = [{ id: "a", pr: 1, at: 1, action: "added" }, { id: "b", pr: 1, at: 2, action: "deleted" },
        { id: "c", pr: 2, at: 1, action: "deleted" }, { id: "d", pr: 2, at: 3, action: "restored" },
        { id: "e", pr: 3, at: 1, action: "deleted" }];
    assert.deepEqual(L.deletedPrs(h2, [{ pr: 3 }]).map(v => v.pr), [1]);
    assert.deepEqual(L.deletedPrs(h2, []).map(v => v.pr), [1, 3]);
}

// Date cascade
{
    const L = await import("./logic.js");
    const mk = (pr, date) => ({ id: "pr_" + pr, pr, date, items: [] });
    const all = [mk(42784, "2026-09-20"), mk(42785, "2026-09-13"), mk(42786, "2026-09-25"), mk(42787, "2026-09-20"), mk(42783, "2026-09-10"), mk(42801, "2026-09-01")];
    const r = L.cascadeDateTargets(all, mk(42784, "2026-09-20"));
    assert.deepEqual(r.change.map(e => e.pr), [42785, 42786]); // later in booklet, different date (even a newer one); not the same date, earlier PR or next booklet
    assert.deepEqual(r.skipped, []);
    const r2 = L.cascadeDateTargets(all, mk(42784, "2026-09-20"), pr => pr === 42786);
    assert.deepEqual(r2.change.map(e => e.pr), [42785]);
    assert.deepEqual(r2.skipped.map(e => e.pr), [42786]);
    assert.deepEqual(L.cascadeDateTargets(all, mk(42800, "2026-10-01")).change, []);
    assert.deepEqual(L.cascadeDateTargets(all, mk(42760, "2026-09-05")).change.map(e => e.pr), [42783, 42784, 42785, 42786, 42787]);
}

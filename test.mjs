// Run with: node test.mjs (or open test.html through a local web server)
const assert = {
    equal(a, b, m) { if (a !== b) throw new Error((m || "equal") + ": " + a + " !== " + b); },
    deepEqual(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("deepEqual: " + JSON.stringify(a) + " vs " + JSON.stringify(b)); },
};
import { itemColor, flatten, toTSV, checkPr, nextPr, mopText, filterEntries, dateFarFromBooklet, bookletStart, bookletLabel, bookletStats, bookletStarts, paymentSplit, resolveShortcut, reviewSequence, reviewProgress, pesoWords, bookletSummary, summaryTSV, markSummary, compressRanges, parseSheet, skipMarked, withMarks, salesSummary, salesCategory, periodOf, salesSummaryCSV, sheetDescFor, salesMatrix, SHEET_ROWS, itemShortcut, itemCategory, prCategory, priceChanges, categoryGroups } from "./logic.js";
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

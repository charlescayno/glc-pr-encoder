// Run with: node test.mjs (or open test.html through a local web server)
const assert = {
    equal(a, b, m) { if (a !== b) throw new Error((m || "equal") + ": " + a + " !== " + b); },
    deepEqual(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("deepEqual: " + JSON.stringify(a) + " vs " + JSON.stringify(b)); },
};
import { flatten, toTSV, checkPr, nextPr, mopText, filterEntries, bookletStart, bookletLabel, bookletStats, bookletStarts, paymentSplit, resolveShortcut } from "./logic.js";

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
console.log("all tests passed");

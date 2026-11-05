// Run with: node test.mjs (or open test.html through a local web server)
const assert = {
    equal(a, b, m) { if (a !== b) throw new Error((m || "equal") + ": " + a + " !== " + b); },
    deepEqual(a, b) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error("deepEqual: " + JSON.stringify(a) + " vs " + JSON.stringify(b)); },
};
import { flatten, toTSV, checkPr, nextPr, mopText, filterEntries, bookletStart, bookletLabel, bookletStats, bookletStarts } from "./logic.js";

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
console.log("all tests passed");

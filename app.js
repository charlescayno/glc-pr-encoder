import { downloadBookletPdf, viewBookletPdf, printBookletPdf, downloadSummaryXlsx } from "./export.js";
import { itemColor, markSummary, bookletSummary, summaryTSV, parseSheet, skipMarked, withMarks, markLabel } from "./logic.js";
import { SHEET_0920 } from "./seed-sheet.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import {
    getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import {
    money, fmtDate, entryTotal, filterEntries, flatten, toTSV, toCSV, nextPr, checkPr, round2,
    BOOKLET_SIZE, bookletStart, bookletLabel, bookletStats, bookletStarts, paymentSplit, resolveShortcut, paymentText, mopText, reviewSequence, reviewProgress, pesoWords
} from "./logic.js";

// ---------- Firebase (shared glc-inventory project, separate collection) ----------
const firebaseConfig = {
    apiKey: "AIzaSyATwpPiw_l3WiOAsdGBfU5DAKW3EgiYqBc",
    authDomain: "glc-inventory-cfeb1.firebaseapp.com",
    projectId: "glc-inventory-cfeb1",
    storageBucket: "glc-inventory-cfeb1.firebasestorage.app",
    messagingSenderId: "1010755900202",
    appId: "1:1010755900202:web:8bfce9d1c54cad2ae2c453"
};
// Never use the inventory's documents (inventory/main, history/main, receipts/main).
const COLLECTION = "pr_encoder_entries";
const db = getFirestore(initializeApp(firebaseConfig));
const col = collection(db, COLLECTION);
// Void / not-used sheets found during review (separate collection, one document per PR number).
const marksCol = collection(db, "pr_encoder_marks");

// ---------- State ----------
const LS_ENTRIES = "pre_entries_v1";
const LS_CATALOG = "pre_catalog_v1";
const LS_THEME = "pre_theme";
const LS_LAST_DATE = "pre_last_date";
const LS_LAST_PR = "pre_last_pr";

let entries = loadLocal();
let remoteOk = false;
let editingId = null;
let catalog = loadCatalog();
const LS_MARKS = "pre_marks_v1";
let marks = (() => { try { return JSON.parse(localStorage.getItem(LS_MARKS)) || []; } catch { return []; } })();
let rv = null;                // review session: { start, pr, summary }
let reviewEditing = false;    // the encoder card is open as a dialog inside the review
let splitOn = false;          // split payment (part cash, part online) for the current form
let splitAnchor = "cash";     // which split amount the user typed last; the other is calculated
let formSum = 0;              // current receipt total

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const peso = n => "\u20B1 " + money(n);
const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

function loadLocal() {
    try { return JSON.parse(localStorage.getItem(LS_ENTRIES)) || []; } catch { return []; }
}
function saveLocal() { localStorage.setItem(LS_ENTRIES, JSON.stringify(entries)); }
function loadCatalog() {
    try { const c = JSON.parse(localStorage.getItem(LS_CATALOG)); if (Array.isArray(c) && c.length) return c; } catch { /* ignore */ }
    return (window.CATALOG || []).map(c => ({ desc: c.desc, price: c.price }));
}

// ---------- Status / toast ----------
function setStatus(kind, label) {
    $("syncStatus").className = `sync-indicator status-${kind}`;
    $("syncLabel").textContent = label;
}
let toastTimer;
function toast(msg) {
    const t = $("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 3000);
}

// ---------- Firestore sync ----------
onSnapshot(col, snap => {
    remoteOk = true;
    entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    saveLocal();
    setStatus("online", "Online");
    refresh();
    if (rv && !reviewEditing) renderReview();
}, err => {
    console.error("Firestore listener error", err);
    remoteOk = false;
    setStatus("error", "Local only");
    toast("Cloud sync unavailable. Data is saved on this device only.");
    refresh();
});

onSnapshot(marksCol, snap => {
    marks = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    localStorage.setItem(LS_MARKS, JSON.stringify(marks));
    refresh();
    if (rv) renderReview();
}, err => {
    console.error("Marks listener error", err);
});

function marksFail(err) {
    console.error(err);
    toast("Could not save the void / not-used mark to the cloud. Saved on this device only.");
}

function remoteFail(err) {
    console.error(err);
    remoteOk = false;
    setStatus("error", "Local only");
    toast("Could not save to cloud. Saved on this device only.");
}

async function persist(entry, oldId) {
    const old = oldId && entries.find(e => e.id === oldId);
    if (isLocked(entry.pr) || (old && isLocked(old.pr))) return lockedToast();
    const idx = entries.findIndex(e => e.id === entry.id);
    if (oldId && oldId !== entry.id) entries = entries.filter(e => e.id !== oldId);
    if (idx >= 0) entries[idx] = entry; else entries.push(entry);
    saveLocal();
    refresh();
    const { id, ...data } = entry;
    try {
        if (oldId && oldId !== id) deleteDoc(doc(col, oldId)).catch(remoteFail);
        setDoc(doc(col, id), data).catch(remoteFail);
    } catch (e) { remoteFail(e); }
}

// ---------- Booklet locks: a locked booklet cannot be changed until it is unlocked ----------
const LS_LOCKS = "pre_locks_v1";
const locksCol = collection(db, "pr_encoder_locks");
let locks = (() => { try { return JSON.parse(localStorage.getItem(LS_LOCKS)) || []; } catch { return []; } })(); // booklet start numbers
onSnapshot(locksCol, snap => {
    locks = snap.docs.map(d => Number(d.data().start)).filter(Number.isFinite);
    localStorage.setItem(LS_LOCKS, JSON.stringify(locks));
    refresh();
    if (rv && !reviewEditing) renderReview();
}, err => console.error("Locks listener error", err));

const isLocked = pr => locks.includes(bookletStart(Number(pr)));
const lockedToast = () => toast("This booklet is locked. Unlock it first to make changes.");

function toggleLock(start) {
    const on = !locks.includes(start);
    if (!on && !confirm(`Unlock booklet ${bookletLabel(start)}? It can be changed again.`)) return;
    locks = on ? [...locks, start] : locks.filter(s => s !== start);
    localStorage.setItem(LS_LOCKS, JSON.stringify(locks));
    const ref = doc(locksCol, `bk_${start}`);
    (on ? setDoc(ref, { start, at: Date.now() }) : deleteDoc(ref)).catch(err => {
        console.error(err); toast("Could not save the lock to the cloud. Saved on this device only.");
    });
    refresh();
    if (rv) renderReview();
    toast(on ? `Booklet ${bookletLabel(start)} locked.` : `Booklet ${bookletLabel(start)} unlocked.`);
}

// Review: tick or untick one PR as verified against the paper sheet.
function setChecked(id, on) {
    const i = entries.findIndex(e => e.id === id);
    if (i < 0) return;
    if (isLocked(entries[i].pr)) return lockedToast();
    const e = { ...entries[i] };
    if (on) e.checkedAt = Date.now(); else delete e.checkedAt;
    entries[i] = e;
    saveLocal();
    refresh();
    const { id: _id, ...data } = e;
    setDoc(doc(col, id), data).catch(remoteFail);
}

function setMark(pr, status) {
    if (isLocked(pr)) return lockedToast();
    const id = `pr_${pr}`;
    const m = { id, pr, status, at: Date.now() };
    marks = marks.filter(x => x.id !== id).concat(m);
    localStorage.setItem(LS_MARKS, JSON.stringify(marks));
    refresh();
    const { id: _id, ...data } = m;
    setDoc(doc(marksCol, id), data).catch(marksFail);
}

function clearMark(pr) {
    if (isLocked(pr)) return lockedToast();
    const id = `pr_${pr}`;
    marks = marks.filter(x => x.id !== id);
    localStorage.setItem(LS_MARKS, JSON.stringify(marks));
    refresh();
    deleteDoc(doc(marksCol, id)).catch(marksFail);
}

function removeEntry(id) {
    const cur = entries.find(e => e.id === id);
    if (cur && isLocked(cur.pr)) return lockedToast();
    entries = entries.filter(e => e.id !== id);
    saveLocal();
    refresh();
    deleteDoc(doc(col, id)).catch(remoteFail);
}

// ---------- Form ----------
function catalogOptions() {
    $("catalogList").innerHTML = catalog.map(c => `<option value="${esc(c.desc)}" label="${esc(peso(c.price))}"></option>`).join("");
}

function addItemRow(item = { desc: "", qty: 1, price: "" }) {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
        <label class="cell item-name-cell"><span>Item</span>
            <input class="item-name" type="text" list="catalogList" placeholder="Search, or type a shorthand (e.g. gte, b1)" value="${esc(item.desc)}">
            <small class="sc-hint hidden"></small></label>
        <label class="cell"><span>Qty</span>
            <input class="item-qty" type="number" min="1" step="1" placeholder="Qty" value="${item.qty}"></label>
        <label class="cell"><span>Unit Price</span>
            <input class="item-price" type="number" min="0" step="0.01" placeholder="0.00" value="${item.price}"></label>
        <div class="cell"><span>Total</span><div class="line-total">${peso(item.qty * (item.price || 0))}</div></div>
        <button type="button" class="btn btn-danger btn-icon-only" title="Remove item" tabindex="-1"><i class="ri-close-line"></i></button>`;
    const name = row.querySelector(".item-name");
    const qty = row.querySelector(".item-qty");
    const price = row.querySelector(".item-price");
    const hint = row.querySelector(".sc-hint");
    name.addEventListener("input", () => {
        const hit = catalog.find(c => c.desc.toLowerCase() === name.value.trim().toLowerCase());
        if (hit) price.value = hit.price;
        showShortcutHint(name, hint);
        updateFormTotal();
    });
    // Shorthand is applied when you leave the field (Tab / click away) or press Enter.
    name.addEventListener("change", () => { applyShortcut(name); showShortcutHint(name, hint); });
    name.addEventListener("blur", () => hint.classList.add("hidden"));
    qty.addEventListener("input", updateFormTotal);
    price.addEventListener("input", updateFormTotal);
    row.querySelector("button").addEventListener("click", () => {
        if ($("itemsList").children.length > 1) row.remove(); else { name.value = ""; qty.value = 1; price.value = ""; }
        updateFormTotal();
    });
    $("itemsList").appendChild(row);
    updateFormTotal();
    return row;
}

// ---- Item shorthand: type "gte" -> Gospel Tracts English (New) ----
function showShortcutHint(nameInput, hintEl) {
    const r = resolveShortcut(catalog, nameInput.value);
    if (r.status === "one") {
        hintEl.textContent = `Enter \u2192 ${r.items[0].desc} (${peso(r.items[0].price)})`;
        hintEl.classList.remove("hidden", "warn-text");
    } else if (r.status === "many") {
        hintEl.textContent = `${r.items.length} matches: ` + r.items.slice(0, 3).map(i => i.desc).join(" | ") + (r.items.length > 3 ? " ..." : "");
        hintEl.classList.remove("hidden");
        hintEl.classList.add("warn-text");
    } else {
        hintEl.classList.add("hidden");
    }
}
function applyShortcut(nameInput) {
    const r = resolveShortcut(catalog, nameInput.value);
    if (r.status !== "one") return false;
    const row = nameInput.closest(".item-row");
    nameInput.value = r.items[0].desc;
    row.querySelector(".item-price").value = r.items[0].price;
    updateFormTotal();
    return true;
}

function readItems() {
    return [...$("itemsList").children].map(r => ({
        desc: r.querySelector(".item-name").value.trim(),
        qty: Number(r.querySelector(".item-qty").value),
        price: Number(r.querySelector(".item-price").value),
        _raw: r
    }));
}

function updateFormTotal() {
    let sum = 0;
    for (const r of $("itemsList").children) {
        const line = round2((Number(r.querySelector(".item-qty").value) || 0) * (Number(r.querySelector(".item-price").value) || 0));
        r.querySelector(".line-total").textContent = peso(line);
        sum += line;
    }
    formSum = round2(sum);
    $("formTotal").textContent = peso(formSum);
    recalcSplit();
}

// ---- Split payment (special case): part cash, part online ----
function recalcSplit() {
    if (!splitOn) return;
    if (splitAnchor === "cash") {
        const cash = Number($("sCash").value) || 0;
        const online = round2(formSum - cash);
        $("sOnline").value = formSum > 0 ? String(online) : "";
    } else {
        const online = Number($("sOnline").value) || 0;
        const cash = round2(formSum - online);
        $("sCash").value = formSum > 0 ? String(cash) : "";
    }
    const cash = Number($("sCash").value) || 0;
    const online = Number($("sOnline").value) || 0;
    const note = $("splitNote");
    note.className = "split-note";
    if (formSum <= 0) note.textContent = "Add items first. The receipt total is \u20B1 0.00.";
    else if (cash < 0 || online < 0) { note.textContent = "Amounts cannot be more than the receipt total."; note.classList.add("bad"); }
    else if (cash === 0 || online === 0) note.textContent = `Enter the cash amount. Online gets the rest (receipt total ${peso(formSum)}).`;
    else { note.textContent = `Cash ${peso(cash)} + Online ${peso(online)} = ${peso(round2(cash + online))}`; note.classList.add("ok"); }
}

function toggleSplit(on) {
    splitOn = on;
    $("splitPanel").classList.toggle("hidden", !on);
    $("fMop").disabled = on;
    $("splitBtnText").textContent = on ? "Single payment" : "Split payment";
    $("splitBtn").classList.toggle("btn-primary", on);
    $("splitBtn").classList.toggle("btn-secondary", !on);
    if (on) {
        $("refField").classList.add("hidden");
        $("fRef").value = "";
        $("sCash").value = ""; $("sOnline").value = ""; $("sRef").value = "";
        splitAnchor = "cash";
        updateSplitRefLabel();
        recalcSplit();
    } else {
        $("sCash").value = ""; $("sOnline").value = ""; $("sRef").value = "";
        updateRefField();
    }
}
function updateSplitRefLabel() {
    $("sRefLabel").textContent = $("sMethod").value === "Invoice" ? "Invoice No." : "Reference No.";
}
$("splitBtn").addEventListener("click", () => { toggleSplit(!splitOn); if (splitOn) $("sCash").focus(); });
$("sCash").addEventListener("input", () => { splitAnchor = "cash"; recalcSplit(); });
$("sOnline").addEventListener("input", () => { splitAnchor = "online"; recalcSplit(); });
$("sMethod").addEventListener("change", () => { updateSplitRefLabel(); $("sRef").focus(); });

function updatePrWarning() {
    const el = $("prWarn");
    const pr = $("fPr").value;
    if (!pr) { el.classList.add("hidden"); return true; }
    const { duplicate, gap, expected, marked } = checkPr(entries, pr, editingId, marks);
    el.classList.remove("error");
    if (isLocked(pr)) {
        el.textContent = `Booklet ${bookletLabel(bookletStart(Number(pr)))} is locked. Unlock it to add or change PR #${pr}.`;
        el.classList.add("error");
        el.classList.remove("hidden");
        return false;
    }
    if (marked && !duplicate) {
        el.textContent = `PR #${pr} is marked ${markLabel(marked)}. Adding a receipt with this number clears that mark.`;
        el.classList.remove("hidden");
        return true;
    }
    if (duplicate) {
        el.textContent = `PR #${pr} already exists. Use a different number, or edit the existing receipt.`;
        el.classList.add("error");
        el.classList.remove("hidden");
        return false;
    }
    if (gap) {
        el.textContent = `PR #${pr} skips ahead. The next expected number is #${expected}.`;
        el.classList.remove("hidden");
    } else {
        el.classList.add("hidden");
    }
    return true;
}

function resetForm() {
    editingId = null;
    // Date stays on the last one used until the user changes it.
    setDate(localStorage.getItem(LS_LAST_DATE) || todayISO());
    // Batch encoding: continue from the last encoded PR (42701 -> 42702).
    const lastPr = Number(localStorage.getItem(LS_LAST_PR));
    $("fPr").value = skipMarked(lastPr > 0 ? lastPr + 1 : nextPr(entries, marks), marks);
    $("fBuyer").value = "Anonymous";
    $("fMop").value = "Cash";
    $("fRef").value = "";
    toggleSplit(false);
    $("sMethod").value = "Invoice";
    $("itemsList").innerHTML = "";
    addItemRow();
    $("formTitle").textContent = "New Provisional Receipt";
    $("submitText").textContent = "Add PR to output";
    $("editBadge").classList.add("hidden");
    $("cancelEditBtn").classList.add("hidden");
    updatePrWarning();
    updateBookletHint();
}

function startEdit(id) {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    if (isLocked(e.pr)) { lockedToast(); return; }
    editingId = id;
    setDate(e.date);
    $("fPr").value = e.pr;
    $("fBuyer").value = e.buyer || "";
    const isSplit = Array.isArray(e.payments) && e.payments.length > 0;
    toggleSplit(false);
    if (!isSplit) {
        $("fMop").value = e.mop && e.mop !== "Split" ? e.mop : "Cash";
        $("fRef").value = e.mopRef || "";
        updateRefField();
    }
    $("itemsList").innerHTML = "";
    e.items.forEach(addItemRow);
    if (isSplit) {
        const cashPay = e.payments.find(p => p.method === "Cash");
        const onlinePay = e.payments.find(p => p.method !== "Cash");
        toggleSplit(true);
        $("sCash").value = cashPay ? String(cashPay.amount) : "";
        if (onlinePay) { $("sMethod").value = onlinePay.method; $("sRef").value = onlinePay.ref || ""; }
        updateSplitRefLabel();
        splitAnchor = "cash";
        recalcSplit();
    }
    $("formTitle").textContent = `Edit PR #${e.pr}`;
    $("submitText").textContent = "Save changes";
    $("editBadge").classList.remove("hidden");
    $("cancelEditBtn").classList.remove("hidden");
    updatePrWarning();
    updateBookletHint();
    $("encoderCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function updateRefField() {
    const v = $("fMop").value;
    const show = !!v && v !== "Cash";
    $("refField").classList.toggle("hidden", !show);
    $("refLabel").textContent = v === "Invoice" ? "Invoice No." : "Reference No.";
    if (!show) $("fRef").value = "";
}
$("fMop").addEventListener("change", () => {
    updateRefField();
    if (!$("refField").classList.contains("hidden")) $("fRef").focus();
});
// ---- Date entry: type digits only (0913 2026 -> 09-13-2026), or use Today / arrows ----
function setDate(iso) { $("fDate").value = iso ? fmtDate(iso) : ""; }
function getDate() {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec($("fDate").value.trim());
    if (!m) return "";
    const [, mm, dd, yyyy] = m;
    const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
    if (d.getFullYear() !== Number(yyyy) || d.getMonth() !== Number(mm) - 1 || d.getDate() !== Number(dd)) return "";
    return `${yyyy}-${mm}-${dd}`;
}
function shiftDate(days) {
    const cur = getDate() || todayISO();
    const [y, m, d] = cur.split("-").map(Number);
    const n = new Date(y, m - 1, d + days);
    const iso = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
    setDate(iso);
    localStorage.setItem(LS_LAST_DATE, iso);
}
function maskDigits(d) {
    if (d.length > 4) return `${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`;
    if (d.length > 2) return `${d.slice(0, 2)}-${d.slice(2)}`;
    return d;
}
$("fDate").addEventListener("input", () => {
    const el = $("fDate");
    // Any non-digit the user types (- / . space) is treated as a separator.
    const raw = el.value.replace(/[^\d]+/g, "-").replace(/^-/, "").replace(/-{2,}/g, "-").slice(0, 10);
    const digits = raw.replace(/\D/g, "").slice(0, 8);
    // Typing plain digits gets auto-dashes; typing your own dashes (9-21) is left alone until you finish.
    const segs = raw.split("-");
    const typedSeparators = segs.length > 1 && (segs.slice(0, -1).some(s => s.length < 2) || segs.length > 3);
    el.value = typedSeparators ? raw : maskDigits(digits);
    el.classList.toggle("invalid", el.value.length === 10 && !getDate());
    const iso = getDate();
    if (iso) localStorage.setItem(LS_LAST_DATE, iso);
});
// Partial fill: missing parts come from today's date.
//   "21" or "9-21" -> day only / month+day -> current month / current year
//   "0921", "921", "9-21", "09-21" -> 09-21-<current year>;  "09-21-26" -> 09-21-2026
function completeYear() {
    const el = $("fDate");
    const v = el.value.trim();
    if (!v || getDate()) return;
    const digits = v.replace(/\D/g, "");
    const now = new Date();
    const curM = now.getMonth() + 1, curY = now.getFullYear();
    const pad = n => String(n).padStart(2, "0");
    const valid = (m, d, y) => { const t = new Date(y, m - 1, d); return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d; };
    let m, d, y = curY;

    if (v === maskDigits(digits)) {
        // Plain digits typed with auto-dashes
        if (digits.length <= 2) { m = curM; d = Number(digits); }
        else if (digits.length === 3) {
            m = Number(digits[0]); d = Number(digits.slice(1));            // 921 -> 9/21
            if (!valid(m, d, y)) { m = Number(digits.slice(0, 2)); d = Number(digits[2]); } // 131 -> 1/31, 112 -> 11/2
        }
        else if (digits.length === 4) { m = Number(digits.slice(0, 2)); d = Number(digits.slice(2)); }
        else if (digits.length === 6) { m = Number(digits.slice(0, 2)); d = Number(digits.slice(2, 4)); y = 2000 + Number(digits.slice(4)); }
        else return;
    } else {
        // User typed their own separators
        const p = v.split("-").filter(Boolean).map(Number);
        if (p.length === 1) { m = curM; d = p[0]; }
        else if (p.length === 2) { [m, d] = p; }
        else if (p.length === 3) { [m, d, y] = p; if (y < 100) y += 2000; }
        else return;
    }
    el.value = `${pad(m)}-${pad(d)}-${y}`;
    el.classList.toggle("invalid", !getDate());
    const iso = getDate();
    if (iso) localStorage.setItem(LS_LAST_DATE, iso);
}
$("fDate").addEventListener("blur", completeYear);
$("fDate").addEventListener("keydown", ev => { if (ev.key === "Enter") completeYear(); });
$("fDate").addEventListener("focus", () => $("fDate").select());
$("dateToday").addEventListener("click", () => { setDate(todayISO()); localStorage.setItem(LS_LAST_DATE, todayISO()); });
$("datePrev").addEventListener("click", () => shiftDate(-1));
$("dateNext").addEventListener("click", () => shiftDate(1));
$("fPr").addEventListener("input", () => { updatePrWarning(); updateBookletHint(); });
$("addRowBtn").addEventListener("click", () => addItemRow().querySelector(".item-name").focus());

// ---- Keyboard shortcuts ----
//  Enter       next field (after the last price, starts a new item row)
//  Alt+N       add item row
//  Alt+S       split payment on/off (part cash, part online)
//  Alt+C       MOP: Cash
//  Alt+I       MOP: Invoice (jumps to the invoice number)
//  Ctrl+Enter  add PR to output (Cmd+Enter on Mac)
//  Esc         cancel edit
function formFields() {
    const fixed = ["fDate", "fPr", "fBuyer", "fMop", "fRef", "sCash", "sMethod", "sRef", "sOnline"].map($)
        .filter(el => el.offsetParent !== null && !el.disabled);
    const rows = [...$("itemsList").children].flatMap(r => [".item-name", ".item-qty", ".item-price"].map(s => r.querySelector(s)));
    return [...fixed, ...rows];
}
document.addEventListener("keydown", ev => {
    if (!$("catalogModal").classList.contains("hidden") || !$("importModal").classList.contains("hidden")) return;
    if (rv && !reviewEditing) return; // review screen has its own keys
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key === "Enter") {
        ev.preventDefault();
        $("prForm").requestSubmit();
    } else if (ev.altKey && !mod && ev.key.toLowerCase() === "n") {
        ev.preventDefault();
        addItemRow().querySelector(".item-name").focus();
    } else if (ev.altKey && !mod && ev.key.toLowerCase() === "s") {
        ev.preventDefault();
        toggleSplit(!splitOn);
        if (splitOn) $("sCash").focus();
    } else if (ev.altKey && !mod && ev.key.toLowerCase() === "c") {
        ev.preventDefault();
        if (splitOn) toggleSplit(false);
        $("fMop").value = "Cash";
        updateRefField();
        toast("MOP: Cash");
    } else if (ev.altKey && !mod && ev.key.toLowerCase() === "i") {
        ev.preventDefault();
        if (splitOn) toggleSplit(false);
        $("fMop").value = "Invoice";
        updateRefField();
        $("fRef").focus(); // type the invoice number right away
    } else if (ev.altKey && !mod && ev.key.toLowerCase() === "v") {
        ev.preventDefault();
        markFromForm("void");
    } else if (ev.altKey && !mod && ev.key.toLowerCase() === "u") {
        ev.preventDefault();
        markFromForm("unused");
    } else if (ev.key === "Escape" && editingId) {
        resetForm();
        finishReviewEdit();
    }
});
$("prForm").addEventListener("keydown", ev => {
    // Tab on the last Unit Price adds a new item row below (empty rows are ignored on submit).
    if (ev.key === "Tab" && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.target.classList.contains("item-price")) {
        const rows = [...$("itemsList").children];
        if (ev.target.closest(".item-row") === rows[rows.length - 1]) {
            ev.preventDefault();
            addItemRow().querySelector(".item-name").focus();
        }
        return;
    }
    if (ev.key !== "Enter" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target;
    if (t.tagName !== "INPUT" && t.tagName !== "SELECT") return;
    const fields = formFields();
    const i = fields.indexOf(t);
    if (i < 0) return;
    const go = () => {
        if (i === fields.length - 1) addItemRow().querySelector(".item-name").focus();
        else fields[i + 1].focus();
    };
    if (t.classList.contains("item-name")) {
        applyShortcut(t);
        // Let the browser finish picking a suggestion from the list, but never submit.
        suppressSubmit = true;
        setTimeout(() => { suppressSubmit = false; go(); }, 0);
    } else {
        ev.preventDefault(); // plain Enter never submits by accident
        go();
    }
});
$("cancelEditBtn").addEventListener("click", () => { resetForm(); finishReviewEdit(); });

let suppressSubmit = false;
$("prForm").addEventListener("submit", ev => {
    ev.preventDefault();
    if (suppressSubmit) return;
    if (!updatePrWarning()) { toast(isLocked($("fPr").value) ? "This booklet is locked." : "Duplicate PR number."); return; }
    completeYear();
    $("itemsList").querySelectorAll(".item-name").forEach(applyShortcut); // e.g. submitted with Ctrl+Enter while still on "gte"
    if (!getDate()) { toast("Enter a valid date (MM-DD-YYYY)."); $("fDate").focus(); return; }
    const items = readItems().filter(i => i.desc);
    if (!items.length) { toast("Add at least one sold item."); return; }
    for (const i of items) {
        if (!(i.qty > 0) || !(i.price >= 0) || Number.isNaN(i.price)) {
            toast("Check quantity and unit price."); i._raw.querySelector(".item-price").focus(); return;
        }
    }
    const pr = Number($("fPr").value);
    const entry = {
        id: `pr_${pr}`,
        date: getDate(),
        pr,
        buyer: $("fBuyer").value.trim() || "Anonymous",
        mop: $("fMop").value,
        mopRef: $("fRef").value.trim(),
        items: items.map(({ desc, qty, price }) => ({ desc, qty, price })),
        updatedAt: Date.now()
    };
    if (splitOn) {
        const total = entryTotal(entry);
        const cash = round2(Number($("sCash").value) || 0);
        const online = round2(Number($("sOnline").value) || 0);
        if (!(cash > 0) || !(online > 0)) { toast("Split payment needs both a cash and an online amount."); $("sCash").focus(); return; }
        if (round2(cash + online) !== total) { toast(`Cash + online must equal the receipt total (${peso(total)}).`); $("sCash").focus(); return; }
        entry.mop = "Split";
        entry.mopRef = "";
        entry.payments = [
            { method: "Cash", amount: cash },
            { method: $("sMethod").value, amount: online, ref: $("sRef").value.trim() }
        ];
    }
    const oldId = editingId;
    const wasEdit = !!editingId;
    persist(entry, oldId);
    if (marks.some(m => Number(m.pr) === pr)) clearMark(pr); // a real receipt replaces a void / not-used mark
    if (wasEdit) toast(`PR #${pr} updated.`);
    else if (pr % BOOKLET_SIZE === 0) toast(`PR #${pr} added. Booklet ${bookletLabel(bookletStart(pr))} is fully encoded - next sheet starts a new booklet.`);
    else toast(`PR #${pr} added.`);
    localStorage.setItem(LS_LAST_DATE, entry.date);
    if (!wasEdit) localStorage.setItem(LS_LAST_PR, String(pr));
    resetForm();
    if (reviewEditing) { finishReviewEdit(pr); return; }
    $("itemsList").querySelector(".item-name").focus();
});

// ---------- Output ----------
function currentFilter() {
    return { q: $("searchInput").value, from: $("fromDate").value, to: $("toDate").value, booklet: $("bookletFilter").value, unchecked: $("uncheckedOnly").checked };
}
function visibleRows() {
    const f = currentFilter();
    const rows = flatten(filterEntries(entries, f));
    // Void / not-used numbers belong in the sheet too, unless a search or date filter is narrowing it down.
    return f.q.trim() || f.from || f.to || f.unchecked ? rows : withMarks(rows, marks, f);
}

// Mark the PR number in the form as void (cancelled) or not used (blank / skipped), then move on.
function markFromForm(status) {
    const pr = Number($("fPr").value);
    if (!(pr > 0)) return toast("Enter the PR number first.");
    if (editingId) return toast("Finish or cancel the edit first.");
    if (isLocked(pr)) return lockedToast();
    if (entries.some(e => Number(e.pr) === pr)) return toast(`PR #${pr} already has a receipt. Delete it first if the sheet was cancelled.`);
    setMark(pr, status);
    localStorage.setItem(LS_LAST_PR, String(pr));
    toast(`PR #${pr} marked ${markLabel(status)}.`);
    $("fPr").value = skipMarked(pr + 1, marks);
    updatePrWarning();
    updateBookletHint();
}
$("voidBtn").addEventListener("click", () => markFromForm("void"));
$("unusedBtn").addEventListener("click", () => markFromForm("unused"));

// Booklets (50 sheets each) can be collapsed in the output table.
const collapsedBooklets = new Set();
let bookletsDefaulted = false;
function allBookletStarts() {
    return [...new Set([...entries, ...marks].map(x => bookletStart(x.pr)))];
}
$("collapseBtn").addEventListener("click", () => {
    const starts = allBookletStarts();
    const allCollapsed = starts.length > 0 && starts.every(s => collapsedBooklets.has(s));
    if (allCollapsed) collapsedBooklets.clear(); else starts.forEach(s => collapsedBooklets.add(s));
    refresh();
});

// Review status badge of one booklet (verified / checked x of y), shared by the booklet header and the summary at the bottom.
function reviewBadgeHtml(start, st = bookletStats(entries, start, marks)) {
    const prog = reviewProgress(reviewSequence(entries, marks, start));
    const verified = prog.done && prog.entries > 0;
    return prog.entries
        ? `<span class="bk-badge ${verified ? "verified" : "partial"}" title="${prog.lastAt ? "Last checked " + esc(new Date(prog.lastAt).toLocaleString()) : "Nothing checked yet"}">${verified ? `<i class="ri-checkbox-circle-fill"></i> ${st.complete ? "Verified" : "All checked"}` : `Checked ${prog.checked}/${prog.entries}`}</span>`
        : "";
}

// Cash count status: tallied (counted money matches the PRs), off (counted but different) or not counted yet.
function cashBadgeHtml(start) {
    const cashSaved = loadCashCount(start);
    const cashCounted = DENOMS.reduce((t, d) => round2(t + (Number(cashSaved[d.key]) || 0) * d.value), 0);
    const cashExpected = bookletSummary(entries.filter(e => bookletStart(e.pr) === start)).cash.total;
    const cashDiff = round2(cashCounted - cashExpected);
    return !Object.keys(cashSaved).length
        ? `<span class="bk-badge cc-none" title="Cash count not done yet. Open Review, go to the summary and count the cash."><i class="ri-calculator-line"></i> Cash not counted</span>`
        : cashDiff === 0
            ? `<span class="bk-badge cc-ok" title="Counted cash matches the PRs (${peso(cashExpected)})."><i class="ri-checkbox-circle-fill"></i> Cash tallied</span>`
            : `<span class="bk-badge cc-off" title="Counted ${peso(cashCounted)}, expected ${peso(cashExpected)}."><i class="ri-error-warning-fill"></i> Cash ${cashDiff > 0 ? "over" : "short"} ${peso(Math.abs(cashDiff))}</span>`;
}

// Summary at the bottom of the output: one row per booklet and the grand totals (follows the current filter).
function renderBookletSummary(rows) {
    const box = $("bkSummary");
    const byBook = new Map();
    rows.forEach(r => { const b = bookletStart(r.pr); if (!byBook.has(b)) byBook.set(b, []); byBook.get(b).push(r); });
    if (!byBook.size) { box.innerHTML = ""; return; }
    let cash = 0, online = 0, receipts = 0;
    const body = [...byBook.entries()].sort((a, b) => a[0] - b[0]).map(([start, rs]) => {
        const split = paymentSplit(rs);
        const count = new Set(rs.map(r => r.pr)).size;
        cash = round2(cash + split.cash); online = round2(online + split.online); receipts += count;
        return `<tr data-summary-booklet="${start}" title="Click to show this booklet in the table">
            <td><b>${esc(bookletLabel(start))}</b></td>
            <td class="num">${count} / ${BOOKLET_SIZE}</td>
            <td>${reviewBadgeHtml(start) || "-"}</td>
            <td>${cashBadgeHtml(start)}</td>
            <td class="num">${money(split.cash)}</td>
            <td class="num">${money(split.online)}</td>
            <td class="num"><b>${money(round2(split.cash + split.online))}</b></td></tr>`;
    }).join("");
    box.innerHTML = `
        <h3>Summary</h3>
        <div class="table-container"><table class="bk-summary-table">
            <thead><tr><th>Booklet</th><th class="num">Receipts</th><th>Verified</th><th>Cash count</th><th class="num">Cash</th><th class="num">Online</th><th class="num">Total</th></tr></thead>
            <tbody>${body}</tbody>
            <tfoot><tr><td><b>All booklets</b></td><td class="num">${receipts}</td><td></td><td></td><td class="num">${money(cash)}</td><td class="num">${money(online)}</td><td class="num"><b>${money(round2(cash + online))}</b></td></tr></tfoot>
        </table></div>`;
}
$("bkSummary").addEventListener("click", ev => {
    const tr = ev.target.closest("[data-summary-booklet]");
    if (!tr) return;
    const sel = $("bookletFilter");
    sel.value = tr.dataset.summaryBooklet;
    sel.dispatchEvent(new Event("input"));
    $("outputCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

function bookletHeaderHtml(start, rowsInBooklet) {
    const st = bookletStats(entries, start, marks);
    const reviewBadge = reviewBadgeHtml(start, st);
    const cashBadge = cashBadgeHtml(start);
    const collapsed = collapsedBooklets.has(start);
    const sales = rowsInBooklet.reduce((s, r) => round2(s + r.total), 0);
    const split = paymentSplit(rowsInBooklet);
    const onlineTip = Object.entries(split.byMethod).filter(([m]) => m !== "Cash")
        .map(([m, v]) => `${m}: ${peso(v)}`).join("\n") || "No online payments";
    const pct = Math.round((st.used / BOOKLET_SIZE) * 100);
    const shownMissing = st.missing.slice(0, 8).join(", ") + (st.missing.length > 8 ? `, +${st.missing.length - 8} more` : "");
    const missing = st.missing.length
        ? `<span class="bk-missing" title="Missing sheets: ${esc(st.missing.join(", "))}"><i class="ri-error-warning-line"></i> Missing ${st.missing.length}: ${esc(shownMissing)}</span>`
        : "";
    const status = st.complete ? `<span class="bk-badge done" title="All 50 sheets are encoded. This does not mean they are checked yet.">All encoded</span>` : `<span class="bk-badge" title="Sheets not yet encoded">${BOOKLET_SIZE - st.used} to encode</span>`;
    return `
        <tr class="booklet-head" data-booklet="${start}" title="Click to ${collapsed ? "expand" : "collapse"}">
            <td colspan="10">
                <div class="bk">
                    <i class="${collapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} bk-chevron"></i>
                    <strong>Booklet ${esc(bookletLabel(start))}</strong>
                    <span class="bk-count">${st.used} / ${BOOKLET_SIZE} sheets</span>
                    <span class="bk-bar"><span style="width:${pct}%"></span></span>
                    ${status}
                    ${reviewBadge}
                    ${cashBadge}
                    <button type="button" class="btn btn-sm ${locks.includes(start) ? "btn-locked" : "btn-secondary"}" data-lock="${start}" title="${locks.includes(start) ? "Locked: nothing in this booklet can be changed. Click to unlock." : "Lock this booklet so it cannot be changed"}"><i class="${locks.includes(start) ? "ri-lock-fill" : "ri-lock-unlock-line"}"></i> ${locks.includes(start) ? "Locked" : "Lock"}</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-review="${start}" title="Check each PR in this booklet against the paper sheets"><i class="ri-checkbox-circle-line"></i> Review</button>
                    ${missing}
                    <span class="bk-pay">
                        <span class="pay cash" title="Cash payments"><i class="ri-money-dollar-circle-line"></i> Cash <b>${peso(split.cash)}</b></span>
                        <span class="pay online" title="${esc(onlineTip)}"><i class="ri-smartphone-line"></i> Online <b>${peso(split.online)}</b></span>
                    </span>
                    <span class="bk-total" title="Booklet total">${peso(sales)}</span>
                </div>
            </td>
        </tr>`;
}

function refresh() {
    updateBookletOptions();
    const f = currentFilter();
    const shown = filterEntries(entries, f);
    const rows = flatten(shown);
    const body = $("outBody");

    const byBooklet = new Map();
    rows.forEach(r => {
        const b = bookletStart(r.pr);
        if (!byBooklet.has(b)) byBooklet.set(b, []);
        byBooklet.get(b).push(r);
    });
    // Booklets start collapsed: applied once, when the first data shows up (later expand/collapse choices are kept).
    if (!bookletsDefaulted) {
        const all = allBookletStarts();
        if (all.length) { all.forEach(s => collapsedBooklets.add(s)); bookletsDefaulted = true; }
    }
    let html = "";
    let currentBooklet = null;
    const noFilter = !(f.q.trim() || f.from || f.to || f.unchecked);
    const items = noFilter ? withMarks(rows, marks, f) : rows;
    items.forEach(r => {
        const b = bookletStart(r.pr);
        if (b !== currentBooklet) { currentBooklet = b; html += bookletHeaderHtml(b, byBooklet.get(b) || []); }
        if (!collapsedBooklets.has(b)) html += r.mark ? markRowHtml(r) : rowHtml(r);
    });
    body.innerHTML = html;
    const starts = allBookletStarts();
    const allCollapsed = starts.length > 0 && starts.every(s => collapsedBooklets.has(s));
    $("collapseText").textContent = allCollapsed ? "Expand all" : "Collapse all";
    $("collapseBtn").querySelector("i").className = allCollapsed ? "ri-expand-up-down-line" : "ri-contract-up-down-line";
    renderBookletSummary(flatten(filterEntries(entries, { ...f, booklet: "" }))); // all booklets, even while one is selected below
    afterRowsRendered(rows, shown, f);
}

function mopCellHtml(r) {
    const p = r.entry.payments;
    if (Array.isArray(p) && p.length) return `<span class="split-tag">SPLIT</span><br>` + p.map(x => esc(paymentText(x))).join("<br>");
    return esc(r.mop);
}

function markRowHtml(r) {
    const note = r.status === "void" ? "Cancelled sheet, no sale" : "Blank or skipped sheet";
    return `
        <tr class="mark-row ${esc(r.status)} pr-first">
            <td></td>
            <td class="pr-no">${esc(r.pr)}</td>
            <td colspan="7"><span class="mark-tag ${esc(r.status)}">${markLabel(r.status)}</span> <span class="mark-note">${note}</span></td>
            <td class="no-print">${isLocked(r.pr) ? `<i class="ri-lock-fill row-lock" title="Locked"></i>` : `<div class="row-actions">
                <button class="btn btn-secondary btn-icon-only" data-unmark="${esc(r.pr)}" title="Clear this mark"><i class="ri-close-line"></i></button>
            </div>`}</td>
        </tr>`;
}

// Item name in the color of its book cover (see itemColor in logic.js).
function itemNameHtml(desc) {
    const c = itemColor(desc);
    return c ? `<span class="item-c" style="--item-color:${c}">${esc(desc)}</span>` : esc(desc);
}

function rowHtml(r) {
    return `
        <tr class="${r.first ? "pr-first" : ""}">
            <td>${r.first ? esc(r.date) : ""}</td>
            <td class="pr-no">${r.first ? esc(r.pr) + (r.entry.checkedAt ? `<i class="ri-checkbox-circle-fill chk" title="Checked ${esc(new Date(r.entry.checkedAt).toLocaleString())}"></i>` : "") : ""}</td>
            <td>${r.first ? esc(r.buyer) : ""}</td>
            <td>${itemNameHtml(r.desc)}</td>
            <td class="num">${r.qty}</td>
            <td class="num">${money(r.price)}</td>
            <td class="num">${money(r.total)}</td>
            <td class="num">${money(r.grand)}</td>
            <td>${r.first ? mopCellHtml(r) : ""}</td>
            <td class="no-print">${r.first && isLocked(r.pr) ? `<i class="ri-lock-fill row-lock" title="Locked"></i>` : r.first ? `<div class="row-actions">
                <button class="btn btn-secondary btn-icon-only" data-edit="${esc(r.entry.id)}" title="Edit"><i class="ri-edit-line"></i></button>
                <button class="btn btn-danger btn-icon-only" data-del="${esc(r.entry.id)}" title="Delete"><i class="ri-delete-bin-line"></i></button>
            </div>` : ""}</td>
        </tr>`;
}

function updateBookletOptions() {
    const sel = $("bookletFilter");
    const prev = sel.value;
    const starts = bookletStarts(entries);
    sel.innerHTML = `<option value="">All booklets</option>` +
        starts.map(s => `<option value="${s}">Booklet ${esc(bookletLabel(s))}</option>`).join("");
    sel.value = starts.includes(Number(prev)) ? prev : "";
}

function updateBookletHint() {
    const pr = Number($("fPr").value);
    const el = $("bookletHint");
    if (!(pr > 0)) { el.textContent = ""; return; }
    const st = bookletStats(entries.filter(e => e.id !== editingId), bookletStart(pr));
    el.textContent = `Booklet ${bookletLabel(st.start)} - ${st.used}/${BOOKLET_SIZE} used`;
}

function afterRowsRendered(rows, shown, f) {
    $("emptyMsg").classList.toggle("hidden", rows.length > 0);
    $("emptyMsg").textContent = entries.length ? "No receipts match the filter." : "No receipts encoded yet.";
    const total = rows.length ? rows[rows.length - 1].grand : 0;
    $("valAmount").textContent = peso(total);
    $("valSub").textContent = `${shown.length} receipt${shown.length === 1 ? "" : "s"}` + (f.q || f.from || f.to || f.booklet ? " (filtered)" : "");
    const range = f.from || f.to ? `${f.from ? fmtDate(f.from) : "start"} to ${f.to ? fmtDate(f.to) : "latest"}` : "All dates";
    const bk = f.booklet ? `Booklet ${bookletLabel(Number(f.booklet))} - ` : "";
    $("printTitle").textContent = `PR Summary - ${bk}${range} - Total ${peso(total)}`;
    updatePrWarning();
    updateBookletHint();
}

$("outBody").addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (!b) {
        const head = ev.target.closest("tr.booklet-head");
        if (head) {
            const s = Number(head.dataset.booklet);
            if (collapsedBooklets.has(s)) collapsedBooklets.delete(s); else collapsedBooklets.add(s);
            refresh();
        }
        return;
    }
    if (b.dataset.lock) toggleLock(Number(b.dataset.lock));
    if (b.dataset.unmark) clearMark(Number(b.dataset.unmark));
    if (b.dataset.review) openReview(Number(b.dataset.review));
    if (b.dataset.edit) startEdit(b.dataset.edit);
    if (b.dataset.del) {
        const e = entries.find(x => x.id === b.dataset.del);
        if (e && confirm(`Delete PR #${e.pr}?`)) {
            removeEntry(e.id);
            if (editingId === e.id) resetForm();
        }
    }
});

["searchInput", "fromDate", "toDate", "bookletFilter"].forEach(id => $(id).addEventListener("input", refresh));
$("uncheckedOnly").addEventListener("change", refresh);
$("clearFilterBtn").addEventListener("click", () => {
    $("searchInput").value = ""; $("fromDate").value = ""; $("toDate").value = ""; $("bookletFilter").value = ""; $("uncheckedOnly").checked = false; refresh();
});

$("copyBtn").addEventListener("click", async () => {
    const rows = visibleRows();
    if (!rows.length) return toast("Nothing to copy.");
    const text = toTSV(rows);
    try { await navigator.clipboard.writeText(text); }
    catch {
        const ta = document.createElement("textarea");
        ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); ta.remove();
    }
    toast("Copied. Paste into Excel or Google Sheets.");
});

$("csvBtn").addEventListener("click", () => {
    const rows = visibleRows();
    if (!rows.length) return toast("Nothing to download.");
    const blob = new Blob(["\uFEFF" + toCSV(rows)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pr-encoder-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
});

$("printBtn").addEventListener("click", () => {
    if (!visibleRows().length) return toast("Nothing to print.");
    window.print();
});

// ---------- Import from spreadsheet ----------
function importPreview() {
    const { entries: es, skipped } = parseSheet($("importText").value);
    const exist = es.filter(e => entries.some(x => x.id === e.id)).length;
    $("importInfo").textContent = es.length
        ? `${es.length} PRs found${exist ? `, ${exist} will replace existing` : ""}${skipped.length ? `, ${skipped.length} rows skipped` : ""}`
        : ($("importText").value.trim() ? "Nothing readable found" : "");
    $("importGo").disabled = !es.length;
    return es;
}
$("importBtn").addEventListener("click", () => { $("importText").value = ""; importPreview(); $("importModal").classList.remove("hidden"); $("importText").focus(); });
$("importClose").addEventListener("click", () => $("importModal").classList.add("hidden"));
$("importText").addEventListener("input", importPreview);
$("importSample").addEventListener("click", () => { $("importText").value = SHEET_0920; importPreview(); });
$("importGo").addEventListener("click", () => {
    let es = importPreview();
    if (!es.length) return;
    const locked = es.filter(e => isLocked(e.pr)).length;
    es = es.filter(e => !isLocked(e.pr)); // locked booklets are never touched by an import
    if (!es.length) return toast("Every PR in that paste belongs to a locked booklet.");
    const ids = new Set(es.map(e => e.id));
    entries = entries.filter(e => !ids.has(e.id)).concat(es);
    saveLocal();
    refresh();
    for (const { id, ...data } of es) setDoc(doc(col, id), data).catch(remoteFail);
    $("importModal").classList.add("hidden");
    toast(`Imported ${es.length} PRs` + (locked ? `, skipped ${locked} in locked booklets` : ""));
});

$("clearBtn").addEventListener("click", async () => {
    if (!entries.length) return toast("Nothing to clear.");
    if (locks.length) return toast("Some booklets are locked. Unlock them first to clear everything.");
    if (!confirm(`Delete ALL ${entries.length} receipts? This cannot be undone.`)) return;
    if (!confirm("Really delete everything? Consider downloading a CSV first.")) return;
    const ids = entries.map(e => e.id);
    entries = [];
    marks = [];
    localStorage.setItem(LS_MARKS, "[]");
    saveLocal();
    localStorage.removeItem(LS_LAST_PR);
    resetForm();
    refresh();
    try {
        const snap = await getDocs(col);
        const batch = writeBatch(db);
        snap.docs.forEach(d => batch.delete(d.ref)); // only this app's collection
        await batch.commit();
    } catch (e) { remoteFail(e); }
    try { // void / not-used marks belong to the same receipts, so they go too (own collection only)
        const mSnap = await getDocs(marksCol);
        const mBatch = writeBatch(db);
        mSnap.docs.forEach(d => mBatch.delete(d.ref));
        await mBatch.commit();
    } catch (e) { console.error(e); }
    toast(`Cleared ${ids.length} receipts.`);
});

// ---------- Catalog modal ----------
function renderCatalogRows() {
    $("catalogBody").innerHTML = catalog.map((c, i) => `
        <div class="cat-row">
            <input type="text" value="${esc(c.desc)}" data-i="${i}" data-k="desc">
            <input type="text" value="${esc(c.code || "")}" data-i="${i}" data-k="code" placeholder="shorthand" title="Optional custom shorthand, e.g. gte">
            <input type="number" min="0" step="0.01" value="${c.price}" data-i="${i}" data-k="price">
            <button class="btn btn-danger btn-icon-only" data-rm="${i}"><i class="ri-close-line"></i></button>
        </div>`).join("");
}
$("catalogBtn").addEventListener("click", () => { renderCatalogRows(); $("catalogModal").classList.remove("hidden"); });
$("catalogClose").addEventListener("click", () => { catalog = loadCatalog(); $("catalogModal").classList.add("hidden"); });
$("catalogBody").addEventListener("input", ev => {
    const t = ev.target; if (t.dataset.i === undefined) return;
    catalog[t.dataset.i][t.dataset.k] = t.dataset.k === "price" ? Number(t.value) : t.value;
});
$("catalogBody").addEventListener("click", ev => {
    const b = ev.target.closest("[data-rm]"); if (!b) return;
    catalog.splice(Number(b.dataset.rm), 1); renderCatalogRows();
});
$("catalogAdd").addEventListener("click", () => {
    catalog.push({ desc: "", price: 0 }); renderCatalogRows();
    const rows = $("catalogBody").querySelectorAll(".cat-row"); rows[rows.length - 1].querySelector("input").focus();
});
$("catalogReset").addEventListener("click", () => {
    if (!confirm("Reset the catalog to the default price list?")) return;
    localStorage.removeItem(LS_CATALOG);
    catalog = loadCatalog(); renderCatalogRows();
});
$("catalogSave").addEventListener("click", () => {
    catalog = catalog.filter(c => c.desc.trim()).map(c => {
        const item = { desc: c.desc.trim(), price: Number(c.price) || 0 };
        if (c.code && c.code.trim()) item.code = c.code.trim();
        return item;
    });
    localStorage.setItem(LS_CATALOG, JSON.stringify(catalog));
    catalogOptions();
    $("catalogModal").classList.add("hidden");
    toast("Catalog saved.");
});

// ---------- Theme & PWA ----------
function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    $("themeIcon").className = t === "dark" ? "ri-sun-line" : "ri-moon-line";
}
applyTheme(localStorage.getItem(LS_THEME) || "light");
$("themeBtn").addEventListener("click", () => {
    const t = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    localStorage.setItem(LS_THEME, t); applyTheme(t);
});

let deferredInstall;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; $("installBtn").classList.remove("hidden"); });
$("installBtn").addEventListener("click", async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("installBtn").classList.add("hidden");
});
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("./sw.js").catch(() => { });
}

// ---------- PR review ----------
// Step through one booklet, PR number by PR number, and tick each one after checking it against the paper sheet.
const fmtStamp = ts => new Date(ts).toLocaleString();

function rvSeq() { return reviewSequence(entries, marks, rv.start); }
function rvCurrent(seq = rvSeq()) { return seq.find(s => s.pr === rv.pr) || seq[0]; }

function openReview(start, fromFirst = false) {
    rv = { start, pr: null, summary: false };
    rvStreak = 0;
    const seq = rvSeq();
    if (!seq.length) { rv = null; toast("Nothing to review in this booklet yet."); return; }
    const first = fromFirst ? seq[0] : seq.find(s => !s.resolved);
    if (first) rv.pr = first.pr; else { rv.pr = seq[seq.length - 1].pr; rv.summary = true; }
    $("reviewOverlay").classList.remove("hidden");
    document.body.classList.add("modal-open");
    renderReview();
}

function closeReview() {
    if (reviewEditing) return;
    rv = null;
    $("reviewOverlay").classList.add("hidden");
    document.body.classList.remove("modal-open", "print-review");
    refresh();
}

function rvGo(delta) {
    const seq = rvSeq();
    if (rv.summary) { if (delta < 0) rv.summary = false; renderReview(); return; }
    const idx = seq.findIndex(s => s.pr === rv.pr);
    const n = idx + delta;
    if (n < 0) return;
    if (n >= seq.length) rv.summary = true; else rv.pr = seq[n].pr;
    renderReview();
}

// ---- Cute check sounds (Web Audio, no files): a rising pentatonic "pling" as you check PRs in a row ----
const LS_SOUND = "pre_sound";
let soundOn = localStorage.getItem(LS_SOUND) !== "off";
let audioCtx = null;
let rvStreak = 0;
function tone(freq, start, dur, vol = 0.18, type = "sine") {
    const t0 = audioCtx.currentTime + start;
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(audioCtx.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
}
function playCheckSound(done) {
    if (!soundOn) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        const scale = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.51]; // C major pentatonic, rising
        const f = scale[Math.min(rvStreak, scale.length - 1)];
        tone(f, 0, 0.22); tone(f * 2, 0.06, 0.2, 0.08, "triangle"); // soft pling with a sparkle on top
        if (done) [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((n, i) => tone(n, 0.28 + i * 0.09, 0.3, 0.16)); // booklet done!
    } catch { /* sound is optional */ }
}
function updateSoundBtn() {
    $("rvSound").innerHTML = soundOn ? '<i class="ri-volume-up-line"></i>' : '<i class="ri-volume-mute-line"></i>';
    $("rvSound").title = soundOn ? "Check sound on (click to mute)" : "Check sound off (click to turn on)";
}
$("rvSound").addEventListener("click", () => {
    soundOn = !soundOn; localStorage.setItem(LS_SOUND, soundOn ? "on" : "off"); updateSoundBtn();
    if (soundOn) playCheckSound(false);
});
updateSoundBtn();

function rvConfirm() {
    if (rv.summary) return;
    const s = rvCurrent();
    if (s.type === "entry") {
        if (!s.checked && isLocked(s.pr)) { lockedToast(); return; }
        if (!s.checked) {
            setChecked(s.entry.id, true);
            playCheckSound(reviewProgress(rvSeq()).done);
            rvStreak++;
        }
        rvGo(1);
    }
    else if (s.type === "mark") rvGo(1);
    else toast(`PR #${s.pr} has no entry. Mark it first: V void, N not used, L encode later.`);
}

function rvUncheck() {
    rvStreak = 0;
    if (rv.summary) return;
    if (isLocked(rv.pr)) return lockedToast();
    const s = rvCurrent();
    if (s.type === "entry" && s.checked) { setChecked(s.entry.id, false); renderReview(); }
    else if (s.type === "mark") { clearMark(s.pr); renderReview(); }
}

function rvMark(status) {
    if (rv.summary) return;
    if (isLocked(rv.pr)) return lockedToast();
    const s = rvCurrent();
    if (s.type === "entry") { toast("This PR has an entry. Press Enter to check it, or E to edit."); return; }
    setMark(s.pr, status);
    rvGo(1);
}

function rvEncodeLater() {
    if (rv.summary) return;
    const s = rvCurrent();
    if (s.type === "entry") return;
    const pr = s.pr;
    closeReview();
    resetForm();
    $("fPr").value = pr;
    updatePrWarning();
    updateBookletHint();
    $("encoderCard").scrollIntoView({ behavior: "smooth", block: "start" });
    $("itemsList").querySelector(".item-name").focus();
    toast(`Encoding PR #${pr}.`);
}

// Edit: the encoder card moves into a dialog on top of the review, and goes back afterwards.
let encoderPlaceholder = null;
function rvEdit() {
    if (rv.summary) return;
    if (isLocked(rv.pr)) return lockedToast();
    const s = rvCurrent();
    if (s.type !== "entry") return;
    const card = $("encoderCard");
    encoderPlaceholder = document.createComment("encoderCard");
    card.before(encoderPlaceholder);
    $("rvEditBody").appendChild(card);
    $("rvEdit").classList.remove("hidden");
    reviewEditing = true;
    startEdit(s.entry.id);
    $("fDate").focus();
}

function finishReviewEdit(savedPr) {
    if (!reviewEditing) return;
    reviewEditing = false;
    encoderPlaceholder.replaceWith($("encoderCard"));
    encoderPlaceholder = null;
    $("rvEdit").classList.add("hidden");
    if (rv) {
        if (savedPr) { rv.pr = savedPr; toast(`PR #${savedPr} updated. Check it again with Enter.`); }
        rv.summary = false;
        renderReview();
    }
}

// A replica of the paper Provisional Receipt, filled in with what was encoded.
function receiptPaperHtml(e) {
    const total = entryTotal(e);
    const pays = Array.isArray(e.payments) && e.payments.length
        ? e.payments : [{ method: e.mop && e.mop !== "Split" ? e.mop : "Cash", amount: total, ref: e.mopRef || "" }];
    const multi = pays.length > 1;
    const hasCash = pays.some(p => !p.method || p.method === "Cash");
    const check = pays.find(p => p.method === "Check");
    const bank = pays.find(p => p.method === "Bank Transfer");
    const online = pays.filter(p => p.method && !["Cash", "Check", "Bank Transfer"].includes(p.method));
    const invoiceRef = online.map(p => `${p.method}${p.ref ? " " + p.ref : ""}${multi ? " (" + money(p.amount) + ")" : ""}`).join(", ");
    const bankText = bank ? `Bank Transfer${bank.ref ? " " + bank.ref : ""}${multi ? " (" + money(bank.amount) + ")" : ""}` : "";

    const rows = e.items.map(i => ({ text: `${i.desc} - ${i.qty}`, amt: money(round2(i.qty * i.price)) }));
    while (rows.length < 6) rows.push({ text: "", amt: "" });
    // Registered name on the paper: any non-cash payment (invoice, GCash, bank...) reads "Online Payment".
    const allCash = pays.every(p => !p.method || p.method === "Cash");
    const named = (e.buyer || "").trim() && !/^an+onymous$/i.test(e.buyer.trim());
    const regName = allCash ? `Cash - ${e.buyer || "Anonymous"}` : named ? `Online Payment - ${e.buyer.trim()}` : "Online Payment";
    const lines = rows.map(r => `<div class="pp-row"><span class="ink">${esc(r.text)}</span><span class="ink amt">${esc(r.amt)}</span></div>`).join("");

    return `
    <div class="paper" aria-label="Replica of the provisional receipt">
        <div class="pp-head">
            <div class="pp-logo">ccf</div>
            <div class="pp-org">
                <div class="pp-name">CHRIST'S COMMISSION FOUNDATION, INC.</div>
                <div class="pp-addr">CCF Center, Ortigas East, Ortigas Avenue Corner C5 Road,<br>Brgy. Ugong Pasig City, Metro Manila, 1604<br>NON VAT Reg. TIN: 000-092-507-00000</div>
            </div>
            <div class="pp-title">
                <div class="pp-pr">PROVISIONAL RECEIPT</div>
                <div class="pp-no">N<sup>o</sup> <span>${esc(e.pr)}</span></div>
            </div>
        </div>
        <div class="pp-date">Date: <span class="ink fill">${esc(fmtDate(e.date))}</span></div>
        <div class="pp-bar">Received From:</div>
        <div class="pp-field">Registered Name: <span class="ink fill">${esc(regName)}</span></div>
        <div class="pp-field">Business Address: <span class="ink fill"></span></div>
        <div class="pp-field pp-tin">TIN <span class="ink fill"></span></div>
        <div class="pp-bar center">Description of Transaction/Nature of Service</div>
        <div class="pp-desc">${lines}</div>
        <div class="pp-total"><span>TOTAL PAID AMOUNT</span><span class="ink amt">${money(total)}</span></div>
        <div class="pp-field">Received the Amount of <span class="ink fill">${esc(pesoWords(total))}</span></div>
        <div class="pp-bottom">
            <div class="pp-pay">
                <div class="pp-pay-head">FORM OF PAYMENT <span class="pp-box">${hasCash ? "&#10003;" : ""}</span> Cash <span class="pp-box">${check ? "&#10003;" : ""}</span> Check</div>
                <div class="pp-pay-row">Check No.: <span class="ink">${esc(check && check.ref ? check.ref : "")}</span></div>
                <div class="pp-pay-row">Check Date: <span class="ink"></span></div>
                <div class="pp-pay-row">Bank/Branch <span class="ink">${esc(bankText)}</span></div>
                <div class="pp-pay-row">Total Amount <span class="ink amt">${money(total)}</span></div>
            </div>
            <div class="pp-mid">
                <div class="pp-invoice">Invoice Reference No. <span class="ink fill">${esc(invoiceRef)}</span></div>
            </div>
            <div class="pp-by">
                <div class="pp-sign">By:</div>
                <div class="pp-cashier">Cashier / Authorized Representative</div>
            </div>
        </div>
        <div class="pp-foot">THIS DOCUMENT IS NOT VALID FOR CLAIMING INPUT TAXES</div>
    </div>`;
}

function renderReview() {
    const seq = rvSeq();
    if (!seq.length) { closeReview(); return; }
    const cur = rvCurrent(seq);
    rv.pr = cur.pr;
    $("rvCard").style.flex = ""; $("rvCard").style.width = ""; $("rvCard").style.alignSelf = "";
    $("rvHead").innerHTML = "";
    const prog = reviewProgress(seq);
    const idx = seq.indexOf(cur);

    const lockedNow = locks.includes(rv.start);
    $("rvTitle").innerHTML = `Review booklet ${esc(bookletLabel(rv.start))}${lockedNow ? ' <i class="ri-lock-fill rv-lockmark" title="Locked"></i>' : ""}`;
    $("rvLock").innerHTML = lockedNow ? '<i class="ri-lock-fill"></i> Locked' : '<i class="ri-lock-unlock-line"></i> Lock';
    $("rvLock").classList.toggle("btn-locked", lockedNow);
    $("rvLock").title = lockedNow ? "Locked: nothing can be changed. Click to unlock." : "Lock this booklet so it cannot be changed";
    $("rvRestart").disabled = lockedNow;
    $("rvSub").textContent = `${prog.checked} of ${prog.entries} PRs checked` +
        (prog.marks ? ` | ${prog.marks} void or not used` : "") + (prog.missing ? ` | ${prog.missing} missing` : "") +
        (rv.summary ? "" : ` | now at ${idx + 1} of ${seq.length}`);
    $("rvBar").style.width = `${seq.length ? Math.round((seq.filter(s => s.resolved).length / seq.length) * 100) : 0}%`;

    $("rvStrip").innerHTML = seq.map(s => {
        const cls = s.type === "entry" ? (s.checked ? "checked" : "") : s.type === "mark" ? "mark" : "missing";
        const current = !rv.summary && s.pr === cur.pr ? " current" : "";
        return `<button type="button" class="rv-chip ${cls}${current}" data-pr="${s.pr}" title="${s.type === "mark" ? s.status : s.type === "missing" ? "No entry" : s.checked ? "Checked" : "Not checked yet"}">${s.pr}</button>`;
    }).join("");
    const chip = $("rvStrip").querySelector(".current");
    if (chip && chip.scrollIntoView) chip.scrollIntoView({ block: "nearest" });

    if (rv.summary) { renderReviewSummary(seq, prog); return; }

    const back = `<button type="button" class="btn btn-secondary btn-lg" data-rv="back" ${idx === 0 ? "disabled" : ""}><i class="ri-arrow-left-line"></i> Back</button>`;
    // "Summary" jumps straight to the booklet summary (totals, cash count, PDF), without going through the last PR.
    const summaryBtn = `<button type="button" class="btn btn-secondary btn-lg" data-rv="summary" title="Go to the booklet summary"><i class="ri-file-list-3-line"></i> Summary</button>`;
    const skip = summaryBtn + `<button type="button" class="btn btn-secondary btn-lg" data-rv="skip">Skip <i class="ri-arrow-right-line"></i></button>`;

    if (cur.type === "entry") {
        const e = cur.entry;
        const pay = Array.isArray(e.payments) && e.payments.length
            ? e.payments.map(p => esc(paymentText(p))).join("<br>") : esc(mopText(e) || "Cash");
        $("rvHead").innerHTML = `
                <div class="rv-sheet-label">Compare with paper PR #${esc(e.pr)}</div>
                <div class="rv-sys"><b>Encoded MOP:</b> ${pay.replace(/<br>/g, " + ")}</div>
                <span class="rv-status ${cur.checked ? "ok" : "todo"}">${cur.checked ? "Checked " + esc(fmtStamp(e.checkedAt)) : "Not checked yet"}</span>
`;
        $("rvCard").innerHTML = `<div class="rv-stage">${receiptPaperHtml(e)}</div>`;
        $("rvActions").innerHTML = `${back}<div class="grp">
            <button type="button" class="btn btn-secondary btn-lg" data-rv="edit"><i class="ri-edit-line"></i> Edit</button>
            ${cur.checked ? `<button type="button" class="btn btn-secondary btn-lg" data-rv="uncheck">Uncheck</button>` : ""}
            ${skip}
            <button type="button" class="btn btn-success btn-lg" data-rv="confirm"><i class="ri-check-line"></i> ${cur.checked ? "Next" : "Checked, next"}</button></div>`;
        fitPaper();
    } else if (cur.type === "mark") {
        $("rvCard").innerHTML = `
            <div class="rv-empty">
                <div class="rv-prno">PR #${cur.pr}</div>
                <h3>Marked as ${cur.status === "void" ? "VOID" : "NOT USED"}</h3>
                <p>${cur.status === "void" ? "A cancelled sheet." : "A blank or unissued sheet."} Saved ${esc(fmtStamp(cur.mark.at || Date.now()))}.</p>
            </div>`;
        $("rvActions").innerHTML = `${back}<div class="grp">
            <button type="button" class="btn btn-secondary btn-lg" data-rv="uncheck">Clear mark</button>
            ${summaryBtn}
            <button type="button" class="btn btn-success btn-lg" data-rv="confirm">Next</button></div>`;
    } else {
        $("rvCard").innerHTML = `
            <div class="rv-empty">
                <div class="rv-prno">PR #${cur.pr}</div>
                <h3>No entry for this number</h3>
                <p>Look at the paper sheet. Was it cancelled, never used, or just not encoded yet?</p>
                <div class="rv-choices">
                    <button type="button" class="btn btn-secondary btn-lg" data-rv="void"><kbd>V</kbd> Void</button>
                    <button type="button" class="btn btn-secondary btn-lg" data-rv="unused"><kbd>N</kbd> Not used</button>
                    <button type="button" class="btn btn-primary btn-lg" data-rv="later"><kbd>L</kbd> Encode it now</button>
                </div>
            </div>`;
        $("rvActions").innerHTML = `${back}<div class="grp">${skip}</div>`;
    }
}

function fitPaper() {
    const card = $("rvCard");
    // Reset so the card fills the free space, then shrink the card to the receipt's own proportions.
    card.style.flex = ""; card.style.width = ""; card.style.alignSelf = "";
    const stage = card.querySelector(".rv-stage");
    const paper = stage && stage.querySelector(".paper");
    if (!stage || !paper) return;
    stage.style.height = ""; stage.style.flex = "";
    paper.style.zoom = 1;
    const nw = paper.offsetWidth, nh = paper.offsetHeight;
    const padX = card.offsetWidth - stage.clientWidth;
    const z = Math.max(0.3, Math.min(stage.clientWidth / nw, stage.clientHeight / nh, 1.6));
    paper.style.zoom = z.toFixed(4);
    stage.style.flex = "none";
    stage.style.height = Math.ceil(nh * z) + 2 + "px";
    card.style.flex = "none";
    card.style.alignSelf = "center";
    card.style.width = Math.ceil(nw * z + padX) + 2 + "px";
}
window.addEventListener("resize", fitPaper);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPaper);

// ---- Cash count: count the actual money against the expected cash of the booklet ----
const DENOMS = [
    { key: "1000", value: 1000, label: "1,000 bill" }, { key: "500", value: 500, label: "500 bill" },
    { key: "200", value: 200, label: "200 bill" }, { key: "100", value: 100, label: "100 bill" },
    { key: "50", value: 50, label: "50 bill" }, { key: "20b", value: 20, label: "20 bill" },
    { key: "20c", value: 20, label: "20 coin" }, { key: "10", value: 10, label: "10 coin" },
    { key: "5", value: 5, label: "5 coin" }, { key: "1", value: 1, label: "1 coin" },
    { key: "0.25", value: 0.25, label: "0.25 coin" },
];
// Cash counts are saved in Firestore (pr_encoder_cashcounts, one document per booklet, same pattern as locks)
// and cached in localStorage, so every device sees the same count.
const cashKey = start => `pre_cashcount_${start}`;
const cashCountsCol = collection(db, "pr_encoder_cashcounts");
const cashDocId = start => `bk_${start}`;
let cashCounts = {};  // booklet start -> { denomKey: count }
let cashFromCloud = false;
function localCashCount(start) { try { return JSON.parse(localStorage.getItem(cashKey(start))) || {}; } catch { return {}; } }
function loadCashCount(start) { return cashCounts[start] || localCashCount(start); }
const cashTimers = {};
function saveCashCount(start, counts) {
    cashCounts[start] = counts;
    localStorage.setItem(cashKey(start), JSON.stringify(counts));
    clearTimeout(cashTimers[start]);
    cashTimers[start] = setTimeout(() => {
        setDoc(doc(cashCountsCol, cashDocId(start)), { start, counts, at: Date.now() }).catch(err => {
            console.error(err); toast("Could not save the cash count to the cloud. Saved on this device only.");
        });
    }, 400);
}
onSnapshot(cashCountsCol, snap => {
    const cloud = {};
    snap.docs.forEach(d => { const x = d.data(); if (Number.isFinite(Number(x.start))) cloud[Number(x.start)] = x.counts || {}; });
    // First load: counts that exist only on this device are uploaded once, so nothing entered earlier is lost.
    if (!cashFromCloud) {
        cashFromCloud = true;
        for (let i = 0; i < localStorage.length; i++) {
            const m = /^pre_cashcount_(\d+)$/.exec(localStorage.key(i) || "");
            if (!m) continue;
            const start = Number(m[1]), local = localCashCount(start);
            if (!(start in cloud) && Object.keys(local).length) {
                cloud[start] = local;
                setDoc(doc(cashCountsCol, cashDocId(start)), { start, counts: local, at: Date.now() }).catch(err => console.error(err));
            }
        }
    }
    cashCounts = cloud;
    Object.entries(cloud).forEach(([start, counts]) => localStorage.setItem(cashKey(start), JSON.stringify(counts)));
    refresh();
    // Re-draw the open summary screen, but never while someone is typing in the count boxes.
    if (rv && !reviewEditing && !(document.activeElement && document.activeElement.classList.contains("cc-in"))) renderReview();
}, err => console.error("Cash count listener error", err));

function cashCountHtml(start, expected) {
    const saved = loadCashCount(start);
    const rows = DENOMS.map(d => `
        <tr><td>${money(d.value)} <span class="cc-kind">${d.label.split(" ")[1]}</span></td>
            <td class="num"><input type="number" class="cc-in" ${locks.includes(start) ? "disabled" : ""} data-denom="${d.key}" min="0" step="1" inputmode="numeric" value="${saved[d.key] || ""}" placeholder="0" aria-label="${esc(d.label)} count"></td>
            <td class="num cc-amt">${money((Number(saved[d.key]) || 0) * d.value)}</td></tr>`).join("");
    const counted = DENOMS.reduce((s, d) => round2(s + (Number(saved[d.key]) || 0) * d.value), 0);
    const any = Object.keys(saved).length > 0;
    const diff = round2(counted - expected);
    return `
        <table class="rs-table cc-table" data-expected="${expected}">
            <thead>
                <tr><th colspan="3" class="rs-title">CASH COUNT (actual money)</th></tr>
                <tr><th>Denomination</th><th class="num">Count</th><th class="num">Amount</th></tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
                <tr><td colspan="2">TOTAL COUNTED</td><td class="num" id="ccTotal">${money(counted)}</td></tr>
                <tr class="cc-expect"><td colspan="2">Expected cash (from PRs)</td><td class="num">${money(expected)}</td></tr>
                <tr class="cc-diff"><td colspan="3" id="ccDiff" class="${!any ? "" : diff === 0 ? "ok" : diff > 0 ? "over" : "short"}">${ccMessage(any, diff)}</td></tr>
            </tfoot>
        </table>`;
}
function ccMessage(any, diff) {
    return !any ? "Enter how many of each bill and coin you counted."
        : diff === 0 ? "Balanced. The money matches the PRs."
        : diff > 0 ? `Over by ${peso(diff)}` : `Short by ${peso(-diff)}`;
}

function updateCashCount() {
    const table = $("rvCard").querySelector(".cc-table");
    if (!table) return false;
    const expected = Number(table.dataset.expected) || 0;
    const counts = {};
    let total = 0;
    table.querySelectorAll(".cc-in").forEach(inp => {
        const d = DENOMS.find(x => x.key === inp.dataset.denom);
        const n = Math.max(0, Math.floor(Number(inp.value) || 0));
        if (n) counts[d.key] = n;
        total = round2(total + n * d.value);
        inp.closest("tr").querySelector(".cc-amt").textContent = money(n * d.value);
    });
    saveCashCount(rv.start, counts);
    $("ccTotal").textContent = money(total);
    const diff = round2(total - expected);
    const any = Object.keys(counts).length > 0;
    const el = $("ccDiff");
    el.className = !any ? "" : diff === 0 ? "ok" : diff > 0 ? "over" : "short";
    el.textContent = ccMessage(any, diff);
    return any && diff === 0;
}
let ccWasBalanced = false;
$("rvCard").addEventListener("input", ev => {
    if (!ev.target.classList.contains("cc-in")) return;
    const balanced = updateCashCount();
    if (balanced && !ccWasBalanced) playCheckSound(true); // cute fanfare when the money matches
    ccWasBalanced = balanced;
});
$("rvCard").addEventListener("keydown", ev => {
    if (!ev.target.classList.contains("cc-in") || ev.key !== "Enter") return;
    ev.preventDefault();
    const ins = [...$("rvCard").querySelectorAll(".cc-in")];
    const next = ins[ins.indexOf(ev.target) + 1];
    if (next) next.focus(); else ev.target.blur();
});

// Booklet summary laid out like the paper tally sheet: CASH and ONLINE PAYMENT, items with QTY, price, total.
function summaryHtml(bookEntries) {
    // The PR range is the whole booklet (e.g. 39851-39900), as on the tally sheet.
    const s = { ...bookletSummary(bookEntries), ...markSummary(marks, rv.start), firstPr: rv.start, lastPr: rv.start + BOOKLET_SIZE - 1 };
    const qty = n => Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
    const section = (title, sec, cls) => `
        <table class="rs-table ${cls}">
            <thead>
                <tr><th colspan="4" class="rs-title">${title}</th></tr>
                <tr><th>Item</th><th class="num">QTY</th><th class="num">Selling Price</th><th class="num">Total</th></tr>
            </thead>
            <tbody>${sec.rows.length ? sec.rows.map(r => `<tr><td>${itemNameHtml(r.desc)}</td><td class="num">${qty(r.qty)}</td><td class="num">${money(r.price)}</td><td class="num">${money(r.total)}</td></tr>`).join("")
                : `<tr><td colspan="4" class="rs-none">None</td></tr>`}</tbody>
            <tfoot><tr><td colspan="3">TOTAL</td><td class="num">${money(sec.total)}</td></tr></tfoot>
        </table>`;
    return `
        <div class="rs-head"><span class="rs-pr">PR No.: ${s.firstPr}-${s.lastPr}</span><span class="rs-date">Date: ${esc(s.dateRange)}</span></div>
        <div class="rs-marks">
            <div class="rs-mark void"><span class="mark-tag void">VOID</span> ${s.void.length ? `<b>${s.void.length}</b> <span class="rs-nums">${esc(s.voidText)}</span>` : `<span class="rs-nums none">none</span>`}</div>
            <div class="rs-mark unused"><span class="mark-tag unused">NOT USED</span> ${s.unused.length ? `<b>${s.unused.length}</b> <span class="rs-nums">${esc(s.unusedText)}</span>` : `<span class="rs-nums none">none</span>`}</div>
        </div>
        <div class="rs-grid"><div class="rs-left">${section("CASH", s.cash, "cash")}${section("ONLINE PAYMENT", s.online, "online")}</div>${cashCountHtml(rv.start, s.cash.total)}</div>`;
}

// PDF / XLSX downloads of the verified booklet (see export.js).
const PREPARED_BY = "Ynah Orgasan"; // always printed on the PDF, no prompt
async function exportBooklet(kind) {
    const bookEntries = entries.filter(e => bookletStart(e.pr) === rv.start);
    const s = { ...bookletSummary(bookEntries), ...markSummary(marks, rv.start), firstPr: rv.start, lastPr: rv.start + BOOKLET_SIZE - 1 };
    const saved = loadCashCount(rv.start);
    const counts = DENOMS.map(d => { const count = Number(saved[d.key]) || 0; return { value: d.value, kind: d.label.split(" ")[1], count, amount: round2(count * d.value) }; });
    // The view tab must be opened right on the click, before the async work, or popup blockers stop it.
    const win = kind === "viewpdf" ? window.open("", "_blank") : null;
    if (win) win.document.write("<title>PR Booklet</title><p style='font-family:sans-serif'>Preparing PDF...</p>");
    try {
        if (kind === "xlsx") await downloadSummaryXlsx(s, bookEntries, counts, PREPARED_BY);
        else if (kind === "viewpdf") await viewBookletPdf(s, bookEntries, counts, PREPARED_BY, win);
        else if (kind === "printpdf") await printBookletPdf(s, bookEntries, counts, PREPARED_BY);
        else await downloadBookletPdf(s, bookEntries, counts, PREPARED_BY);
    } catch (err) {
        console.error(err);
        if (win) win.close();
        toast("Could not create the file. Check your internet connection and try again.");
    }
}

function renderReviewSummary(seq, prog) {
    const bookEntries = entries.filter(e => bookletStart(e.pr) === rv.start);
    const rows = flatten(bookEntries);
    const sales = rows.length ? rows[rows.length - 1].grand : 0;
    const split = paymentSplit(rows);
    const open = seq.filter(s => !s.resolved);
    const allDone = open.length === 0;
    $("rvCard").innerHTML = `
        <div class="rv-pr-head">
            <div class="rv-prno">${allDone ? "Booklet verified" : "Review finished"}</div>
            <span class="rv-status ${allDone ? "ok" : "todo"}">${allDone ? "All PRs checked" : `${open.length} still to check`}</span>
        </div>
        <p style="color:var(--color-text-muted)">Booklet ${esc(bookletLabel(rv.start))}${prog.lastAt ? `, last checked ${esc(fmtStamp(prog.lastAt))}` : ""}.</p>
        <div class="rs-stats">
            <span><b>${prog.entries}</b> receipts</span>
            <span><b>${prog.checked}/${prog.entries}</b> checked</span>
            <span><b>${prog.marks}</b> void or not used</span>
            <span>Total sales <b>${peso(sales)}</b></span>
        </div>
        ${summaryHtml(bookEntries)}
        ${allDone ? "" : `<p>Still open: ${open.slice(0, 12).map(s => "#" + s.pr).join(", ")}${open.length > 12 ? ", ..." : ""}</p>`}`;
    $("rvActions").innerHTML = `<button type="button" class="btn btn-secondary btn-lg" data-rv="back"><i class="ri-arrow-left-line"></i> Back</button><div class="grp">
        <div class="export-wrap">
            <button type="button" class="btn btn-secondary btn-lg" data-rv="exportmenu" aria-haspopup="true" aria-expanded="false"><i class="ri-download-2-line"></i> Export <i class="ri-arrow-up-s-line"></i></button>
            <div class="export-menu hidden" id="exportMenu" role="menu">
                <button type="button" role="menuitem" data-rv="copysummary"><i class="ri-file-copy-line"></i> Copy summary</button>
                <button type="button" role="menuitem" data-rv="print"><i class="ri-printer-line"></i> Print</button>
                ${allDone ? `<button type="button" role="menuitem" data-rv="viewpdf"><i class="ri-eye-line"></i> View PDF</button>
                <button type="button" role="menuitem" data-rv="pdf"><i class="ri-file-pdf-line"></i> Download PDF</button>
                <button type="button" role="menuitem" data-rv="xlsx"><i class="ri-file-excel-2-line"></i> Download XLSX</button>` : ""}
            </div>
        </div>
        ${allDone ? "" : `<button type="button" class="btn btn-secondary btn-lg" data-rv="firstopen">Go to first open</button>`}
        <button type="button" class="btn btn-success btn-lg" data-rv="close">Done</button></div>`;
}

// Export menu on the summary screen. Returns true when a menu was open and got closed.
function closeExportMenu() {
    const m = $("exportMenu");
    if (!m || m.classList.contains("hidden")) return false;
    m.classList.add("hidden");
    const t = $("rvActions").querySelector('[data-rv="exportmenu"]');
    if (t) t.setAttribute("aria-expanded", "false");
    return true;
}
document.addEventListener("click", ev => { if (!ev.target.closest(".export-wrap")) closeExportMenu(); });

$("rvStrip").addEventListener("click", ev => {
    const b = ev.target.closest("[data-pr]");
    if (!b || !rv) return;
    rv.pr = Number(b.dataset.pr);
    rv.summary = false;
    renderReview();
    b.blur();
});
$("rvActions").addEventListener("click", ev => {
    const b = ev.target.closest("[data-rv]");
    if (!b || !rv) return;
    b.blur(); // so Enter always means "checked", never "press the focused button again"
    if (b.dataset.rv !== "exportmenu") closeExportMenu(); // picking an item closes the Export menu
    switch (b.dataset.rv) {
        case "exportmenu": { const m = $("exportMenu"); m.classList.toggle("hidden"); b.setAttribute("aria-expanded", String(!m.classList.contains("hidden"))); break; }
        case "back": rvGo(-1); break;
        case "skip": rvGo(1); break;
        case "summary": rv.summary = true; renderReview(); break;
        case "confirm": rvConfirm(); break;
        case "uncheck": rvUncheck(); break;
        case "edit": rvEdit(); break;
        case "void": rvMark("void"); break;
        case "unused": rvMark("unused"); break;
        case "later": rvEncodeLater(); break;
        case "copysummary": {
            const text = summaryTSV({ ...bookletSummary(entries.filter(e => bookletStart(e.pr) === rv.start)), ...markSummary(marks, rv.start), firstPr: rv.start, lastPr: rv.start + BOOKLET_SIZE - 1 });
            navigator.clipboard.writeText(text).then(() => toast("Summary copied. Paste into Excel or Google Sheets."), () => toast("Could not copy."));
            break;
        }
        case "pdf": case "viewpdf": case "xlsx": exportBooklet(b.dataset.rv); break;
        case "print": exportBooklet("printpdf"); break; // prints the same PDF as Download PDF
        case "firstopen": { const s = rvSeq().find(x => !x.resolved); if (s) { rv.pr = s.pr; rv.summary = false; renderReview(); } break; }
        case "close": closeReview(); break;
    }
});
// The choice buttons live inside the card, not in the action bar
$("rvCard").addEventListener("click", ev => {
    const b = ev.target.closest("[data-rv]");
    if (!b || !rv) return;
    b.blur();
    if (b.dataset.rv === "void") rvMark("void");
    else if (b.dataset.rv === "unused") rvMark("unused");
    else if (b.dataset.rv === "later") rvEncodeLater();
});
$("rvClose").addEventListener("click", closeReview);
// Uncheck every PR of the booklet and restart the review from the first sheet.
$("rvLock").addEventListener("click", () => { if (rv) toggleLock(rv.start); });
$("rvRestart").addEventListener("click", () => {
    if (!rv) return;
    if (locks.includes(rv.start)) return lockedToast();
    const checked = entries.filter(e => bookletStart(e.pr) === rv.start && e.checkedAt);
    if (!checked.length) return toast("Nothing is checked in this booklet.");
    if (!confirm(`Uncheck all ${checked.length} checked PRs in booklet ${bookletLabel(rv.start)} and restart the review?`)) return;
    const ids = new Set(checked.map(e => e.id));
    entries = entries.map(e => {
        if (!ids.has(e.id)) return e;
        const { checkedAt, ...rest } = e;
        return rest;
    });
    saveLocal();
    refresh();
    entries.filter(e => ids.has(e.id)).forEach(({ id, ...data }) => setDoc(doc(col, id), data).catch(remoteFail));
    rvStreak = 0;
    const seq = rvSeq();
    rv.pr = seq[0].pr; rv.summary = false;
    renderReview();
    toast(`Unchecked ${checked.length} PRs. Review restarted.`);
});
$("rvFirst").addEventListener("click", () => { if (rv) { const seq = rvSeq(); rv.pr = seq[0].pr; rv.summary = false; renderReview(); } });

document.addEventListener("keydown", ev => {
    if (!rv || reviewEditing) return;
    if (!$("catalogModal").classList.contains("hidden") || !$("importModal").classList.contains("hidden")) return;
    const tag = ev.target.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const k = ev.key;
    const used = ["Enter", "ArrowLeft", "ArrowRight", " ", "Escape", "e", "E", "u", "U", "v", "V", "n", "N", "l", "L"];
    if (!used.includes(k)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (k === "Enter") rvConfirm();
    else if (k === "ArrowLeft") rvGo(-1);
    else if (k === "ArrowRight" || k === " ") rvGo(1);
    else if (k === "Escape") { if (!closeExportMenu()) closeReview(); } // Esc closes the Export menu first
    else if (k.toLowerCase() === "e") rvEdit();
    else if (k.toLowerCase() === "u") rvUncheck();
    else if (k.toLowerCase() === "v") rvMark("void");
    else if (k.toLowerCase() === "n") rvMark("unused");
    else if (k.toLowerCase() === "l") rvEncodeLater();
}, true);

// ---------- Shortcuts legend (collapsible, remembered) ----------
const scBox = $("shortcutsBox");
if (localStorage.getItem("pre_sc_open") === "0") scBox.open = false;
const syncScLabel = () => { scBox.querySelector(".sc-toggle").textContent = scBox.open ? "hide" : "show"; };
syncScLabel();
scBox.addEventListener("toggle", () => { localStorage.setItem("pre_sc_open", scBox.open ? "1" : "0"); syncScLabel(); });

// ---------- Init ----------
setStatus("offline", "Connecting");
catalogOptions();
resetForm();
refresh();

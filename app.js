import { downloadBookletPdf, viewBookletPdf, printBookletPdf, downloadSummaryXlsx } from "./export.js";
import { renderSalesSheet } from "./sales-sheet.js";
import { renderAnalytics } from "./analytics.js";
import { dateFarFromBooklet, itemColor, markSummary, bookletSummary, summaryTSV, parseSheet, importChanges, skipMarked, withMarks, markLabel } from "./logic.js";
import { SHEET_0920 } from "./seed-sheet.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import {
    getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import {
    money, fmtDate, entryTotal, filterEntries, flatten, toTSV, toCSV, nextPr, checkPr, round2,
    BOOKLET_SIZE, bookletStart, bookletLabel, bookletStats, bookletStarts, paymentSplit, resolveShortcut, itemShortcut, priceChanges, itemCategory, DEFAULT_CHANNELS, matchChannel, paymentText, mopText, SHOW_CHANNEL_TOTALS, bookletVerification, formatDuration, cascadeDateTargets, diffEntries, versionsForPr, versionsToTrim, deletedPrs, MAX_VERSIONS, reviewSequence, reviewProgress, pesoWords, buyerSuggestions
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
let rv = null;                // review session: { start, pr, summary, viewOnly }
let reviewEditing = false;    // the encoder card is open as a dialog inside the review
let viewMode = localStorage.getItem("pre_view") === "cards" ? "cards" : "table"; // output: table rows or booklet cards
let cardMonth = null;
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
// Catalogs saved before categories existed have none: fill each one in from the item name (kept once the catalog is saved).
const withCategory = c => (c.category ? c : { ...c, category: itemCategory(c.desc) });
function loadCatalog() {
    try { const c = JSON.parse(localStorage.getItem(LS_CATALOG)); if (Array.isArray(c) && c.length) return c.map(withCategory); } catch { /* ignore */ }
    return (window.CATALOG || []).map(c => ({ desc: c.desc, price: c.price, category: c.category, code: c.code }));
}

// ---------- Status / toast ----------
const SYNC_BANNERS = {
    error: "Not saved to the cloud. Your receipts are kept on this device only. Check your internet connection and reload. Do not clear this browser's data until it syncs.",
    offline: "You are offline. Receipts you add are kept on this device and will sync when you are back online.",
};
const SYNC_LABELS = { online: "Saved \u2713", saving: "Saving\u2026", offline: "Offline", error: "Not saved" };
let lastSync = 0;
function setStatus(kind, label) {
    const connecting = label === "Connecting";
    $("syncStatus").className = `sync-indicator status-${kind}`;
    $("syncLabel").textContent = connecting ? "Connecting\u2026" : (SYNC_LABELS[kind] || label);
    if (kind === "online") lastSync = Date.now();
    const at = lastSync ? new Date(lastSync).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
    $("syncTime").textContent = kind === "online" ? at : "";
    $("syncStatus").title = connecting ? "Connecting to the cloud..."
        : kind === "online" ? `Everything is saved to the cloud. Last synced ${at}.`
        : kind === "saving" ? "Saving your changes to the cloud..."
        : kind === "offline" ? "You are offline. Changes are kept on this device and will sync when you are back online."
        : "Not saved to the cloud. Your receipts are kept on this device only. Click to reload and retry.";
    const msg = SYNC_BANNERS[kind];
    $("syncBanner").classList.toggle("hidden", !msg);
    $("syncBanner").classList.toggle("error", kind === "error");
    $("syncBannerText").textContent = msg || "";
}
window.addEventListener("offline", () => setStatus("offline", "Offline"));
window.addEventListener("online", () => setStatus(remoteOk ? "saving" : "error", remoteOk ? "Syncing..." : "Local only"));
$("syncReload").addEventListener("click", () => location.reload());
$("syncStatus").addEventListener("click", () => { if ($("syncStatus").classList.contains("status-error")) location.reload(); });
// ---------- In-app confirm dialog (replaces the browser confirm box) ----------
let dlgCancelCurrent = null;
function askConfirm({ title = "Please confirm", message = "", ok = "OK", cancel = "Cancel", danger = false } = {}) {
    if (dlgCancelCurrent) dlgCancelCurrent();
    return new Promise(resolve => {
        const o = $("dlg"), okB = $("dlgOk"), noB = $("dlgCancel");
        $("dlgTitle").textContent = title;
        $("dlgMsg").textContent = message;
        okB.textContent = ok; noB.textContent = cancel;
        okB.className = "btn " + (danger ? "btn-danger" : "btn-primary");
        $("dlgIcon").className = danger ? "ri-error-warning-fill dlg-danger" : "ri-question-line";
        const prev = document.activeElement;
        const done = v => {
            o.classList.add("hidden");
            dlgCancelCurrent = null;
            document.removeEventListener("keydown", onKey, true);
            okB.onclick = noB.onclick = o.onmousedown = null;
            if (prev && prev.focus) prev.focus({ preventScroll: true });
            resolve(v);
        };
        const onKey = ev => {
            ev.stopPropagation();
            if (ev.key === "Escape") { ev.preventDefault(); done(false); }
            else if (ev.key === "Enter") { ev.preventDefault(); done(document.activeElement !== noB); }
            else if (ev.key === "Tab") { ev.preventDefault(); (document.activeElement === okB ? noB : okB).focus(); }
        };
        okB.onclick = () => done(true);
        noB.onclick = () => done(false);
        o.onmousedown = ev => { if (ev.target === o) done(false); };
        dlgCancelCurrent = () => done(false);
        document.addEventListener("keydown", onKey, true);
        o.classList.remove("hidden");
        (danger ? noB : okB).focus({ preventScroll: true }); // dangerous actions default to Cancel
    });
}

// ---------- Field errors: a red outline and a message right under the field ----------
function clearFieldErrors() {
    document.querySelectorAll("#prForm .field-err").forEach(e => e.remove());
    document.querySelectorAll("#prForm .invalid").forEach(e => e.classList.remove("invalid"));
}
function fieldError(el, msg) {
    el.classList.add("invalid");
    const host = el.closest(".cell, .field") || el.parentElement;
    const m = document.createElement("small");
    m.className = "field-err";
    m.setAttribute("role", "alert");
    m.textContent = msg;
    host.appendChild(m);
    const clear = () => { el.classList.remove("invalid"); m.remove(); el.removeEventListener("input", clear); };
    el.addEventListener("input", clear);
    el.focus();
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    return false;
}

let toastTimer;
function toast(msg, undo) {
    const t = $("toast");
    t.textContent = msg;
    if (undo) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "toast-undo"; b.textContent = "Undo";
        b.addEventListener("click", () => { clearTimeout(toastTimer); t.classList.add("hidden"); undo(); });
        t.appendChild(b);
    }
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), undo ? 8000 : 3000);
}

// ---------- Firestore sync ----------
let firstEntriesSnap = true;
onSnapshot(col, { includeMetadataChanges: true }, snap => {
    remoteOk = true;
    // Metadata-only events (a write reaching the server) only change the status badge.
    if (firstEntriesSnap || snap.docChanges().length) {
        entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        saveLocal();
        refresh();
        if (rv && !reviewEditing) renderReview();
    }
    firstEntriesSnap = false;
    if (snap.metadata.fromCache && !navigator.onLine) setStatus("offline", "Offline");
    else if (snap.metadata.hasPendingWrites) setStatus("saving", "Saving...");
    else setStatus("online", "Online");
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
    setStatus("error", "Local only");
    toast("Could not save the void / not-used mark to the cloud. Saved on this device only.");
}

function remoteFail(err) {
    console.error(err);
    remoteOk = false;
    setStatus("error", "Local only");
    toast("Could not save to cloud. Saved on this device only.");
}

async function persist(entry, oldId, action) {
    const old = oldId && entries.find(e => e.id === oldId);
    if (isLocked(entry.pr) || (old && isLocked(old.pr))) return lockedToast();
    const idx = entries.findIndex(e => e.id === entry.id);
    const prev = idx >= 0 ? entries[idx] : (old || null);
    if (oldId && oldId !== entry.id) entries = entries.filter(e => e.id !== oldId);
    if (idx >= 0) entries[idx] = entry; else entries.push(entry);
    saveLocal();
    refresh();
    const { id, ...data } = entry;
    try {
        if (oldId && oldId !== id) deleteDoc(doc(col, oldId)).catch(remoteFail);
        const p = setDoc(doc(col, id), data);
        p.catch(remoteFail);
        trackSave(id, data, p, () => { // version history is written only after the cloud confirmed the save
            if (!prev || versionContent(prev) !== versionContent(entry)) recordVersion(action || (prev ? "edited" : "added"), entry, prev);
        });
    } catch (e) { remoteFail(e); }
}

// ---------- Save tracking: which receipts the cloud has not confirmed yet ----------
const saveState = new Map(); // id -> { data, state: "waiting" | "failed" }
function trackSave(id, data, promise, onSaved) {
    saveState.set(id, { data, state: "waiting" });
    renderSaveStatus();
    promise.then(() => {
        if (saveState.get(id)?.data === data) saveState.delete(id);
        renderSaveStatus();
        if (onSaved) onSaved();
    }).catch(() => {
        if (saveState.get(id)?.data === data) saveState.set(id, { data, state: "failed" });
        renderSaveStatus();
    });
}
function retryFailedSaves() {
    for (const [id, s] of [...saveState]) {
        if (s.state !== "failed") continue;
        const p = setDoc(doc(col, id), s.data);
        p.catch(remoteFail);
        trackSave(id, s.data, p, null);
    }
}
window.addEventListener("online", () => setTimeout(retryFailedSaves, 1500));

// ---------- Version history: every add / edit / delete / restore of a receipt, last MAX_VERSIONS per PR ----------
const histCol = collection(db, "pr_encoder_history");
let history = [];
let historyOk = true;
onSnapshot(histCol, snap => {
    historyOk = true;
    history = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!$("historyModal").classList.contains("hidden")) renderHistory();
    renderRecentSection();
}, err => { console.error("History listener error", err); historyOk = false; if (!$("historyModal").classList.contains("hidden")) renderHistory(); });
// What counts as a change (not the save time or the verified tick).
const versionContent = e => { const { id, updatedAt, checkedAt, ...rest } = e || {}; return JSON.stringify(rest); };
const versionData = e => { const { id, updatedAt, checkedAt, ...rest } = e; return JSON.parse(JSON.stringify(rest)); };
function recordVersion(action, entry, prev) {
    const at = Date.now();
    const pr = Number(entry.pr);
    const recs = [];
    // First time this PR is versioned: keep the state it had before this change as the "original".
    if (prev && action !== "added" && !versionsForPr(history, pr).length) recs.push({ action: "original", at: Math.min(prev.updatedAt || at - 1, at - 1), data: versionData(prev) });
    recs.push({ action, at, data: versionData(entry) });
    const writes = recs.map(r => {
        const rec = { pr, action: r.action, at: r.at, data: r.data };
        const id = `${pr}_${r.at}`;
        setDoc(doc(histCol, id), rec).catch(err => { console.error(err); historyFail(); });
        return { id, ...rec };
    });
    const trim = versionsToTrim(history.concat(writes), pr, MAX_VERSIONS);
    trim.forEach(id => deleteDoc(doc(histCol, id)).catch(err => console.error(err)));
}
let historyFailShown = false;
function historyFail() {
    historyOk = false;
    if (historyFailShown) return;
    historyFailShown = true;
    toast("Could not save the version history. The receipt itself is saved. Add the pr_encoder_history rule in Firestore (see README).");
}

// ---------- Shared item catalog: one document in the cloud, so every device uses the same items, prices and shorthand ----------
const catalogDoc = doc(collection(db, "pr_encoder_catalog"), "main");
const defaultCatalog = () => (window.CATALOG || []).map(c => ({ desc: c.desc, price: c.price, category: c.category, code: c.code }));
function saveCatalogToCloud(items) {
    items = JSON.parse(JSON.stringify(items)); // Firestore rejects undefined fields (e.g. an item without a shorthand code)
    return setDoc(catalogDoc, { items, updatedAt: Date.now() }).catch(err => {
        console.error(err);
        toast("Could not save the catalog to the cloud. It is saved on this device only.");
    });
}
onSnapshot(catalogDoc, snap => {
    if (snap.exists() && Array.isArray(snap.data().items) && snap.data().items.length) {
        localStorage.setItem(LS_CATALOG, JSON.stringify(snap.data().items));
        if ($("catalogModal").classList.contains("hidden")) { catalog = loadCatalog(); catalogOptions(); } // never overwrite what is being edited
    } else if (!snap.metadata.fromCache && localStorage.getItem(LS_CATALOG)) {
        saveCatalogToCloud(loadCatalog()); // first time: this device's catalog becomes the shared one
    }
}, err => console.error("Catalog listener error", err));

// ---------- Online payment channels (GCash, BDO, ...): one shared list, extendable from the form ----------
const LS_CHANNELS = "pre_channels_v1";
const channelsDoc = doc(collection(db, "pr_encoder_catalog"), "channels"); // same collection as the item catalog (no new Firestore rule needed)
const loadChannels = () => { try { const c = JSON.parse(localStorage.getItem(LS_CHANNELS)); if (Array.isArray(c) && c.length) return c; } catch { /* ignore */ } return [...DEFAULT_CHANNELS]; };
let channels = loadChannels();
function saveChannels() {
    localStorage.setItem(LS_CHANNELS, JSON.stringify(channels));
    return setDoc(channelsDoc, { items: channels, updatedAt: Date.now() }).catch(err => {
        console.error(err);
        toast("Could not save the channel list to the cloud. It is saved on this device only.");
    });
}
onSnapshot(channelsDoc, snap => {
    if (snap.exists() && Array.isArray(snap.data().items) && snap.data().items.length) {
        channels = snap.data().items;
        localStorage.setItem(LS_CHANNELS, JSON.stringify(channels));
        fillChannelSelects();
    } else if (!snap.metadata.fromCache && localStorage.getItem(LS_CHANNELS)) saveChannels(); // first time: this device's list becomes the shared one
}, err => console.error("Channels listener error", err));
// Fills the two channel dropdowns (form and split) and the channel entries of the payment filter, keeping what is selected.
function fillChannelSelects() {
    [$("fChannel"), $("sChannel")].forEach(sel => {
        const cur = sel.value === "__new" ? "" : sel.value;
        const list = cur && !channels.some(c => c.toLowerCase() === cur.toLowerCase()) ? [...channels, cur] : channels; // a channel on an old receipt stays selectable
        sel.innerHTML = `<option value="">Select channel...</option>` + list.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join("") + `<option value="__new">+ Add new channel...</option>`;
        sel.value = cur;
    });
    const f = $("mopFilter"), cur = f.value;
    f.querySelectorAll("option[value^='channel:']").forEach(o => o.remove());
    channels.forEach(c => f.add(new Option(`Online - ${c}`, `channel:${c}`)));
    if (cur && ![...f.options].some(o => o.value === cur)) f.add(new Option(cur.replace(/^channel:/, "Online - "), cur));
    f.value = cur;
}
function addChannel(name) {
    const n = matchChannel(channels, name);
    if (n && !channels.some(c => c === n)) { channels.push(n); saveChannels(); fillChannelSelects(); }
    return n;
}
// Dropdown + "add new" box: choosing "+ Add new channel..." shows the box; Enter adds the name to the shared list and selects it.
function bindChannelInput(sel, input) {
    const done = () => { input.classList.add("hidden"); input.value = ""; };
    const commit = () => {
        const n = input.value.trim() ? addChannel(input.value) : "";
        done(); sel.value = n; if (!n) sel.value = "";
    };
    sel.addEventListener("change", () => {
        if (sel.value === "__new") { input.classList.remove("hidden"); input.focus(); } else done();
    });
    input.addEventListener("keydown", ev => {
        if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); commit(); sel.focus(); }
        else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); done(); sel.value = ""; sel.focus(); }
    });
    input.addEventListener("blur", () => { if (!input.classList.contains("hidden")) commit(); });
}
// The chosen channel ("" when none). A name typed in the add box but not confirmed yet is added too.
function readChannel(sel, input) {
    if (sel.value === "__new") return input.value.trim() ? addChannel(input.value) : "";
    return sel.value;
}
function setChannel(sel, input, value) {
    input.classList.add("hidden"); input.value = "";
    if (value && ![...sel.options].some(o => o.value === value)) sel.add(new Option(value, value), sel.options[sel.options.length - 1]); // not in the list: keep it selectable
    sel.value = value || "";
}

// ---------- Price history: every catalog price change is recorded (item, old price, new price, when) ----------
const LS_PRICE_HISTORY = "pre_price_history_v1";
const priceHistoryCol = collection(db, "pr_encoder_price_history");
let priceHistory = (() => { try { return JSON.parse(localStorage.getItem(LS_PRICE_HISTORY)) || []; } catch { return []; } })();
onSnapshot(priceHistoryCol, snap => {
    priceHistory = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    localStorage.setItem(LS_PRICE_HISTORY, JSON.stringify(priceHistory));
    if (!$("priceHistoryModal").classList.contains("hidden")) renderPriceHistory();
}, err => console.error("Price history listener error", err));
function recordPriceChanges(prev, next) {
    const changes = priceChanges(prev, next);
    if (!changes.length) return;
    const at = Date.now();
    changes.forEach((c, i) => {
        const id = `${at}_${String(i).padStart(3, "0")}`;
        const rec = { ...c, at };
        priceHistory.push({ id, ...rec });
        setDoc(doc(priceHistoryCol, id), rec).catch(err => { console.error(err); toast("Could not save the price history to the cloud."); });
    });
    localStorage.setItem(LS_PRICE_HISTORY, JSON.stringify(priceHistory));
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

async function toggleLock(start) {
    const on = !locks.includes(start);
    if (!on && !(await askConfirm({ title: `Unlock booklet ${bookletLabel(start)}?`, message: "It can be changed again.", ok: "Unlock" }))) return;
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
    const dp = deleteDoc(doc(col, id));
    dp.catch(remoteFail);
    if (cur) dp.then(() => recordVersion("deleted", cur, cur)).catch(() => {});
    if (cur) toast(`PR #${cur.pr} deleted.`, () => { persist(cur, undefined, "restored"); toast(`PR #${cur.pr} restored.`); });
}

// ---------- Form ----------
function catalogOptions() { /* suggestions are built on demand by the item picker */ }

// Item name field in the color of its book cover (same colors as the output table); no color for other items.
function tintItem(input) {
    const c = itemColor(input.value);
    input.classList.toggle("item-c", !!c);
    if (c) input.style.setProperty("--item-color", c); else input.style.removeProperty("--item-color");
}

// ---- Buyer autocomplete: names already used on earlier receipts ----
let buyerPop = null, buyerItems = [], buyerActive = -1;
function closeBuyerPop() { if (buyerPop) buyerPop.classList.add("hidden"); buyerItems = []; buyerActive = -1; }
function paintBuyerPop() {
    buyerPop.innerHTML = buyerItems.map((b, i) =>
        `<div class="item-opt${i === buyerActive ? " active" : ""}" role="option" data-i="${i}"><span class="item-opt-name">${esc(b.name)}</span><span class="item-opt-price" title="Receipts with this buyer">\u00D7${b.n}</span></div>`).join("");
    const act = buyerPop.querySelector(".active");
    if (act) act.scrollIntoView({ block: "nearest" });
}
function openBuyerPop() {
    const input = $("fBuyer");
    const items = document.activeElement === input ? buyerSuggestions(entries, input.value) : [];
    if (!items.length) { closeBuyerPop(); return; }
    if (!buyerPop) {
        buyerPop = document.createElement("div");
        buyerPop.className = "item-pop hidden";
        buyerPop.setAttribute("role", "listbox");
        buyerPop.addEventListener("mousedown", ev => { // mousedown so the field keeps focus
            ev.preventDefault();
            const li = ev.target.closest("[data-i]");
            if (li) pickBuyer(buyerItems[Number(li.dataset.i)].name);
        });
        document.body.appendChild(buyerPop);
        window.addEventListener("resize", closeBuyerPop);
        window.addEventListener("scroll", ev => { if (!buyerPop.contains(ev.target)) closeBuyerPop(); }, true);
    }
    buyerItems = items; buyerActive = -1;
    const r = input.getBoundingClientRect();
    buyerPop.style.left = r.left + "px";
    buyerPop.style.top = (r.bottom + 4) + "px";
    buyerPop.style.minWidth = Math.max(r.width, 220) + "px";
    buyerPop.style.maxHeight = Math.max(120, Math.min(300, window.innerHeight - r.bottom - 16)) + "px";
    buyerPop.classList.remove("hidden");
    paintBuyerPop();
}
function pickBuyer(name) {
    $("fBuyer").value = name;
    closeBuyerPop();
    $("fBuyer").dispatchEvent(new Event("input", { bubbles: true }));
}
$("fBuyer").addEventListener("input", openBuyerPop);
$("fBuyer").addEventListener("blur", closeBuyerPop);
$("fBuyer").addEventListener("keydown", ev => {
    const open = buyerPop && !buyerPop.classList.contains("hidden");
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        if (!open) { openBuyerPop(); if (!buyerPop || buyerPop.classList.contains("hidden")) return; }
        ev.preventDefault();
        const n = buyerItems.length;
        buyerActive = ev.key === "ArrowDown" ? (buyerActive + 1) % n : (buyerActive - 1 + n) % n;
        paintBuyerPop();
    } else if (open && ev.key === "Enter" && buyerActive >= 0) {
        pickBuyer(buyerItems[buyerActive].name); // then Enter carries on to the next field as usual
    } else if (open && ev.key === "Escape") {
        ev.preventDefault(); ev.stopPropagation(); closeBuyerPop();
    } else if (open && ev.key === "Tab") {
        closeBuyerPop();
    }
});

// ---- Item picker: custom suggestion list (each book in its cover color, price on the right) ----
let itemPop = null, itemPopFor = null, itemPopItems = [], itemPopActive = -1;
function ensureItemPop() {
    if (itemPop) return itemPop;
    itemPop = document.createElement("div");
    itemPop.className = "item-pop hidden";
    itemPop.setAttribute("role", "listbox");
    // mousedown (not click) so the input keeps focus while choosing
    itemPop.addEventListener("mousedown", ev => {
        ev.preventDefault();
        const li = ev.target.closest("[data-i]");
        if (li && itemPopFor) pickItem(itemPopFor, itemPopItems[Number(li.dataset.i)], true);
    });
    document.body.appendChild(itemPop);
    window.addEventListener("resize", closeItemPop);
    window.addEventListener("scroll", ev => { if (!itemPop.contains(ev.target)) closeItemPop(); }, true);
    return itemPop;
}
function closeItemPop() {
    if (!itemPop) return;
    itemPop.classList.add("hidden");
    itemPopFor = null; itemPopItems = []; itemPopActive = -1;
}
function itemMatches(q) {
    q = q.trim().toLowerCase();
    if (!q) return catalog.slice();
    const viaShortcut = resolveShortcut(catalog, q).items || [];
    const seen = new Set(viaShortcut.map(i => i.desc));
    return [...viaShortcut, ...catalog.filter(c => !seen.has(c.desc) && c.desc.toLowerCase().includes(q))];
}
function paintItemPop() {
    itemPop.innerHTML = itemPopItems.map((c, i) => {
        const col = itemColor(c.desc);
        return `<div class="item-opt${i === itemPopActive ? " active" : ""}" role="option" data-i="${i}">
            <span class="item-opt-name${col ? " item-c" : ""}"${col ? ` style="--item-color:${col}"` : ""}>${esc(c.desc)}</span>
            <span class="item-opt-code" title="Type this shorthand, then press Enter">${esc(itemShortcut(catalog, c))}</span>
            <span class="item-opt-price">${peso(c.price)}</span></div>`;
    }).join("");
    const act = itemPop.querySelector(".active");
    if (act) act.scrollIntoView({ block: "nearest" });
}
function openItemPop(input) {
    const items = itemMatches(input.value);
    if (!items.length || document.activeElement !== input) { closeItemPop(); return; }
    const pop = ensureItemPop();
    itemPopFor = input; itemPopItems = items; itemPopActive = -1;
    const r = input.getBoundingClientRect();
    pop.style.left = r.left + "px";
    pop.style.top = (r.bottom + 4) + "px";
    pop.style.minWidth = Math.max(r.width, 280) + "px";
    pop.style.maxHeight = Math.max(120, Math.min(320, window.innerHeight - r.bottom - 16)) + "px";
    pop.classList.remove("hidden");
    paintItemPop();
}
function pickItem(input, item, moveOn) {
    if (!item) return;
    input.value = item.desc;
    input.dispatchEvent(new Event("input", { bubbles: true })); // fills the price, tint and total
    closeItemPop();
    if (moveOn) input.closest(".item-row").querySelector(".item-qty").focus();
}
function attachItemPicker(input) {
    input.addEventListener("focus", () => openItemPop(input));
    input.addEventListener("input", () => openItemPop(input));
    input.addEventListener("blur", () => { if (itemPopFor === input) closeItemPop(); });
    input.addEventListener("keydown", ev => {
        const open = itemPop && !itemPop.classList.contains("hidden") && itemPopFor === input;
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
            if (!open) { openItemPop(input); if (!itemPop || itemPop.classList.contains("hidden")) return; }
            ev.preventDefault();
            const n = itemPopItems.length;
            itemPopActive = ev.key === "ArrowDown" ? (itemPopActive + 1) % n : (itemPopActive - 1 + n) % n;
            paintItemPop();
        } else if (open && ev.key === "Enter" && itemPopActive >= 0) {
            ev.preventDefault(); ev.stopPropagation(); // choose the highlighted item instead of moving on
            pickItem(input, itemPopItems[itemPopActive], true);
        } else if (open && ev.key === "Escape") {
            ev.preventDefault(); ev.stopPropagation();
            closeItemPop();
        } else if (open && ev.key === "Tab") {
            closeItemPop();
        }
    });
}

// Price to fill in for a catalog item. A row loaded from a saved PR keeps that PR's saved price for the same item,
// so editing an old receipt never swaps in today's catalog price. Choosing a different item uses the catalog price.
function priceFor(row, catalogItem) {
    const saved = row.dataset.savedDesc;
    if (saved && saved.toLowerCase() === catalogItem.desc.toLowerCase()) return Number(row.dataset.savedPrice);
    return catalogItem.price;
}

function addItemRow(item = { desc: "", qty: 1, price: "" }) {
    const row = document.createElement("div");
    row.className = "item-row";
    if (editingId && item.desc && item.price !== "") { row.dataset.savedDesc = item.desc; row.dataset.savedPrice = item.price; }
    row.innerHTML = `
        <label class="cell item-name-cell"><span>Item</span>
            <input class="item-name" type="text" placeholder="Search, or type a shorthand (e.g. gte, b1)" value="${esc(item.desc)}">
            <small class="sc-hint hidden"></small></label>
        <label class="cell"><span>Qty</span>
            <input class="item-qty" type="number" min="1" step="1" placeholder="Qty" value="${item.qty}"></label>
        <label class="cell"><span>Unit Price</span>
            <input class="item-price" type="number" min="0" step="0.01" placeholder="0.00" value="${item.price}"></label>
        <div class="cell"><span>Total</span><div class="line-total">${peso(item.qty * (item.price || 0))}</div></div>
        <button type="button" class="btn btn-danger btn-icon-only" title="Remove item" tabindex="-1"><i class="ri-close-line"></i></button>`;
    const name = row.querySelector(".item-name");
    attachItemPicker(name);
    const qty = row.querySelector(".item-qty");
    const price = row.querySelector(".item-price");
    const hint = row.querySelector(".sc-hint");
    name.addEventListener("input", () => {
        const hit = catalog.find(c => c.desc.toLowerCase() === name.value.trim().toLowerCase());
        if (hit) price.value = priceFor(row, hit);
        tintItem(name);
        showShortcutHint(name, hint);
        updateFormTotal();
    });
    // Shorthand is applied when you leave the field (Tab / click away) or press Enter.
    name.addEventListener("change", () => { applyShortcut(name); tintItem(name); showShortcutHint(name, hint); });
    name.addEventListener("blur", () => hint.classList.add("hidden"));
    qty.addEventListener("input", updateFormTotal);
    price.addEventListener("input", updateFormTotal);
    row.querySelector("button").addEventListener("click", () => {
        if ($("itemsList").children.length > 1) row.remove(); else { name.value = ""; tintItem(name); qty.value = 1; price.value = ""; }
        updateFormTotal();
    });
    tintItem(name);
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
    tintItem(nameInput);
    row.querySelector(".item-price").value = priceFor(row, r.items[0]);
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
    if (on) $("fMop").value = "Split";
    else if ($("fMop").value === "Split") $("fMop").value = "Cash";
    if (on) {
        $("refField").classList.add("hidden");
        $("fRef").value = ""; $("bankField").classList.add("hidden"); $("fBank").value = "";
        $("sCash").value = ""; $("sOnline").value = ""; $("sRef").value = ""; $("sBank").value = "";
        splitAnchor = "cash";
        updateSplitRefLabel();
        recalcSplit();
    } else {
        $("sCash").value = ""; $("sOnline").value = ""; $("sRef").value = "";
        updateRefField();
    }
}
function updateSplitRefLabel() {
    const o = $("sMethod").value === "Others";
    $("sRefLabel").textContent = o ? "Please specify" : "Reference No.";
    $("sRef").placeholder = o ? "Please specify" : "e.g. 689746";
    const bank = $("sMethod").value === "Bank Transfer";
    $("sBankField").classList.toggle("hidden", !bank);
    if (!bank) $("sBank").value = "";
}
$("sCash").addEventListener("input", () => { splitAnchor = "cash"; recalcSplit(); });
$("sOnline").addEventListener("input", () => { splitAnchor = "online"; recalcSplit(); });
$("sMethod").addEventListener("change", () => { updateSplitRefLabel(); (($("sMethod").value === "Bank Transfer") ? $("sBank") : $("sRef")).focus(); });

// One-click fix inside the PR number warning: use the next expected number.
function fixPrButton(n) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-secondary warn-fix";
    b.dataset.usePr = n;
    b.textContent = `Use #${n}`;
    return b;
}
$("prWarn").addEventListener("click", ev => {
    const b = ev.target.closest("[data-use-pr]");
    if (!b) return;
    $("fPr").value = b.dataset.usePr;
    $("fPr").classList.remove("invalid");
    clearFieldErrors();
    updatePrWarning();
    updateBookletHint();
    $("fPr").focus();
});

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
        el.textContent = `PR #${pr} already exists. Use a different number, or edit the existing receipt. `;
        el.appendChild(fixPrButton(expected));
        el.classList.add("error");
        el.classList.remove("hidden");
        return false;
    }
    if (gap) {
        el.textContent = `PR #${pr} skips ahead. The next expected number is #${expected}. `;
        el.appendChild(fixPrButton(expected));
        el.classList.remove("hidden");
    } else {
        el.classList.add("hidden");
    }
    return true;
}

function resetForm() {
    clearFieldErrors();
    editingId = null;
    // Date stays on the last one used until the user changes it.
    setDate(localStorage.getItem(LS_LAST_DATE) || todayISO());
    // Batch encoding: continue from the last encoded PR (42701 -> 42702).
    const lastPr = Number(localStorage.getItem(LS_LAST_PR));
    $("fPr").value = skipMarked(lastPr > 0 ? lastPr + 1 : nextPr(entries, marks), marks);
    $("fBuyer").value = "Anonymous";
    $("fMop").value = "Cash";
    $("fRef").value = "";
    setChannel($("fChannel"), $("fChannelNew"), ""); setChannel($("sChannel"), $("sChannelNew"), "");
    toggleSplit(false);
    $("sMethod").value = "Online Payment";
    $("itemsList").innerHTML = "";
    addItemRow();
    $("formTitle").textContent = "New Provisional Receipt";
    $("submitText").textContent = "Add PR to output";
    $("editBadge").classList.add("hidden");
    $("cancelEditBtn").classList.add("hidden");
    updatePrWarning();
    updateBookletHint();
}

// Map a saved payment name to what the form offers now: Cash stays Cash, everything else non-cash becomes Online Payment.
// The channel is the saved one, or the old name / bank when it matches a channel in the list (e.g. GCash, BDO).
function modernMop(method, bank, channel) {
    const m = method && method !== "Split" ? method : "Cash";
    if (m === "Cash") return { method: "Cash", channel: "" };
    if (channel) return { method: "Online Payment", channel };
    const hit = [m, bank].map(x => String(x || "").trim().toLowerCase()).filter(Boolean)
        .map(x => channels.find(c => c.toLowerCase() === x)).find(Boolean);
    return { method: "Online Payment", channel: hit || "" };
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
        // Old payment names (Invoice, GCash, Bank Transfer, ...) are non-cash = online: edit them as Online Payment with the matching channel.
        const lg = modernMop(e.mop, e.mopBank, e.mopChannel);
        $("fMop").value = lg.method;
        $("fRef").value = e.mopRef || ""; $("fBank").value = e.mopBank || "";
        updateRefField();
        setChannel($("fChannel"), $("fChannelNew"), lg.channel);
    }
    $("itemsList").innerHTML = "";
    e.items.forEach(addItemRow);
    if (isSplit) {
        const cashPay = e.payments.find(p => p.method === "Cash");
        const onlinePay = e.payments.find(p => p.method !== "Cash");
        toggleSplit(true);
        $("sCash").value = cashPay ? String(cashPay.amount) : "";
        if (onlinePay) { const lg = modernMop(onlinePay.method, onlinePay.bank, onlinePay.channel); $("sMethod").value = lg.method; $("sRef").value = onlinePay.ref || ""; $("sBank").value = onlinePay.bank || ""; setChannel($("sChannel"), $("sChannelNew"), lg.channel); }
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

// Old entries may use a retired method name (Invoice, Maya, Check, Other); keep it selectable so editing doesn't change it.
function ensureOption(sel, value) {
    if (value && ![...sel.options].some(o => o.value === value)) sel.add(new Option(value, value));
}
function updateRefField() {
    const v = $("fMop").value;
    const show = !!v && v !== "Cash" && v !== "Split";
    $("refField").classList.toggle("hidden", !show);
    $("refLabel").textContent = v === "Others" ? "Please specify" : v === "Cheque" ? "Cheque No." : "Reference No.";
    $("fRef").placeholder = v === "Others" ? "Please specify" : "e.g. 689746";
    if (!show) $("fRef").value = "";
    const chan = v === "Online Payment";
    $("channelField").classList.toggle("hidden", !chan);
    if (!chan) setChannel($("fChannel"), $("fChannelNew"), "");
    const bank = v === "Bank Transfer" && !splitOn;
    $("bankField").classList.toggle("hidden", !bank);
    if (!bank) $("fBank").value = "";
}
$("fMop").addEventListener("change", () => {
    const wantSplit = $("fMop").value === "Split";
    if (wantSplit !== splitOn) {
        toggleSplit(wantSplit);
        if (wantSplit) { $("sCash").focus(); return; }
    }
    updateRefField();
    if (!$("bankField").classList.contains("hidden")) $("fBank").focus();
    else if (!$("refField").classList.contains("hidden")) $("fRef").focus();
});
// ---- Date entry: type digits only (0913 2026 -> 09-13-2026), or use Today / arrows ----
function setDate(iso) { $("fDate").value = iso ? fmtDate(iso) : ""; updateDateWarning(); }
// Soft warning when the date is far from the booklet's usual month (typo in month or year). Returns the info or null.
function updateDateWarning() {
    const el = $("dateWarn");
    if (!el) return null;
    const iso = getDate();
    const far = iso && $("fPr").value ? dateFarFromBooklet(entries, $("fPr").value, iso, editingId) : null;
    if (far) el.textContent = `This date is ${far.days} days from the other receipts in this booklet (around ${fmtDate(far.usual)}). Check the month and year.`;
    el.classList.toggle("hidden", !far);
    return far;
}
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
$("fDate").addEventListener("blur", () => { completeYear(); updateDateWarning(); });
$("fDate").addEventListener("input", updateDateWarning);
$("fPr").addEventListener("input", updateDateWarning);
$("fDate").addEventListener("keydown", ev => { if (ev.key === "Enter") completeYear(); });
$("fDate").addEventListener("focus", () => $("fDate").select());
$("datePrev").addEventListener("click", () => shiftDate(-1));
$("dateNext").addEventListener("click", () => shiftDate(1));

// ---- Mini calendar: click the date field to pick a day (typing still works) ----
const cal = (() => {
    const wrap = $("fDate").closest(".field-date");
    const el = document.createElement("div");
    el.className = "cal-pop hidden";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Choose a date");
    wrap.appendChild(el);
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    let vy = 0, vm = 0;
    const isOpen = () => !el.classList.contains("hidden");

    function render() {
        const sel = getDate(), today = todayISO();
        const first = new Date(vy, vm, 1).getDay();
        const days = new Date(vy, vm + 1, 0).getDate();
        let cells = "";
        for (let i = 0; i < first; i++) cells += `<span class="cal-blank"></span>`;
        for (let d = 1; d <= days; d++) {
            const v = iso(vy, vm, d);
            cells += `<button type="button" class="cal-day${v === sel ? " sel" : ""}${v === today ? " today" : ""}" data-iso="${v}">${d}</button>`;
        }
        el.innerHTML = `
            <div class="cal-head">
                <button type="button" class="cal-nav" data-cal="prevyear" title="Previous year"><i class="ri-arrow-left-double-line"></i></button>
                <button type="button" class="cal-nav" data-cal="prev" title="Previous month"><i class="ri-arrow-left-s-line"></i></button>
                <strong class="cal-title">${MONTHS[vm]} ${vy}</strong>
                <button type="button" class="cal-nav" data-cal="next" title="Next month"><i class="ri-arrow-right-s-line"></i></button>
                <button type="button" class="cal-nav" data-cal="nextyear" title="Next year"><i class="ri-arrow-right-double-line"></i></button>
            </div>
            <div class="cal-week">${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(w => `<span>${w}</span>`).join("")}</div>
            <div class="cal-grid">${cells}</div>
            <div class="cal-foot"><button type="button" class="btn btn-secondary btn-sm" data-cal="today">Today</button></div>`;
    }
    function open() {
        const [y, m] = (getDate() || todayISO()).split("-").map(Number);
        vy = y; vm = m - 1;
        render();
        el.classList.remove("hidden");
    }
    function close() { el.classList.add("hidden"); }
    function pick(v) {
        setDate(v);
        localStorage.setItem(LS_LAST_DATE, v);
        close();
        $("fDate").focus();
    }
    el.addEventListener("click", ev => {
        const day = ev.target.closest("[data-iso]");
        if (day) return pick(day.dataset.iso);
        const nav = ev.target.closest("[data-cal]");
        if (!nav) return;
        const k = nav.dataset.cal;
        if (k === "today") return pick(todayISO());
        if (k === "prev") vm -= 1; else if (k === "next") vm += 1; else if (k === "prevyear") vy -= 1; else if (k === "nextyear") vy += 1;
        const d = new Date(vy, vm, 1); vy = d.getFullYear(); vm = d.getMonth();
        render();
    });
    // Esc closes only the calendar (not the review or the edit mode behind it)
    el.addEventListener("keydown", ev => { if (ev.key === "Escape") { ev.stopPropagation(); close(); $("fDate").focus(); } });
    $("fDate").addEventListener("click", () => { if (!isOpen()) open(); });
    $("fDate").addEventListener("keydown", ev => {
        if (ev.key === "Escape" && isOpen()) { ev.stopPropagation(); close(); }
        else if (ev.key === "ArrowDown" && !isOpen()) { ev.preventDefault(); open(); }
    });
    // Typing a valid date moves the calendar to that month
    $("fDate").addEventListener("input", () => {
        if (!isOpen()) return;
        const v = getDate();
        if (v) { const [y, m] = v.split("-").map(Number); vy = y; vm = m - 1; render(); }
    });
    document.addEventListener("click", ev => { if (isOpen() && !ev.target.closest(".field-date")) close(); });
    $("datePrev").addEventListener("click", () => { if (isOpen()) close(); });
    $("dateNext").addEventListener("click", () => { if (isOpen()) close(); });
    return { close };
})();
$("fPr").addEventListener("input", () => { $("fPr").classList.remove("invalid"); updatePrWarning(); updateBookletHint(); });
$("addRowBtn").addEventListener("click", () => addItemRow().querySelector(".item-name").focus());

// ---- Keyboard shortcuts ----
//  Enter       next field (after the last price, starts a new item row)
//  Alt+N       add item row
//  Alt+S       split payment on/off (part cash, part online)
//  Alt+C       MOP: Cash
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
let submitBusy = false;
$("prForm").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (suppressSubmit || submitBusy) return;
    clearFieldErrors();
    if (!$("fPr").value) { fieldError($("fPr"), "Enter the PR number printed on the paper receipt."); return; }
    if (!updatePrWarning()) {
        toast(isLocked($("fPr").value) ? "This booklet is locked." : "Duplicate PR number.");
        $("fPr").classList.add("invalid"); $("fPr").focus(); return; // the red box under the number says why, with a one-click fix
    }
    completeYear();
    $("itemsList").querySelectorAll(".item-name").forEach(applyShortcut); // e.g. submitted with Ctrl+Enter while still on "gte"
    if (!getDate()) { fieldError($("fDate"), "Enter a valid date as MM-DD-YYYY, for example 11-06-2026."); return; }
    const far = updateDateWarning();
    if (far) {
        submitBusy = true;
        const okFar = await askConfirm({ title: "Check the date", message: `The date ${fmtDate(getDate())} is ${far.days} days away from the other receipts in this booklet (around ${fmtDate(far.usual)}).\n\nSave anyway?`, ok: "Save anyway", cancel: "Fix the date" });
        submitBusy = false;
        if (!okFar) { $("fDate").focus(); return; }
    }
    const items = readItems().filter(i => i.desc);
    if (!items.length) { fieldError($("itemsList").querySelector(".item-name"), "Add at least one sold item (search, or type a shorthand like gte)."); return; }
    for (const i of items) {
        if (!(i.qty > 0)) { fieldError(i._raw.querySelector(".item-qty"), "Quantity must be 1 or more."); return; }
        if (!(i.price >= 0) || Number.isNaN(i.price)) { fieldError(i._raw.querySelector(".item-price"), "Enter the unit price."); return; }
    }
    const pr = Number($("fPr").value);
    const entry = {
        id: `pr_${pr}`,
        date: getDate(),
        pr,
        buyer: $("fBuyer").value.trim() || "Anonymous",
        mop: $("fMop").value,
        mopRef: $("fRef").value.trim(),
        mopBank: $("fBank").value.trim(),
        items: items.map(({ desc, qty, price }) => ({ desc, qty, price })),
        updatedAt: Date.now()
    };
    if (entry.mop === "Online Payment") { const ch = readChannel($("fChannel"), $("fChannelNew")); if (ch) entry.mopChannel = ch; }
    if (splitOn) {
        const total = entryTotal(entry);
        const cash = round2(Number($("sCash").value) || 0);
        const online = round2(Number($("sOnline").value) || 0);
        if (!(cash > 0) || !(online > 0)) { fieldError(!(cash > 0) ? $("sCash") : $("sOnline"), "Split payment needs both a cash and an online amount."); return; }
        if (round2(cash + online) !== total) { fieldError($("sCash"), `Cash + online must equal the receipt total (${peso(total)}).`); return; }
        entry.mop = "Split";
        entry.mopRef = "";
        entry.mopBank = "";
        entry.payments = [
            { method: "Cash", amount: cash },
            { method: $("sMethod").value, amount: online, ref: $("sRef").value.trim(), bank: $("sBank").value.trim() }
        ];
        const sch = readChannel($("sChannel"), $("sChannelNew"));
        if (sch) entry.payments[1].channel = sch;
    }
    const oldId = editingId;
    const wasEdit = !!editingId;
    const prevEntry = wasEdit ? entries.find(e => e.id === oldId) : null;
    // A changed date carries on to the later PRs of the booklet (higher PR number = same or later date).
    let cascade = [];
    if (!prevEntry || prevEntry.date !== entry.date) {
        const ct = cascadeDateTargets(entries, entry, isLocked);
        if (ct.change.length) {
            const n = ct.change.length, s = n > 1 ? "s" : "";
            const range = n > 1 ? `#${ct.change[0].pr} to #${ct.change[n - 1].pr}` : `#${ct.change[0].pr}`;
            const skipped = ct.skipped.length ? ` ${ct.skipped.length} locked PR${ct.skipped.length > 1 ? "s" : ""} will not change.` : "";
            if (await askConfirm({ title: `Change ${n} later PR${s} to ${fmtDate(entry.date)}?`, message: `PR${s} ${range} in booklet ${bookletLabel(bookletStart(pr))} will get the same date as PR #${pr}.${skipped} You can change any of them again later.`, ok: `Change all ${n}`, cancel: "Only this PR" })) cascade = ct.change;
        }
    }
    const cascadeOriginals = cascade.map(t => ({ ...t }));
    persist(entry, oldId);
    cascade.forEach(t => persist({ ...t, date: entry.date, updatedAt: Date.now() }, undefined, "edited"));
    if (marks.some(m => Number(m.pr) === pr)) clearMark(pr); // a real receipt replaces a void / not-used mark
    if (wasEdit) toast(`PR #${pr} updated.`, prevEntry && (() => { persist({ ...prevEntry }, entry.id, "restored"); toast(`PR #${prevEntry.pr} changes undone.`); }));
    else if (pr % BOOKLET_SIZE === 0) toast(`PR #${pr} added. Booklet ${bookletLabel(bookletStart(pr))} is fully encoded - next sheet starts a new booklet.`);
    else toast(`PR #${pr} added.`);
    if (cascade.length) toast(`PR #${pr} ${wasEdit ? "updated" : "added"}. ${cascade.length} later PR${cascade.length > 1 ? "s" : ""} changed to ${fmtDate(entry.date)}.`, () => {
        if (wasEdit && prevEntry) persist({ ...prevEntry }, entry.id, "restored");
        cascadeOriginals.forEach(o => persist(o, undefined, "restored"));
        toast("Date changes undone.");
    });
    localStorage.setItem(LS_LAST_DATE, entry.date);
    if (!wasEdit) localStorage.setItem(LS_LAST_PR, String(pr));
    resetForm();
    if (reviewEditing) { finishReviewEdit(pr); return; }
    $("itemsList").querySelector(".item-name").focus();
});

// ---------- Output ----------
function currentFilter() {
    return { q: $("searchInput").value, from: $("fromDate").value, to: $("toDate").value, booklet: $("bookletFilter").value, unchecked: $("uncheckedOnly").checked, mop: $("mopFilter").value, month: $("monthFilter").value };
}
function visibleRows() {
    const f = currentFilter();
    const rows = flatten(filterEntries(entries, f));
    // Void / not-used numbers belong in the sheet too, unless a search or date filter is narrowing it down.
    return f.q.trim() || f.from || f.to || f.unchecked || f.mop || f.month ? rows : withMarks(rows, marks, f);
}

// Mark the PR number in the form as void (cancelled) or not used (blank / skipped), then move on.
async function markFromForm(status) {
    const pr = Number($("fPr").value);
    if (!(pr > 0)) return toast("Enter the PR number first.");
    if (editingId) return toast("Finish or cancel the edit first.");
    if (isLocked(pr)) return lockedToast();
    if (entries.some(e => Number(e.pr) === pr)) return toast(`PR #${pr} already has a receipt. Delete it first if the sheet was cancelled.`);
    if (!(await askConfirm({ title: `Mark PR #${pr} as ${markLabel(status)}?`, message: "You can clear the mark later from the list.", ok: "Mark it" }))) return;
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
// Month groups: booklets are grouped under the month they were finished (latest receipt date).
const collapsedMonths = new Set();
let monthsDefaulted = false;
let renderedStarts = []; // booklets shown in the table right now (also those inside a collapsed month)

// Remember the view (open months and booklets, filters, cards month) across reloads.
const LS_VIEW_STATE = "pre_view_state_v1";
let pendingSel = null; // saved booklet / month filter, applied once those dropdowns have options
(function restoreViewState() {
    let st = null;
    try { st = JSON.parse(localStorage.getItem(LS_VIEW_STATE)); } catch { /* ignore */ }
    if (!st || typeof st !== "object") return;
    (st.months || []).forEach(m => collapsedMonths.add(m));
    (st.booklets || []).forEach(b => collapsedBooklets.add(Number(b)));
    monthsDefaulted = true; bookletsDefaulted = true;
    if (st.cardMonth) cardMonth = st.cardMonth;
    const f = st.f || {};
    $("searchInput").value = f.q || ""; $("fromDate").value = f.from || ""; $("toDate").value = f.to || "";
    $("uncheckedOnly").checked = !!f.unchecked; ensureOption($("mopFilter"), f.mop); $("mopFilter").value = f.mop || "";
    pendingSel = { booklet: f.booklet || "", month: f.month || "" };
})();
function saveViewState() {
    if (!monthsDefaulted || !bookletsDefaulted) return; // nothing loaded yet
    const f = currentFilter();
    try {
        localStorage.setItem(LS_VIEW_STATE, JSON.stringify({
            months: [...collapsedMonths], booklets: [...collapsedBooklets], cardMonth,
            f: { q: f.q, booklet: pendingSel ? pendingSel.booklet : f.booklet, month: pendingSel ? pendingSel.month : f.month, mop: f.mop, from: f.from, to: f.to, unchecked: f.unchecked },
        }));
    } catch { /* storage full or blocked */ }
}
const monthLabel = m => m ? new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }) : "No date";
function monthHeaderHtml(m, starts, byBooklet) {
    const rows = starts.flatMap(s => byBooklet.get(s) || []);
    const sales = rows.reduce((t, r) => round2(t + (Number(r.total) || 0)), 0);
    const receipts = new Set(rows.filter(r => !r.mark).map(r => r.pr)).size;
    const collapsed = collapsedMonths.has(m);
    let verified = 0, checkedN = 0, entryN = 0;
    for (const bs of starts) {
        const st = bookletStats(entries, bs, marks);
        const pg = reviewProgress(reviewSequence(entries, marks, bs));
        checkedN += pg.checked; entryN += pg.entries;
        if (pg.done && pg.entries > 0 && st.complete) verified++;
    }
    const split = paymentSplit(rows);
    const vCls = verified === starts.length ? " all" : "";
    return `
        <tr class="month-head" data-month="${esc(m)}" title="Click to ${collapsed ? "expand" : "collapse"} ${esc(monthLabel(m))}">
            <td colspan="10">
                <div class="mh">
                    <i class="${collapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} bk-chevron"></i>
                    <strong>${esc(monthLabel(m))}</strong>
                    <span class="bk-count">${starts.length} booklet${starts.length === 1 ? "" : "s"}, ${receipts} receipt${receipts === 1 ? "" : "s"}</span>
                    <span class="mh-badge${vCls}" title="Booklets fully encoded and fully checked: ${verified} of ${starts.length}. Receipts checked: ${checkedN} of ${entryN}.">${verified === starts.length ? `<i class="ri-checkbox-circle-fill"></i> ` : ""}Verified ${verified}/${starts.length} \u00B7 Checked ${checkedN}/${entryN}</span>
                    <span class="mh-pay" title="Cash payments"><i class="ri-money-dollar-circle-line"></i> Cash <b>${peso(split.cash)}</b></span>
                    <span class="mh-pay" title="Online payments"><i class="ri-smartphone-line"></i> Online <b>${peso(split.online)}</b></span>
                    <span class="bk-total mh-total" title="Sales this month">${peso(sales)}</span>
                </div>
            </td>
        </tr>`;
}

function allBookletStarts() {
    return [...new Set([...entries, ...marks].map(x => bookletStart(x.pr)))];
}
// PR number order of the output table (booklets and the sheets inside them): lowest first, or newest/highest first.
let prSortDesc = localStorage.getItem("pre_sort_desc") === "1";
function updateSortBtn() {
    $("sortText").textContent = prSortDesc ? "PR no. high-low" : "PR no. low-high";
    $("sortBtn").querySelector("i").className = prSortDesc ? "ri-sort-desc" : "ri-sort-asc";
}
$("sortBtn").addEventListener("click", () => {
    prSortDesc = !prSortDesc;
    localStorage.setItem("pre_sort_desc", prSortDesc ? "1" : "0");
    updateSortBtn();
    refresh();
});
updateSortBtn();

$("collapseBtn").addEventListener("click", () => {
    const starts = allBookletStarts();
    const months = [...new Set(entries.map(e => String(e.date || "").slice(0, 7)))];
    const allCollapsed = starts.length > 0 && starts.every(s => collapsedBooklets.has(s)) && months.every(m => collapsedMonths.has(m));
    if (allCollapsed) { collapsedBooklets.clear(); collapsedMonths.clear(); }
    else { starts.forEach(s => collapsedBooklets.add(s)); months.forEach(m => collapsedMonths.add(m)); }
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

// "Recent PRs": the last receipts added or edited (newest first), each with a quick Edit button.
function renderRecentSection() {
    const recent = entries.filter(e => e.updatedAt).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
    $("recentCard").classList.toggle("hidden", !recent.length && !saveState.size);
    $("recentCount").textContent = String(recent.length);
    $("recentList").innerHTML = recent.map(e => {
        const st = saveState.get(e.id);
        const badge = st ? (st.state === "failed"
            ? `<span class="save-badge failed" title="Not saved to the cloud yet"><i class="ri-error-warning-fill"></i> Not saved</span>`
            : `<span class="save-badge waiting" title="Waiting for the cloud to confirm"><i class="ri-time-line"></i> Saving\u2026</span>`)
            : `<span class="save-badge ok" title="Confirmed saved in the cloud"><i class="ri-checkbox-circle-fill"></i> Saved</span>`;
        const n = versionsForPr(history, e.pr).length;
        return `
        <div class="recent-row">
            <strong class="recent-pr">PR #${esc(String(e.pr))}</strong>
            <span class="recent-buyer">${esc(e.buyer || "")}</span>
            <span class="recent-meta">${esc(mopText(e))} \u00B7 ${esc(fmtStamp(e.updatedAt))}</span>
            ${badge}
            <span class="recent-total">${peso(entryTotal(e))}</span>
            <button type="button" class="btn btn-secondary btn-sm" data-edit="${esc(e.id)}"><i class="ri-edit-line"></i> Edit</button>
            <button type="button" class="btn btn-secondary btn-sm" data-hist="${esc(String(e.pr))}" title="Version history"><i class="ri-history-line"></i>${n ? ` ${n}` : ""}</button>
        </div>`;
    }).join("");
}
// Banner: receipts the cloud has not confirmed yet, with a retry button.
function renderSaveStatus() {
    const n = saveState.size, failed = [...saveState.values()].filter(s => s.state === "failed").length;
    const bar = $("saveBar");
    bar.classList.toggle("hidden", !n);
    bar.classList.toggle("failed", failed > 0);
    $("saveBarText").textContent = failed ? `${failed} PR${failed > 1 ? "s" : ""} could not be saved to the cloud. They are kept on this device.`
        : n ? `${n} PR${n > 1 ? "s" : ""} waiting for the cloud to confirm\u2026` : "";
    $("saveRetry").classList.toggle("hidden", !failed);
    renderRecentSection();
}
$("saveRetry").addEventListener("click", retryFailedSaves);

// ---------- Version history modal ----------
let histPr = 0; // 0 = recent activity of all PRs
function openHistory(pr) {
    histPr = Number(pr) || 0;
    $("hmPr").value = histPr || "";
    renderHistory();
    $("historyModal").classList.remove("hidden");
}
function versionCard(v, older, isCurrent, canRestore) {
    const d = v.data || {};
    const lines = v.action === "deleted" ? ["Receipt deleted"] : (older && older.action === "deleted" ? ["Receipt brought back"] : older ? diffEntries(older.data, d) : [v.action === "original" ? "State before the first recorded change" : "Receipt created"]);
    const label = { added: "Added", edited: "Edited", deleted: "Deleted", restored: "Restored", original: "Original" }[v.action] || v.action;
    return `<div class="hm-ver">
        <div class="hm-head"><span class="hm-badge ${esc(v.action)}">${label}</span> <strong>PR #${esc(String(v.pr))}</strong> <span class="hm-at">${esc(fmtStamp(v.at))}</span>${isCurrent ? ' <span class="hm-cur">Current</span>' : ""}
            <span class="hm-sum">${esc(d.buyer || "")} \u00B7 ${peso(entryTotal(d))} \u00B7 ${esc(mopText(d))}</span></div>
        <ul class="hm-changes">${lines.map(l => `<li>${esc(l)}</li>`).join("") || "<li>No visible change</li>"}</ul>
        <div class="hm-actions">${canRestore ? `<button type="button" class="btn btn-secondary btn-sm" data-hm-restore="${esc(v.id)}"><i class="ri-arrow-go-back-line"></i> Restore this version</button>` : ""}
        ${histPr ? "" : `<button type="button" class="btn btn-secondary btn-sm" data-hist="${esc(String(v.pr))}"><i class="ri-history-line"></i> All versions</button>`}</div>
    </div>`;
}
function renderHistory() {
    const body = $("hmBody");
    $("hmNote").innerHTML = historyOk
        ? `Every add, edit, delete and restore, newest first. The last ${MAX_VERSIONS} versions of each PR are kept.`
        : `<b>History is not being saved.</b> Add a Firestore rule for <code>pr_encoder_history</code> (see README), then reload.`;
    $("hmTitle").textContent = histPr ? `Version history \u00B7 PR #${histPr}` : "Version history";
    if (histPr) {
        const list = versionsForPr(history, histPr);
        const cur = entries.find(e => Number(e.pr) === histPr);
        body.innerHTML = list.length
            ? list.map((v, i) => versionCard(v, list[i + 1], i === 0 && !!cur && v.action !== "deleted", true)).join("")
            : `<p class="hm-empty">No saved versions for PR #${histPr} yet. The next change you make to it will be recorded${cur ? ", together with its current state" : ""}.</p>`;
        return;
    }
    const del = deletedPrs(history, entries);
    const recent = [...history].sort((a, b) => b.at - a.at).slice(0, 40);
    body.innerHTML = (del.length ? `<h3 class="hm-h">Deleted PRs (restorable)</h3>${del.map(v => versionCard(v, null, false, false).replace('<div class="hm-actions">', `<div class="hm-actions"><button type="button" class="btn btn-primary btn-sm" data-hm-undelete="${esc(String(v.pr))}"><i class="ri-arrow-go-back-line"></i> Restore PR #${esc(String(v.pr))}</button>`)).join("")}` : "")
        + `<h3 class="hm-h">Recent activity</h3>`
        + (recent.length ? recent.map(v => versionCard(v, null, false, false).replace(/<ul class="hm-changes">.*?<\/ul>/s, "")).join("") : `<p class="hm-empty">Nothing recorded yet. Versions are saved from now on, each time a PR is added, edited or deleted.</p>`);
}
function restoreVersion(v) {
    const d = v.data;
    if (!d) return;
    const entry = { ...d, id: `pr_${v.pr}`, pr: Number(v.pr), updatedAt: Date.now() };
    persist(entry, undefined, "restored");
    toast(`PR #${v.pr} restored to the version from ${fmtStamp(v.at)}. Verify it again if needed.`);
}
document.addEventListener("click", ev => {
    const h = ev.target.closest("[data-hist]");
    if (h) { openHistory(h.dataset.hist); return; }
    const ed = ev.target.closest("#recentList [data-edit]");
    if (ed) startEdit(ed.dataset.edit);
});
$("recentHistoryBtn").addEventListener("click", () => openHistory(0));
$("hmClose").addEventListener("click", () => $("historyModal").classList.add("hidden"));
$("historyModal").addEventListener("mousedown", ev => { if (ev.target === $("historyModal")) $("historyModal").classList.add("hidden"); });
document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !$("historyModal").classList.contains("hidden")) { ev.stopImmediatePropagation(); $("historyModal").classList.add("hidden"); }
}, true);
$("hmGo").addEventListener("click", () => { const n = Number($("hmPr").value); openHistory(n > 0 ? n : 0); });
$("hmPr").addEventListener("keydown", ev => { if (ev.key === "Enter") { ev.preventDefault(); $("hmGo").click(); } });
$("hmBody").addEventListener("click", async ev => {
    const r = ev.target.closest("[data-hm-restore]"), u = ev.target.closest("[data-hm-undelete]");
    if (r) {
        const v = history.find(x => x.id === r.dataset.hmRestore);
        if (!v) return;
        const exists = entries.some(e => Number(e.pr) === Number(v.pr));
        if (!(await askConfirm({ title: `Restore PR #${v.pr}?`, message: `Go back to the version from ${fmtStamp(v.at)}.${exists ? " The current version is kept in the history." : ""}`, ok: "Restore" }))) return;
        restoreVersion(v);
    } else if (u) {
        const del = versionsForPr(history, u.dataset.hmUndelete)[0];
        if (!del || !del.data) return;
        if (!(await askConfirm({ title: `Restore deleted PR #${del.pr}?`, message: "The receipt comes back as it was when it was deleted.", ok: "Restore" }))) return;
        restoreVersion(del);
    }
});
$("hmBackup").addEventListener("click", () => {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    const save = (name, text, type) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type }));
        a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    save(`GLC-PR-backup-${stamp}.json`, JSON.stringify({ app: "glc-pr-encoder", exportedAt: new Date().toISOString(), entries, marks, history }, null, 2), "application/json");
    save(`GLC-PR-backup-${stamp}.csv`, toCSV(flatten(entries)), "text/csv");
    toast(`Backup downloaded: ${entries.length} PRs, ${history.length} saved versions.`);
});

// "Continue verifying" section: booklets whose review was started (some PRs checked) but is not finished.
function renderContinueSection() {
    const starts = allBookletStarts().sort((x, y) => prSortDesc ? y - x : x - y);
    const cards = [];
    starts.forEach(s => {
        const seq = reviewSequence(entries, marks, s);
        const prog = reviewProgress(seq);
        if (!(prog.entries > 0 && prog.checked > 0 && !prog.done)) return;
        const next = seq.find(x => !x.resolved);
        const rows = flatten(entries.filter(e => bookletStart(e.pr) === s));
        const sales = rows.length ? rows[rows.length - 1].grand : 0;
        const split = paymentSplit(rows);
        const pct = Math.round((prog.checked / prog.entries) * 100);
        cards.push(`
        <div class="vb-card cont" data-cont="${s}">
            <div class="vb-main">
                <strong>Booklet ${esc(bookletLabel(s))}</strong>
                <span class="bk-badge partial">Checked ${prog.checked}/${prog.entries}</span>
                ${verifyTime(s, true)}
                <span class="cont-bar" title="${pct}% checked"><span style="width:${pct}%"></span></span>
                <span class="bk-count">${next ? `next: PR ${esc(String(next.pr))}` : ""}${prog.lastAt ? `, last checked ${esc(fmtStamp(prog.lastAt))}` : ""}${prog.missing ? `, ${prog.missing} missing` : ""}</span>
            </div>
            <div class="vb-side">
                <span class="vb-money">Cash <b>${peso(split.cash)}</b> \u00B7 Online <b>${peso(split.online)}</b></span>
                <span class="bk-total">${peso(sales)}</span>
                <button type="button" class="btn btn-primary btn-sm" data-cont-open="${s}"><i class="ri-play-circle-line"></i> Continue review</button>
            </div>
        </div>`);
    });
    $("continueCount").textContent = String(cards.length);
    $("continueCard").classList.toggle("hidden", !cards.length);
    $("continueList").innerHTML = cards.join("");
}
$("continueList").addEventListener("click", ev => {
    const b = ev.target.closest("[data-cont-open], [data-cont]");
    if (!b) return;
    openReview(Number(b.dataset.contOpen || b.dataset.cont)); // resumes at the first PR not checked yet
});

// "Verified booklets" section: every booklet whose PRs are all checked. "View summary" opens its summary directly (no review needed).
// Time spent verifying a booklet (active time: pauses over 5 minutes are not counted). Empty when nothing is checked yet.
function verifyTime(start, partial = false) {
    const v = bookletVerification(entries, start);
    if (v.checks < 2) return "";
    const tip = `Active checking time. Pauses over 5 minutes are not counted. First check to last check: ${formatDuration(v.spanMs)}.${v.approx ? " Approximate: long pauses or very few checks." : ""}`;
    return `<span class="bk-time" title="${esc(tip)}"><i class="ri-timer-line"></i> ${partial ? "so far " : ""}${esc(formatDuration(v.ms))}${v.approx ? " approx." : ""}</span>`;
}
function renderVerifiedSection() {
    const list = $("verifiedList");
    const starts = allBookletStarts().sort((x, y) => prSortDesc ? y - x : x - y);
    const cards = [];
    starts.forEach(s => {
        const prog = reviewProgress(reviewSequence(entries, marks, s));
        if (!(prog.done && prog.entries > 0)) return;
        const st = bookletStats(entries, s, marks);
        const rows = flatten(entries.filter(e => bookletStart(e.pr) === s));
        const sales = rows.length ? rows[rows.length - 1].grand : 0;
        const split = paymentSplit(rows);
        cards.push(`
        <div class="vb-card" data-vb="${s}">
            <div class="vb-main">
                <strong>Booklet ${esc(bookletLabel(s))}</strong>
                <span class="bk-badge verified"><i class="ri-checkbox-circle-fill"></i> ${st.complete ? "Verified" : "All checked"}</span>
                ${cashBadgeHtml(s)}
                ${verifyTime(s)}
                <span class="bk-count">${prog.entries} receipts${prog.marks ? `, ${prog.marks} void/not used` : ""}${prog.lastAt ? `, checked ${esc(fmtStamp(prog.lastAt))}` : ""}</span>
            </div>
            <div class="vb-side">
                <span class="vb-money">Cash <b>${peso(split.cash)}</b> \u00B7 Online <b>${peso(split.online)}</b></span>
                <span class="bk-total">${peso(sales)}</span>
                <button type="button" class="btn btn-primary btn-sm" data-vb-open="${s}"><i class="ri-file-list-3-line"></i> View summary</button>
            </div>
        </div>`);
    });
    $("verifiedCount").textContent = String(cards.length);
    $("verifiedCard").classList.toggle("hidden", !cards.length);
    list.innerHTML = cards.join("");
}
$("verifiedList").addEventListener("click", ev => {
    const b = ev.target.closest("[data-vb-open], [data-vb]");
    if (!b) return;
    openSummaryView(Number(b.dataset.vbOpen || b.dataset.vb));
});

// Summary at the bottom of the output: one row per booklet and the grand totals (follows the current filter).
function renderBookletSummary(rows) {
    const box = $("bkSummary");
    const byBook = new Map();
    rows.forEach(r => { const b = bookletStart(r.pr); if (!byBook.has(b)) byBook.set(b, []); byBook.get(b).push(r); });
    if (!byBook.size) { box.innerHTML = ""; return; }
    let cash = 0, online = 0, receipts = 0;
    // Same month grouping as the table above (a booklet belongs to the month of its latest receipt).
    const bookletMonth = new Map();
    entries.forEach(x => {
        const b = bookletStart(x.pr), m = String(x.date || "").slice(0, 7);
        if (m && (!bookletMonth.has(b) || m > bookletMonth.get(b))) bookletMonth.set(b, m);
    });
    const byMonth = new Map();
    [...byBook.keys()].sort((x, y) => prSortDesc ? y - x : x - y).forEach(b => {
        const m = bookletMonth.get(b) || "";
        if (!byMonth.has(m)) byMonth.set(m, []);
        byMonth.get(m).push(b);
    });
    const mKeys = [...byMonth.keys()].sort((x, y) => (x === "") - (y === "") || (prSortDesc ? y.localeCompare(x) : x.localeCompare(y)));
    const body = mKeys.map(m => {
        const starts = byMonth.get(m);
        let mCash = 0, mOnline = 0, mReceipts = 0;
        const bookletRows = starts.map(start => {
            const rs = byBook.get(start);
            const split = paymentSplit(rs);
            const count = new Set(rs.map(r => r.pr)).size;
            mCash = round2(mCash + split.cash); mOnline = round2(mOnline + split.online); mReceipts += count;
            return `<tr data-summary-booklet="${start}" title="Click to show this booklet in the table">
            <td><b>${esc(bookletLabel(start))}</b></td>
            <td class="num">${count} / ${BOOKLET_SIZE}</td>
            <td>${reviewBadgeHtml(start) || "-"}</td>
            <td>${cashBadgeHtml(start)}</td>
            <td class="num">${money(split.cash)}</td>
            <td class="num">${money(split.online)}</td>
            <td class="num"><b>${money(round2(split.cash + split.online))}</b></td></tr>`;
        });
        cash = round2(cash + mCash); online = round2(online + mOnline); receipts += mReceipts;
        const collapsed = collapsedMonths.has(m);
        return `<tr class="sum-month" data-sum-month="${esc(m)}" title="Click to ${collapsed ? "expand" : "collapse"} ${esc(monthLabel(m))}">
            <td><i class="${collapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"}"></i> <b>${esc(monthLabel(m))}</b> <span class="bk-count">${starts.length} booklet${starts.length === 1 ? "" : "s"}</span></td>
            <td class="num">${mReceipts}</td><td></td><td></td>
            <td class="num">${money(mCash)}</td><td class="num">${money(mOnline)}</td>
            <td class="num"><b>${money(round2(mCash + mOnline))}</b></td></tr>` + (collapsed ? "" : bookletRows.join(""));
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
    const mrow = ev.target.closest("[data-sum-month]");
    if (mrow) {
        const m = mrow.dataset.sumMonth;
        if (collapsedMonths.has(m)) collapsedMonths.delete(m); else collapsedMonths.add(m);
        refresh();
        return;
    }
    const tr = ev.target.closest("[data-summary-booklet]");
    if (!tr) return;
    const sel = $("bookletFilter");
    sel.value = tr.dataset.summaryBooklet;
    sel.dispatchEvent(new Event("input"));
    $("outputCard").scrollIntoView({ behavior: "smooth", block: "start" });
});

// ---------- Cards view: month tabs + one card per booklet with its 50 PR squares ----------
function applyViewClasses() {
    const cards = viewMode === "cards";
    $("cardsView").classList.toggle("hidden", !cards);
    $("tableWrap").classList.toggle("hidden", cards);
    $("collapseBtn").classList.toggle("hidden", cards);
    $("viewTable").className = "btn " + (cards ? "btn-secondary" : "btn-primary");
    $("viewCards").className = "btn " + (cards ? "btn-primary" : "btn-secondary");
}
function setView(mode) {
    viewMode = mode;
    localStorage.setItem("pre_view", mode);
    applyViewClasses();
    refresh();
}
$("viewTable").addEventListener("click", () => setView("table"));
$("viewCards").addEventListener("click", () => setView("cards"));
applyViewClasses();

function bookletMonthOf(start) {
    let m = "";
    entries.forEach(e => { if (bookletStart(e.pr) === start) { const x = String(e.date || "").slice(0, 7); if (x > m) m = x; } });
    return m;
}

function prStripHtml(start) {
    const byPr = new Map(entries.filter(e => bookletStart(e.pr) === start).map(e => [Number(e.pr), e]));
    const markBy = new Map(marks.filter(m => bookletStart(m.pr) === start).map(m => [Number(m.pr), m]));
    const nums = [...byPr.keys(), ...markBy.keys()];
    const highest = nums.length ? Math.max(...nums) : start - 1;
    let out = "";
    for (let n = start; n < start + BOOKLET_SIZE; n++) {
        let cls, tip;
        if (byPr.has(n)) {
            const e = byPr.get(n);
            cls = e.checkedAt ? "ok" : "enc";
            tip = `PR #${n} - ${e.checkedAt ? "checked" : "encoded, not checked yet"} - ${peso(entryTotal(e))}`;
        } else if (markBy.has(n)) {
            const st = markBy.get(n).status;
            cls = st === "void" ? "void" : "unused";
            tip = `PR #${n} - ${markLabel(st)}`;
        } else if (n < highest) { cls = "miss"; tip = `PR #${n} - missing (not encoded, not marked)`; }
        else { cls = "future"; tip = `PR #${n} - not used yet`; }
        out += `<button type="button" class="sq ${cls}" data-sq="${n}" data-start="${start}" title="${esc(tip)}" aria-label="${esc(tip)}"></button>`;
    }
    return out;
}

function bookletCardHtml(start, rows) {
    const st = bookletStats(entries, start, marks);
    const prog = reviewProgress(reviewSequence(entries, marks, start));
    const reviewedAll = prog.done && prog.entries > 0;
    const allChecked = reviewedAll && st.complete;
    const bkLocked = locks.includes(start);
    const sales = rows.reduce((t, r) => round2(t + (Number(r.total) || 0)), 0);
    const split = paymentSplit(rows);
    const actions = `<button type="button" class="btn btn-secondary" data-review="${start}"${reviewedAll ? ' data-first="1"' : ""}><i class="${reviewedAll ? "ri-restart-line" : "ri-checkbox-circle-line"}"></i> ${reviewedAll ? "Review again" : "Review"}</button>` +
        (bkLocked
            ? `<button type="button" class="btn btn-icon-only btn-locked" data-lock="${start}" title="Locked. Click to unlock." aria-label="Unlock booklet"><i class="ri-lock-fill"></i></button>`
            : `<button type="button" class="btn btn-secondary btn-icon-only" data-bkmenu="${start}" data-canmark="${!reviewedAll && prog.unchecked > 0 ? 1 : 0}" title="More actions" aria-haspopup="menu" aria-label="More actions"><i class="ri-more-2-fill"></i></button>`);
    const missing = st.missing.length ? `<span class="bk-missing" title="Missing sheets: ${esc(st.missing.join(", "))}"><i class="ri-error-warning-line"></i> Missing ${st.missing.length}</span>` : "";
    return `
        <div class="cv-card${bkLocked ? " locked" : ""}${allChecked ? " verified" : ""}" data-start="${start}">
            <div class="cv-top">
                <strong>${bkLocked ? `<i class="ri-lock-fill"></i> ` : ""}Booklet ${esc(bookletLabel(start))}</strong>
                <span class="bk-count">${st.used} / ${BOOKLET_SIZE} sheets</span>
                <button type="button" class="btn btn-secondary btn-sm cv-open" data-open="${start}" title="Show this booklet's receipts in the table"><i class="ri-table-line"></i> Rows</button>
            </div>
            <div class="sq-strip">${prStripHtml(start)}</div>
            <div class="cv-meta">
                <span class="bk-badge ${allChecked ? "verified" : st.complete ? "done" : ""}">${allChecked ? `<i class="ri-checkbox-circle-fill"></i> ` : ""}Checked ${prog.checked}/${prog.entries}</span>
                ${cashBadgeHtml(start)}
                ${missing}
            </div>
            <div class="cv-pay">
                <span class="pay cash"><i class="ri-money-dollar-circle-line"></i> Cash <b>${peso(split.cash)}</b></span>
                <span class="pay online"><i class="ri-smartphone-line"></i> Online <b>${peso(split.online)}</b></span>
                <span class="bk-total">${peso(sales)}</span>
            </div>
            <div class="cv-actions">${actions}</div>
        </div>`;
}

function renderCards(monthKeys, monthMap, byBooklet) {
    const box = $("cardsView");
    if (viewMode !== "cards") { box.innerHTML = ""; return; }
    if (!monthKeys.length) { box.innerHTML = `<div class="empty-msg">${entries.length ? "No receipts match the filter." : "No receipts encoded yet."}</div>`; return; }
    if (!monthKeys.includes(cardMonth)) cardMonth = [...monthKeys].filter(Boolean).sort().pop() || monthKeys[0];
    const tabs = monthKeys.map(m => {
        const starts = monthMap.get(m);
        let verified = 0;
        for (const bs of starts) {
            const st = bookletStats(entries, bs, marks);
            const pg = reviewProgress(reviewSequence(entries, marks, bs));
            if (pg.done && pg.entries > 0 && st.complete) verified++;
        }
        const sales = starts.flatMap(bs => byBooklet.get(bs) || []).reduce((t, r) => round2(t + (Number(r.total) || 0)), 0);
        return `<button type="button" class="cv-tab${m === cardMonth ? " active" : ""}${verified === starts.length ? " all" : ""}" data-cmonth="${esc(m)}">
            <strong>${esc(monthLabel(m))}</strong>
            <span>${verified === starts.length ? "&#10003; " : ""}${verified}/${starts.length} verified</span>
            <span>${peso(sales)}</span></button>`;
    }).join("");
    const legend = `<div class="sq-legend"><span><i class="sq ok"></i> Checked</span><span><i class="sq enc"></i> Encoded</span><span><i class="sq void"></i> Void</span><span><i class="sq unused"></i> Not used</span><span><i class="sq miss"></i> Missing</span><span><i class="sq future"></i> Not yet</span></div>`;
    box.innerHTML = `<div class="cv-tabs">${tabs}</div>${legend}<div class="cv-grid">${(monthMap.get(cardMonth) || []).map(bs => bookletCardHtml(bs, byBooklet.get(bs) || [])).join("")}</div>`;
}

// Jump from a card (or one PR square, or "Go to PR") to the matching rows in the table view.
// If a filter hides them, the filters are cleared first.
function openRows(start, pr) {
    const open = () => { collapsedMonths.delete(bookletMonthOf(start)); collapsedBooklets.delete(start); };
    open();
    setView("table");
    const find = () => ({
        row: pr ? document.querySelector(`[data-edit="pr_${pr}"], [data-unmark="${pr}"]`)?.closest("tr") : null,
        head: document.querySelector(`tr.booklet-head[data-booklet="${start}"]`),
    });
    let { row, head } = find();
    if (!row && !head) { // hidden by a filter
        $("clearFilterBtn").click();
        open(); refresh();
        ({ row, head } = find());
        if (row || head) toast("Filters cleared to show it.");
    }
    const el = row || head;
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    if (row) { row.classList.add("row-flash"); setTimeout(() => row.classList.remove("row-flash"), 2500); }
}

// "Go to PR #": open the month and booklet that hold this PR number and flash its row.
function goToPr(raw) {
    const pr = Number(String(raw).replace(/\D/g, ""));
    if (!(pr > 0)) return toast("Type a PR number, for example 42710.");
    const start = bookletStart(pr);
    const hasEntry = entries.some(e => Number(e.pr) === pr);
    const hasMark = marks.some(m => Number(m.pr) === pr);
    const bookletExists = hasEntry || hasMark || entries.some(e => bookletStart(e.pr) === start) || marks.some(m => bookletStart(m.pr) === start);
    if (!bookletExists) return toast(`PR #${pr} is not in any booklet yet.`);
    openRows(start, hasEntry || hasMark ? pr : null);
    if (!hasEntry && !hasMark) toast(`PR #${pr} has no receipt or mark yet. Booklet ${bookletLabel(start)} is open.`);
}
$("gotoForm").addEventListener("submit", ev => { ev.preventDefault(); goToPr($("gotoPr").value); $("gotoPr").select(); });
$("cardsView").addEventListener("click", ev => {
    const t = ev.target.closest("[data-cmonth], [data-review], [data-bkmenu], [data-lock], [data-open], [data-sq]");
    if (!t) return;
    if (t.dataset.cmonth !== undefined) { cardMonth = t.dataset.cmonth; refresh(); }
    else if (t.dataset.review) openReview(Number(t.dataset.review), t.dataset.first === "1");
    else if (t.dataset.bkmenu) openBkMenu(t);
    else if (t.dataset.lock) toggleLock(Number(t.dataset.lock));
    else if (t.dataset.open) openRows(Number(t.dataset.open));
    else if (t.dataset.sq) openRows(Number(t.dataset.start), Number(t.dataset.sq));
});

// "..." menu on a booklet header: less common actions, so Review stays the one obvious button.
let bkMenuEl = null;
function closeBkMenu() { if (bkMenuEl) { bkMenuEl.remove(); bkMenuEl = null; } }
function openBkMenu(btn) {
    const start = Number(btn.dataset.bkmenu);
    const wasOpen = bkMenuEl && bkMenuEl.dataset.start === String(start);
    closeBkMenu();
    if (wasOpen) return;
    const m = document.createElement("div");
    m.className = "bk-menu no-print";
    m.setAttribute("role", "menu");
    m.dataset.start = String(start);
    m.innerHTML = (btn.dataset.canmark === "1" ? `<button type="button" role="menuitem" data-act="mark"><i class="ri-check-double-line"></i> Mark reviewed<small>Already checked and cash counted</small></button>` : "") +
        `<button type="button" role="menuitem" data-act="lock"><i class="ri-lock-line"></i> Lock booklet<small>Nothing can be changed</small></button>`;
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    const h = m.offsetHeight, w = m.offsetWidth;
    m.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)) + "px";
    m.style.top = (r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + "px";
    m.addEventListener("click", ev => {
        const x = ev.target.closest("button[data-act]");
        if (!x) return;
        closeBkMenu();
        if (x.dataset.act === "mark") markBookletReviewed(start);
        else if (x.dataset.act === "lock") toggleLock(start);
    });
    bkMenuEl = m;
    m.querySelector("button").focus({ preventScroll: true });
}
document.addEventListener("mousedown", ev => { if (bkMenuEl && !ev.target.closest(".bk-menu, [data-bkmenu]")) closeBkMenu(); });
document.addEventListener("keydown", ev => { if (ev.key === "Escape" && bkMenuEl) { ev.stopPropagation(); closeBkMenu(); } }, true);
window.addEventListener("resize", closeBkMenu);
window.addEventListener("scroll", closeBkMenu, true);

// Write many entry docs in batches of 400.
async function commitEntrySets(list) {
    try {
        for (let i = 0; i < list.length; i += 400) {
            const batch = writeBatch(db);
            list.slice(i, i + 400).forEach(({ id, ...data }) => batch.set(doc(col, id), data));
            await batch.commit();
        }
    } catch (e) { remoteFail(e); }
}

// For booklets that were already checked against the paper (and cash counted) outside the app:
// tick every receipt as checked in one go, after two confirmations. Undo restores the previous state.
async function markBookletReviewed(start) {
    if (isLocked(start)) return lockedToast();
    const list = entries.filter(e => bookletStart(e.pr) === start && !e.checkedAt);
    if (!list.length) return toast("Every receipt in this booklet is already checked.");
    const label = bookletLabel(start);
    const missing = reviewProgress(reviewSequence(entries, marks, start)).missing;
    const n = list.length, rec = `${n} receipt${n === 1 ? "" : "s"}`;
    if (!(await askConfirm({
        title: `Mark booklet ${label} as fully reviewed?`,
        message: `${rec} will be ticked as checked without going through them one by one. Only do this if the booklet was already checked against the paper sheets and the cash was counted.` +
            (missing ? `\n\nNote: ${missing} PR number${missing === 1 ? " is" : "s are"} still missing (mark them Void or Not used to finish the review).` : ""),
        ok: "Continue" }))) return;
    if (!(await askConfirm({
        title: "Final check",
        message: `Complete the review of booklet ${label}?\n\nThis marks ${rec} as checked now. You can press Undo for a few seconds, or use "Review again" later.`,
        ok: "Complete the review" }))) return;
    if (isLocked(start)) return lockedToast();
    const now = Date.now();
    const ids = new Set(list.map(e => e.id));
    entries = entries.map(e => ids.has(e.id) ? { ...e, checkedAt: now } : e);
    saveLocal();
    refresh();
    commitEntrySets(entries.filter(e => ids.has(e.id)));
    toast(`Booklet ${label}: ${list.length} receipt${list.length === 1 ? "" : "s"} marked reviewed.`, () => {
        entries = entries.map(e => ids.has(e.id) ? list.find(o => o.id === e.id) : e);
        saveLocal();
        refresh();
        commitEntrySets(list);
        toast(`Booklet ${label}: review undone.`);
    });
}

function bookletHeaderHtml(start, rowsInBooklet) {
    const st = bookletStats(entries, start, marks);
    const prog = reviewProgress(reviewSequence(entries, marks, start));
    const cashBadge = cashBadgeHtml(start);
    // One progress badge instead of a bar + "All encoded" + "Checked x/y".
    const reviewedAll = prog.done && prog.entries > 0; // every receipt checked: the button becomes "Review again"
    const allChecked = reviewedAll && st.complete;
    const progCls = allChecked ? "verified" : st.complete ? "done" : "";
    const progBadge = `<span class="bk-badge ${progCls}" title="Encoded ${st.used} of ${BOOKLET_SIZE} sheets. Checked ${prog.checked} of ${prog.entries} receipts against the paper.">${allChecked ? `<i class="ri-checkbox-circle-fill"></i> ` : ""}Encoded ${st.used}/${BOOKLET_SIZE} \u00B7 Checked ${prog.checked}/${prog.entries}</span>`;
    const bkLocked = locks.includes(start);
    const collapsed = collapsedBooklets.has(start);
    const sales = rowsInBooklet.reduce((s, r) => round2(s + r.total), 0);
    const split = paymentSplit(rowsInBooklet);
    const chanTip = !SHOW_CHANNEL_TOTALS ? "" : Object.entries(split.byChannel).filter(([c]) => c).map(([c, v]) => `   ${c}: ${peso(v)}`).join("\n");
    const onlineTip = (Object.entries(split.byMethod).filter(([m]) => m !== "Cash")
        .map(([m, v]) => `${m}: ${peso(v)}`).join("\n") || "No online payments") + (chanTip ? "\n" + chanTip : "");
    const shownMissing = st.missing.slice(0, 8).join(", ") + (st.missing.length > 8 ? `, +${st.missing.length - 8} more` : "");
    const missing = st.missing.length
        ? `<span class="bk-missing" title="Missing sheets: ${esc(st.missing.join(", "))}"><i class="ri-error-warning-line"></i> Missing ${st.missing.length}: ${esc(shownMissing)}</span>`
        : "";
    return `
        <tr class="booklet-head${selectedBooklets.has(start) ? " bk-selected" : ""}${locks.includes(start) ? " bk-locked" : ""}" data-booklet="${start}" title="Click to ${collapsed ? "expand" : "collapse"}">
            <td colspan="10">
                <div class="bk bk2">
                    <div class="bk-r1">
                        <label class="bk-sel no-print" title="Select this booklet"><input type="checkbox" data-bk-select="${start}" aria-label="Select booklet ${esc(bookletLabel(start))}" ${selectedBooklets.has(start) ? "checked" : ""}></label>
                        <i class="${collapsed ? "ri-arrow-right-s-line" : "ri-arrow-down-s-line"} bk-chevron"></i>
                        <strong>Booklet ${esc(bookletLabel(start))}</strong>
                        <span class="bk-count">${st.used} / ${BOOKLET_SIZE} sheets</span>
                    </div>
                    <div class="bk-r2">
                        ${progBadge}
                        ${cashBadge}
                        ${missing}
                        <span class="bk-pay">
                            <span class="pay cash" title="Cash payments"><i class="ri-money-dollar-circle-line"></i> Cash <b>${peso(split.cash)}</b></span>
                            <span class="pay online" title="${esc(onlineTip)}"><i class="ri-smartphone-line"></i> Online <b>${peso(split.online)}</b></span>
                        </span>
                        <span class="bk-total" title="Booklet total">${peso(sales)}</span>
                    </div>
                    <span class="bk-actions">
                        <button type="button" class="btn btn-secondary" data-review="${start}"${reviewedAll ? ' data-first="1"' : ""} title="${reviewedAll ? "Everything is checked. Go through the PRs again from the first one." : "Check each PR in this booklet against the paper sheets"}"><i class="${reviewedAll ? "ri-restart-line" : "ri-checkbox-circle-line"}"></i> ${reviewedAll ? "Review again" : "Review"}</button>
                        ${bkLocked
                            ? `<button type="button" class="btn btn-icon-only btn-locked" data-lock="${start}" title="Locked: nothing in this booklet can be changed. Click to unlock." aria-label="Unlock booklet"><i class="ri-lock-fill"></i></button>`
                            : `<button type="button" class="btn btn-secondary btn-icon-only" data-bkmenu="${start}" data-canmark="${!reviewedAll && prog.unchecked > 0 ? 1 : 0}" title="More actions" aria-haspopup="menu" aria-label="More actions"><i class="ri-more-2-fill"></i></button>`}
                    </span>
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
    const noFilter = !(f.q.trim() || f.from || f.to || f.unchecked);
    const items = (noFilter ? withMarks(rows, marks, f) : rows).slice();
    if (prSortDesc) items.sort((x, y) => Number(y.pr) - Number(x.pr)); // stable: item rows of one PR keep their order
    // Group: month -> booklets -> rows. A booklet belongs to the month of its latest receipt.
    const bookletMonth = new Map();
    entries.forEach(e => {
        const b = bookletStart(e.pr), m = String(e.date || "").slice(0, 7);
        if (m && (!bookletMonth.has(b) || m > bookletMonth.get(b))) bookletMonth.set(b, m);
    });
    // Months start collapsed except the latest one: applied once, when the first data shows up.
    if (!monthsDefaulted && bookletMonth.size) {
        const keys = [...new Set(bookletMonth.values())].sort();
        keys.slice(0, -1).forEach(m => collapsedMonths.add(m));
        monthsDefaulted = true;
    }
    const itemsByBooklet = new Map();
    items.forEach(r => { const b = bookletStart(r.pr); if (!itemsByBooklet.has(b)) itemsByBooklet.set(b, []); itemsByBooklet.get(b).push(r); });
    const monthMap = new Map();
    for (const b of itemsByBooklet.keys()) { const m = bookletMonth.get(b) || ""; if (!monthMap.has(m)) monthMap.set(m, []); monthMap.get(m).push(b); }
    const monthKeys = [...monthMap.keys()].sort((x, y) => (x === "") - (y === "") || (prSortDesc ? y.localeCompare(x) : x.localeCompare(y)));
    renderedStarts = [...itemsByBooklet.keys()];
    let html = "";
    for (const m of (viewMode === "table" ? monthKeys : [])) {
        const starts = monthMap.get(m);
        html += monthHeaderHtml(m, starts, byBooklet);
        if (collapsedMonths.has(m)) continue;
        for (const b of starts) {
            html += bookletHeaderHtml(b, byBooklet.get(b) || []);
            if (collapsedBooklets.has(b)) continue;
            for (const r of itemsByBooklet.get(b)) html += r.mark ? markRowHtml(r) : rowHtml(r);
        }
    }
    body.innerHTML = html;
    renderCards(monthKeys, monthMap, byBooklet);
    const starts = allBookletStarts();
    const allCollapsed = starts.length > 0 && starts.every(s => collapsedBooklets.has(s)) && monthKeys.every(m => collapsedMonths.has(m));
    $("collapseText").textContent = allCollapsed ? "Expand all" : "Collapse all";
    $("collapseBtn").querySelector("i").className = allCollapsed ? "ri-expand-up-down-line" : "ri-contract-up-down-line";
    renderRecentSection();
    renderContinueSection();
    renderVerifiedSection();
    pruneBookletSelection();
    renderBookletSummary(flatten(filterEntries(entries, { ...f, booklet: "" }))); // all booklets, even while one is selected below
    afterRowsRendered(rows, shown, f);
    saveViewState();
}

function mopCellHtml(r) {
    const p = r.entry.payments;
    if (Array.isArray(p) && p.length) return `<span class="split-tag">SPLIT</span><br>` + p.map(x => esc(paymentText(x))).join("<br>");
    return esc(r.mop);
}

function markRowHtml(r) {
    const note = r.status === "void" ? "Cancelled sheet, no sale" : "Blank or skipped sheet";
    return `
        <tr class="mark-row ${esc(r.status)} pr-first${isLocked(r.pr) ? " row-locked" : ""}">
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
        <tr class="${r.first ? "pr-first" : ""}${isLocked(r.pr) ? " row-locked" : ""}">
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
                <button class="btn btn-secondary btn-icon-only" data-hist="${esc(String(r.entry.pr))}" title="Version history"><i class="ri-history-line"></i></button>
                <button class="btn btn-danger btn-icon-only" data-del="${esc(r.entry.id)}" title="Delete"><i class="ri-delete-bin-line"></i></button>
            </div>` : ""}</td>
        </tr>`;
}

function updateBookletOptions() {
    const sel = $("bookletFilter");
    const prev = pendingSel ? pendingSel.booklet : sel.value;
    const starts = bookletStarts(entries);
    sel.innerHTML = `<option value="">All booklets</option>` +
        starts.map(s => `<option value="${s}">Booklet ${esc(bookletLabel(s))}</option>`).join("");
    sel.value = starts.includes(Number(prev)) ? prev : "";
    const ms = $("monthFilter");
    const pm = pendingSel ? pendingSel.month : ms.value;
    const months = [...new Set(entries.map(e => String(e.date || "").slice(0, 7)).filter(x => /^\d{4}-\d{2}$/.test(x)))].sort().reverse();
    ms.innerHTML = `<option value="">All months</option>` + months.map(m => {
        const [y, mo] = m.split("-").map(Number);
        return `<option value="${m}">${new Date(y, mo - 1, 1).toLocaleString("en", { month: "long", year: "numeric" })}</option>`;
    }).join("");
    ms.value = months.includes(pm) ? pm : "";
    if (pendingSel && entries.length) pendingSel = null;
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
    $("valSub").textContent = `${shown.length} receipt${shown.length === 1 ? "" : "s"}` + (f.q.trim() || f.from || f.to || f.booklet || f.unchecked || f.mop || f.month ? " (filtered)" : "");
    const active = !!(f.q.trim() || f.from || f.to || f.booklet || f.unchecked || f.mop || f.month);
    const info = $("filterInfo");
    info.classList.toggle("hidden", !active);
    if (active) info.textContent = `${shown.length} of ${entries.length} receipts match - ${peso(total)}`;
    $("clearFilterBtn").classList.toggle("btn-active", active);
    $("searchClear").classList.toggle("hidden", !$("searchInput").value);
    const range = f.from || f.to ? `${f.from ? fmtDate(f.from) : "start"} to ${f.to ? fmtDate(f.to) : "latest"}` : "All dates";
    const bk = f.booklet ? `Booklet ${bookletLabel(Number(f.booklet))} - ` : "";
    $("printTitle").textContent = `PR Summary - ${bk}${range} - Total ${peso(total)}`;
    updatePrWarning();
    updateBookletHint();
}

// ---------- Select booklets / delete whole booklets ----------
const selectedBooklets = new Set();
function shownBookletStarts() { return renderedStarts.slice(); }
function pruneBookletSelection() {
    const have = new Set(allBookletStarts());
    [...selectedBooklets].forEach(s => { if (!have.has(s)) selectedBooklets.delete(s); });
    updateSelBar();
}
function bookletReceiptCount(s) { return entries.filter(e => bookletStart(e.pr) === s).length; }
function updateSelBar() {
    const n = selectedBooklets.size;
    $("selBar").classList.toggle("hidden", n === 0);
    const receipts = [...selectedBooklets].reduce((t, s) => t + bookletReceiptCount(s), 0);
    $("selInfo").textContent = `${n} booklet${n === 1 ? "" : "s"} selected (${receipts} receipt${receipts === 1 ? "" : "s"})`;
    const shown = shownBookletStarts();
    const allSel = shown.length > 0 && shown.every(s => selectedBooklets.has(s));
    $("selectAllText").textContent = allSel ? "Unselect all" : "Select all";
}
$("selectAllBtn").addEventListener("click", () => {
    const shown = shownBookletStarts();
    const allSel = shown.length > 0 && shown.every(s => selectedBooklets.has(s));
    if (allSel) shown.forEach(s => selectedBooklets.delete(s)); else shown.forEach(s => selectedBooklets.add(s));
    refresh();
});
$("selClear").addEventListener("click", () => { selectedBooklets.clear(); refresh(); });
async function commitDeletes(refs) {
    for (let i = 0; i < refs.length; i += 400) {
        const batch = writeBatch(db);
        refs.slice(i, i + 400).forEach(r => batch.delete(r));
        await batch.commit();
    }
}
$("selDelete").addEventListener("click", async () => {
    const starts = [...selectedBooklets].sort((x, y) => x - y);
    if (!starts.length) return;
    const lockedOnes = starts.filter(s => locks.includes(s));
    if (lockedOnes.length) return toast(`Booklet ${lockedOnes.map(s => bookletLabel(s)).join(", ")} is locked. Unlock it first, or unselect it.`);
    const inB = s => x => bookletStart(Number(x.pr)) === s;
    const ents = starts.flatMap(s => entries.filter(inB(s)));
    const mks = starts.flatMap(s => marks.filter(inB(s)));
    const list = starts.map(s => `  Booklet ${bookletLabel(s)}: ${bookletReceiptCount(s)} receipts`).join("\n");
    if (!(await askConfirm({ title: `Delete ${starts.length} whole booklet${starts.length === 1 ? "" : "s"}?`, danger: true, ok: "Delete",
        message: `${ents.length} receipts, ${mks.length} void / not-used marks and their cash counts will be removed.\n\n${list}` }))) return;
    if (!(await askConfirm({ title: "Really delete?", danger: true, ok: "Yes, delete", cancel: "Keep them",
        message: "Consider downloading a CSV or the booklet PDFs first. You can press Undo for a few seconds afterwards." }))) return;
    const priorCash = starts.map(s => [s, loadCashCount(s)]);
    const entIds = new Set(ents.map(e => e.id));
    const mkIds = new Set(mks.map(m => m.id || `pr_${m.pr}`));
    const editingGone = editingId && entIds.has(editingId);
    entries = entries.filter(e => !entIds.has(e.id));
    marks = marks.filter(m => !mkIds.has(m.id || `pr_${m.pr}`));
    localStorage.setItem(LS_MARKS, JSON.stringify(marks));
    saveLocal();
    const lastPr = Number(localStorage.getItem(LS_LAST_PR));
    if (starts.includes(bookletStart(lastPr))) localStorage.removeItem(LS_LAST_PR);
    starts.forEach(s => { delete cashCounts[s]; localStorage.removeItem(cashKey(s)); collapsedBooklets.delete(s); selectedBooklets.delete(s); });
    if (editingGone) resetForm();
    refresh();
    try {
        await commitDeletes([
            ...ents.map(e => doc(col, e.id)),
            ...[...mkIds].map(id => doc(marksCol, id)),
            ...starts.map(s => doc(cashCountsCol, cashDocId(s))),
        ]);
    } catch (e) { remoteFail(e); return; }
    toast(`Deleted ${starts.length} booklet${starts.length === 1 ? "" : "s"} (${ents.length} receipts).`, async () => {
        entries = entries.filter(e => !entIds.has(e.id)).concat(ents);
        marks = marks.filter(m => !mkIds.has(m.id || `pr_${m.pr}`)).concat(mks);
        localStorage.setItem(LS_MARKS, JSON.stringify(marks));
        saveLocal();
        priorCash.forEach(([s, c]) => { if (Object.keys(c).length) saveCashCount(s, c); });
        refresh();
        try {
            const sets = [...ents.map(({ id, ...d }) => [doc(col, id), d]), ...mks.map(({ id, ...d }) => [doc(marksCol, id || `pr_${d.pr}`), d])];
            for (let i = 0; i < sets.length; i += 400) {
                const batch = writeBatch(db);
                sets.slice(i, i + 400).forEach(([r, d]) => batch.set(r, d));
                await batch.commit();
            }
        } catch (e) { remoteFail(e); return; }
        toast(`Restored ${starts.length} booklet${starts.length === 1 ? "" : "s"} (${ents.length} receipts).`);
    });
});

$("outBody").addEventListener("click", async ev => {
    // Booklet checkboxes: select without collapsing / expanding the booklet.
    if (ev.target.closest(".bk-sel")) {
        const cb = ev.target.closest("input[data-bk-select]");
        if (cb) {
            const s = Number(cb.dataset.bkSelect);
            if (cb.checked) selectedBooklets.add(s); else selectedBooklets.delete(s);
            cb.closest("tr.booklet-head").classList.toggle("bk-selected", cb.checked);
            updateSelBar();
        }
        return;
    }
    const b = ev.target.closest("button");
    if (!b) {
        const mh = ev.target.closest("tr.month-head");
        if (mh) {
            const m = mh.dataset.month;
            if (collapsedMonths.has(m)) collapsedMonths.delete(m); else collapsedMonths.add(m);
            refresh();
            return;
        }
        const head = ev.target.closest("tr.booklet-head");
        if (head) {
            const s = Number(head.dataset.booklet);
            if (collapsedBooklets.has(s)) collapsedBooklets.delete(s); else collapsedBooklets.add(s);
            refresh();
        }
        return;
    }
    if (b.dataset.lock) toggleLock(Number(b.dataset.lock));
    if (b.dataset.unmark) {
        const pr = Number(b.dataset.unmark);
        const m = marks.find(x => Number(x.pr) === pr);
        clearMark(pr);
        if (m && !isLocked(pr)) toast(`Mark on PR #${pr} removed.`, () => { setMark(pr, m.status); toast(`PR #${pr} marked ${markLabel(m.status)} again.`); });
    }
    if (b.dataset.bkmenu) { openBkMenu(b); return; }
    if (b.dataset.markreviewed) markBookletReviewed(Number(b.dataset.markreviewed));
    if (b.dataset.review) openReview(Number(b.dataset.review), b.dataset.first === "1");
    if (b.dataset.edit) startEdit(b.dataset.edit);
    if (b.dataset.del) {
        const e = entries.find(x => x.id === b.dataset.del);
        if (e && await askConfirm({ title: `Delete PR #${e.pr}?`, message: "You can press Undo for a few seconds afterwards.", danger: true, ok: "Delete" })) {
            removeEntry(e.id);
            if (editingId === e.id) resetForm();
        }
    }
});

["fromDate", "toDate", "bookletFilter", "monthFilter", "mopFilter"].forEach(id => $(id).addEventListener("input", refresh));
let searchTimer;
$("searchInput").addEventListener("input", () => { clearTimeout(searchTimer); $("searchClear").classList.toggle("hidden", !$("searchInput").value); searchTimer = setTimeout(refresh, 150); });
$("searchInput").addEventListener("keydown", ev => { if (ev.key === "Escape" && $("searchInput").value) { ev.stopPropagation(); $("searchInput").value = ""; refresh(); } });
$("searchClear").addEventListener("click", () => { $("searchInput").value = ""; refresh(); $("searchInput").focus(); });
document.addEventListener("keydown", ev => {
    if ((ev.key !== "/" && ev.key !== "g") || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const t = ev.target, tag = t && t.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (t && t.isContentEditable)) return;
    if (document.querySelector(".review-overlay:not(.hidden), .modal-overlay:not(.hidden)")) return;
    ev.preventDefault();
    const box = ev.key === "g" ? $("gotoPr") : $("searchInput");
    box.focus(); box.select();
});
$("uncheckedOnly").addEventListener("change", refresh);
$("clearFilterBtn").addEventListener("click", () => {
    $("searchInput").value = ""; $("fromDate").value = ""; $("toDate").value = ""; $("bookletFilter").value = ""; $("monthFilter").value = ""; $("mopFilter").value = ""; $("uncheckedOnly").checked = false; refresh();
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
    const parsed = parseSheet($("importText").value);
    const { entries: es, skipped, marks: ms, warnings } = parsed;
    const ch = importChanges(parsed, entries);
    const exist = ch.replaced.length + ch.same.length;
    const parts = [];
    if (es.length) parts.push(`${es.length} PRs found${exist ? `, ${exist} already exist` : ""}`);
    if (ms.length) parts.push(`${ms.length} void / not used`);
    if (skipped.length) parts.push(`${skipped.length} rows skipped`);
    if (warnings.length) parts.push(`${warnings.length} total mismatch${warnings.length === 1 ? "" : "es"}`);
    $("importInfo").textContent = parts.length ? parts.join(", ") : ($("importText").value.trim() ? "Nothing readable found" : "");
    $("importGo").disabled = !es.length && !ms.length;
    renderImportDetail(parsed, ch);
    return { es, marks: ms, parsed, changes: ch };
}
// Shows what the paste will do before anything is saved: replaced receipts (and what differs), locked / dropped items, problems.
function renderImportDetail(parsed, ch) {
    const box = $("importDetail");
    const { entries: es, skipped, marks: ms, warnings } = parsed;
    const list = (items, max = 12) => `<ul>${items.slice(0, max).map(t => `<li>${t}</li>`).join("")}${items.length > max ? `<li class="muted">...and ${items.length - max} more</li>` : ""}</ul>`;
    const lockedPrs = [...es.map(e => e.pr), ...ms.map(m => m.pr)].filter(pr => isLocked(pr));
    const taken = new Set([...entries.map(e => Number(e.pr)), ...es.map(e => Number(e.pr))]);
    const dropped = ms.filter(m => !isLocked(m.pr) && taken.has(m.pr)).map(m => m.pr);
    let html = "";
    if (ch.replaced.length) html += `<h4 class="warn">Will replace ${ch.replaced.length} existing receipt${ch.replaced.length === 1 ? "" : "s"}</h4>` + list(ch.replaced.map(r => `<b>PR ${esc(r.pr)}</b>: ${esc(r.diffs.join("; "))}`));
    if (ch.added.length) html += `<h4>${ch.added.length} new</h4><div class="muted">${esc(ch.added.slice(0, 20).join(", "))}${ch.added.length > 20 ? ", ..." : ""}</div>`;
    if (ch.same.length) html += `<h4>${ch.same.length} identical to what you already have</h4>`;
    if (lockedPrs.length) html += `<h4 class="warn">${lockedPrs.length} in locked booklets (will be skipped)</h4><div class="muted">${esc(lockedPrs.slice(0, 20).join(", "))}</div>`;
    if (dropped.length) html += `<h4 class="warn">${dropped.length} void / not used not recorded (the number already has a receipt)</h4><div class="muted">${esc(dropped.slice(0, 20).join(", "))}</div>`;
    if (warnings.length) html += `<h4 class="warn">Total mismatch (check for shifted columns)</h4>` + list(warnings.map(esc));
    if (skipped.length) html += `<h4 class="warn">${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped (no usable quantity / price or description)</h4>` + list(skipped.map(r => `<code>${esc(r.length > 90 ? r.slice(0, 90) + "..." : r)}</code>`), 6);
    box.innerHTML = html;
    box.classList.toggle("hidden", !html);
}
$("importBtn").addEventListener("click", () => { $("importText").value = ""; importPreview(); $("importModal").classList.remove("hidden"); $("importText").focus(); });
$("importClose").addEventListener("click", () => $("importModal").classList.add("hidden"));
$("importText").addEventListener("input", importPreview);
$("importSample").addEventListener("click", () => { $("importText").value = SHEET_0920; importPreview(); });
$("importGo").addEventListener("click", async () => {
    let { es, marks: ms, parsed, changes } = importPreview();
    if (!es.length && !ms.length) return;
    const overwrite = changes.replaced.filter(r => !isLocked(r.pr)).length;
    if (overwrite && !(await askConfirm({ title: "Replace existing receipts?", message: `${overwrite} existing receipt${overwrite === 1 ? "" : "s"} will be replaced with different data. You can press Undo right after.`, ok: "Replace and import", danger: true }))) return;
    if (parsed.warnings.length && !(await askConfirm({ title: "Totals do not match", message: `${parsed.warnings.length} row${parsed.warnings.length === 1 ? "" : "s"} have a total that does not match qty x price. The columns may be shifted. Import anyway?`, ok: "Import anyway", danger: true }))) return;
    const locked = es.filter(e => isLocked(e.pr)).length + ms.filter(m => isLocked(m.pr)).length;
    es = es.filter(e => !isLocked(e.pr)); // locked booklets are never touched by an import
    // A void / not-used number is only recorded when no receipt (existing or imported) uses it.
    const taken = new Set([...entries.map(e => Number(e.pr)), ...es.map(e => Number(e.pr))]);
    ms = ms.filter(m => !isLocked(m.pr) && !taken.has(m.pr));
    if (!es.length && !ms.length) return toast("Everything in that paste belongs to a locked booklet or is already used.");
    const ids = new Set(es.map(e => e.id));
    // Keep what the import is about to overwrite, so it can be undone.
    const oldEntries = entries.filter(e => ids.has(e.id));
    const oldMarks = ms.map(m => marks.find(x => Number(x.pr) === m.pr) || null);
    entries = entries.filter(e => !ids.has(e.id)).concat(es);
    saveLocal();
    refresh();
    for (const { id, ...data } of es) setDoc(doc(col, id), data).catch(remoteFail);
    ms.forEach(m => setMark(m.pr, m.status));
    $("importModal").classList.add("hidden");
    const undoImport = () => {
        const oldIds = new Set(oldEntries.map(e => e.id));
        entries = entries.filter(e => !ids.has(e.id)).concat(oldEntries);
        saveLocal();
        refresh();
        es.filter(e => !oldIds.has(e.id)).forEach(e => deleteDoc(doc(col, e.id)).catch(remoteFail));
        for (const { id, ...data } of oldEntries) setDoc(doc(col, id), data).catch(remoteFail);
        ms.forEach((m, i) => { const o = oldMarks[i]; if (o) setMark(o.pr, o.status); else clearMark(m.pr); });
        toast(`Import undone: ${es.length} PR${es.length === 1 ? "" : "s"} back to how they were.`);
    };
    toast(`Imported ${es.length} PRs` + (ms.length ? `, ${ms.length} void / not used` : "") + (locked ? `, skipped ${locked} in locked booklets` : ""), undoImport);
});

$("clearBtn").addEventListener("click", async () => {
    if (!entries.length) return toast("Nothing to clear.");
    if (locks.length) return toast("Some booklets are locked. Unlock them first to clear everything.");
    if (!(await askConfirm({ title: `Delete ALL ${entries.length} receipts?`, message: "This cannot be undone.", danger: true, ok: "Delete all" }))) return;
    if (!(await askConfirm({ title: "Really delete everything?", message: "Consider downloading a CSV first.", danger: true, ok: "Yes, delete everything", cancel: "Keep them" }))) return;
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

// ---------- Sales summary: full page, like the PR review ----------
function closeSales() {
    $("salesOverlay").classList.add("hidden");
    document.body.classList.remove("modal-open", "print-sales");
}
$("salesBtn").addEventListener("click", () => {
    renderSalesSheet($("salesBody"), entries);
    $("salesOverlay").classList.remove("hidden");
    document.body.classList.add("modal-open");
    $("salesBody").scrollTop = 0;
});
$("salesClose").addEventListener("click", closeSales);
$("salesPrint").addEventListener("click", () => {
    document.body.classList.add("print-sales");
    window.print();
    setTimeout(() => document.body.classList.remove("print-sales"), 500);
});
document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !$("salesOverlay").classList.contains("hidden")) { ev.preventDefault(); closeSales(); }
});

// ---------- Analytics: full page, like the sales summary ----------
function closeAnalytics() {
    $("analyticsOverlay").classList.add("hidden");
    document.body.classList.remove("modal-open", "print-sales");
}
let analyticsRange = {}; // the chosen dates are kept while the page is closed and reopened
$("analyticsBtn").addEventListener("click", () => {
    renderAnalytics($("analyticsBody"), entries, marks, analyticsRange);
    $("analyticsOverlay").classList.remove("hidden");
    document.body.classList.add("modal-open");
    $("analyticsBody").scrollTop = 0;
});
$("analyticsClose").addEventListener("click", closeAnalytics);
$("analyticsPrint").addEventListener("click", () => {
    document.body.classList.add("print-sales");
    window.print();
    setTimeout(() => document.body.classList.remove("print-sales"), 500);
});
$("analyticsBody").addEventListener("change", () => { analyticsRange = { from: $("anFrom")?.value || "", to: $("anTo")?.value || "" }; });
$("analyticsBody").addEventListener("click", ev => { if (ev.target.closest("[data-an]")) setTimeout(() => { analyticsRange = { from: $("anFrom")?.value || "", to: $("anTo")?.value || "" }; }); });
document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !$("analyticsOverlay").classList.contains("hidden")) { ev.preventDefault(); closeAnalytics(); }
});

// ---------- Catalog modal ----------
function renderCatalogRows() {
    const cats = [...new Set(["OTHER", ...catalog.map(c => c.category).filter(Boolean)])];
    $("catCategories").innerHTML = cats.map(c => `<option value="${esc(c)}">`).join("");
    $("catalogBody").innerHTML = `<div class="cat-row cat-head"><span>Category</span><span>Item</span><span>Shorthand</span><span>Price</span><span></span></div>` + catalog.map((c, i) => `
        <div class="cat-row">
            <input type="text" list="catCategories" value="${esc(c.category || "")}" data-i="${i}" data-k="category" placeholder="Category">
            <input type="text" value="${esc(c.desc)}" data-i="${i}" data-k="desc">
            <input type="text" value="${esc(c.code || "")}" data-i="${i}" data-k="code" placeholder="${esc(itemShortcut(catalog, c))}" title="Optional custom shorthand, e.g. gte">
            <input type="number" min="0" step="0.01" value="${c.price}" data-i="${i}" data-k="price">
            <button class="btn btn-danger btn-icon-only" data-rm="${i}"><i class="ri-close-line"></i></button>
        </div>`).join("");
}
function closeCatalog() {
    catalog = loadCatalog();
    $("catalogModal").classList.add("hidden");
    document.body.classList.remove("modal-open");
}
$("catalogBtn").addEventListener("click", () => {
    renderCatalogRows();
    $("catalogModal").classList.remove("hidden");
    document.body.classList.add("modal-open");
    $("catalogBody").scrollTop = 0;
});
$("catalogClose").addEventListener("click", closeCatalog);
$("catalogBody").addEventListener("input", ev => {
    const t = ev.target; if (t.dataset.i === undefined) return;
    catalog[t.dataset.i][t.dataset.k] = t.dataset.k === "price" ? Number(t.value) : t.value;
});
$("catalogBody").addEventListener("click", ev => {
    const b = ev.target.closest("[data-rm]"); if (!b) return;
    catalog.splice(Number(b.dataset.rm), 1); renderCatalogRows();
});
$("catalogAdd").addEventListener("click", () => {
    catalog.push({ desc: "", price: 0, category: "" }); renderCatalogRows();
    const rows = $("catalogBody").querySelectorAll(".cat-row"); const last = rows[rows.length - 1];
    last.scrollIntoView({ block: "end" }); last.querySelectorAll("input")[1].focus();
});
$("catalogReset").addEventListener("click", async () => {
    if (!(await askConfirm({ title: "Reset the catalog?", message: "Reset to the default price list. This changes it on every device.", danger: true, ok: "Reset" }))) return;
    const before = loadCatalog();
    localStorage.removeItem(LS_CATALOG);
    catalog = defaultCatalog(); renderCatalogRows();
    recordPriceChanges(before, catalog);
    saveCatalogToCloud(catalog);
});
$("catalogSave").addEventListener("click", () => {
    catalog = catalog.filter(c => c.desc.trim()).map(c => {
        const item = { desc: c.desc.trim(), price: Number(c.price) || 0 };
        if (c.code && c.code.trim()) item.code = c.code.trim();
        if (c.category && c.category.trim()) item.category = c.category.trim();
        return item;
    });
    recordPriceChanges(loadCatalog(), catalog); // compare with the last saved (shared) catalog before overwriting it
    localStorage.setItem(LS_CATALOG, JSON.stringify(catalog));
    saveCatalogToCloud(catalog);
    catalogOptions();
    $("catalogModal").classList.add("hidden");
    document.body.classList.remove("modal-open");
    toast("Catalog saved for all devices.");
});

// ---------- Price history window (opened from Catalog) ----------
function renderPriceHistory() {
    const q = $("phSearch").value.trim().toLowerCase();
    const fmt = n => "\u20B1" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const when = at => new Date(at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    const rows = [...priceHistory].sort((a, b) => b.at - a.at || String(a.desc).localeCompare(b.desc)).filter(r => !q || String(r.desc).toLowerCase().includes(q));
    if (!rows.length) { $("phBody").innerHTML = `<div class="empty-msg">${priceHistory.length ? "No match." : "No price changes recorded yet. Changes are logged each time the catalog is saved."}</div>`; return; }
    const change = r => {
        if (r.kind === "added") return `<span class="ph-new">New item at ${fmt(r.newPrice)}</span>`;
        if (r.kind === "removed") return `<span class="ph-removed">Removed (was ${fmt(r.oldPrice)})</span>`;
        const d = r.newPrice - r.oldPrice;
        return `${fmt(r.oldPrice)} &rarr; <strong>${fmt(r.newPrice)}</strong> <span class="${d > 0 ? "ph-up" : "ph-down"}">${d > 0 ? "+" : "-"}${fmt(Math.abs(d))}</span>`;
    };
    const escH = s => String(s).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
    $("phBody").innerHTML = `<table class="ph-table"><thead><tr><th>When</th><th>Item</th><th>Price change</th></tr></thead><tbody>${
        rows.map(r => `<tr><td>${escH(when(r.at))}</td><td>${escH(r.desc)}</td><td>${change(r)}</td></tr>`).join("")}</tbody></table>`;
}
$("catalogHistory").addEventListener("click", () => { $("phSearch").value = ""; renderPriceHistory(); $("priceHistoryModal").classList.remove("hidden"); });
$("phClose").addEventListener("click", () => $("priceHistoryModal").classList.add("hidden"));
$("phSearch").addEventListener("input", renderPriceHistory);
document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !$("priceHistoryModal").classList.contains("hidden")) { ev.stopImmediatePropagation(); $("priceHistoryModal").classList.add("hidden"); }
}, true);

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

// Open a booklet's summary directly (view only: Back becomes "Review PRs", Done closes).
function openSummaryView(start) {
    rv = { start, pr: null, summary: true, viewOnly: true };
    rvStreak = 0;
    const seq = rvSeq();
    if (!seq.length) { rv = null; toast("Nothing to show in this booklet yet."); return; }
    rv.pr = seq[seq.length - 1].pr;
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

// ---- Review effects: CHECKED stamp, checkpoint every 10 PRs, confetti when the booklet is verified ----
const LS_FX = "pre_fx";
let fxOn = localStorage.getItem(LS_FX) !== "off";
const reducedMotion = () => !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
let rvBusy = false;      // the stamp is showing: ignore extra Enter presses so nothing is skipped
let rvPopPr = null;      // PR whose chip pops after it was checked
const cpShown = new Set(); // checkpoints already shown ("start:count") so unchecking and rechecking does not repeat them
function updateFxBtn() {
    $("rvFx").innerHTML = fxOn ? '<i class="ri-sparkling-2-fill"></i>' : '<i class="ri-sparkling-2-line"></i>';
    $("rvFx").title = fxOn ? "Effects on: stamp, checkpoints, confetti (click to turn off)" : "Effects off (click to turn on)";
    $("rvFx").classList.toggle("fx-off", !fxOn);
}
$("rvFx").addEventListener("click", () => { fxOn = !fxOn; localStorage.setItem(LS_FX, fxOn ? "on" : "off"); updateFxBtn(); if (fxOn) showStamp(); });
updateFxBtn();
function showStamp() {
    const r = $("rvCard").getBoundingClientRect();
    const st = document.createElement("div");
    st.className = "rv-stamp" + (reducedMotion() ? " calm" : "");
    st.setAttribute("aria-hidden", "true");
    st.innerHTML = '<i class="ri-check-double-line"></i> CHECKED';
    st.style.left = (r.left + r.width / 2) + "px";
    st.style.top = (r.top + Math.min(r.height, window.innerHeight - r.top) / 2) + "px";
    $("reviewOverlay").appendChild(st);
    setTimeout(() => st.remove(), 900);
}
let bannerTimer;
function showBanner(html, cls, ms) {
    let b = $("rvBanner");
    if (!b) { b = document.createElement("div"); b.id = "rvBanner"; b.setAttribute("role", "status"); $("reviewOverlay").appendChild(b); }
    b.className = "rv-banner " + (cls || "") + (reducedMotion() ? " calm" : "");
    b.innerHTML = html;
    void b.offsetWidth; // restart the slide-in
    b.classList.add("show");
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => b.classList.remove("show"), ms);
}
function playChime(kind) {
    if (!soundOn) return;
    try {
        audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === "suspended") audioCtx.resume();
        if (kind === "checkpoint") [659.25, 880, 1318.51].forEach((n, i) => tone(n, 0.16 + i * 0.1, 0.28, 0.14, "triangle"));
        else [261.63, 329.63, 392, 523.25].forEach(n => tone(n, 0.7, 0.9, 0.09)); // big warm chord under the fanfare
    } catch { /* sound is optional */ }
}
function checkpointFor(start, checked, total) {
    const key = `${start}:${checked}`;
    if (checked <= 0 || checked % 10 !== 0 || cpShown.has(key)) return;
    cpShown.add(key);
    const pct = total ? Math.round((checked / total) * 100) : 0;
    showBanner(`<span class="rv-flag">&#9873;</span><div><b>Checkpoint: ${checked} of ${total} checked</b><div class="rv-cp-bar"><span style="width:${pct}%"></span></div></div>`, "cp", 1700);
    playChime("checkpoint");
}
function launchConfetti() {
    if (reducedMotion()) return;
    const dpr = window.devicePixelRatio || 1, W = window.innerWidth, H = window.innerHeight;
    const cv = document.createElement("canvas");
    cv.className = "rv-confetti";
    cv.width = W * dpr; cv.height = H * dpr;
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d"); ctx.scale(dpr, dpr);
    const colors = ["#f43f5e", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899", "#fde047"];
    const ps = [];
    const cannon = (x0, dir, n) => { for (let i = 0; i < n; i++) ps.push({ x: x0, y: H * 0.9, vx: dir * (4 + Math.random() * 12), vy: -(10 + Math.random() * 16), w: 6 + Math.random() * 7, h: 4 + Math.random() * 6, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, c: colors[i % colors.length], round: Math.random() < 0.25, delay: Math.random() * 12 }); };
    cannon(0, 1, 90); cannon(W, -1, 90);
    let frame = 0;
    (function tick() {
        frame++;
        ctx.clearRect(0, 0, W, H);
        let alive = 0;
        for (const p of ps) {
            if (frame < p.delay) { alive++; continue; }
            p.vy += 0.32; p.vx *= 0.992; p.vy *= 0.992;
            p.x += p.vx; p.y += p.vy; p.rot += p.vr;
            if (p.y < H + 30) alive++;
            ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
            if (p.round) { ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, 6.28); ctx.fill(); } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();
        }
        if (alive && frame < 420) requestAnimationFrame(tick); else cv.remove();
    })();
}
function celebrateBooklet() {
    showBanner('<span class="rv-flag">&#127881;</span><div><b>Booklet verified!</b><div class="rv-cp-sub">Every PR is checked.</div></div>', "done", 3200);
    launchConfetti();
    playChime("done");
}

function rvConfirm() {
    if (rv.summary || rvBusy) return;
    const s = rvCurrent();
    if (s.type === "entry") {
        if (!s.checked && isLocked(s.pr)) { lockedToast(); return; }
        if (!s.checked) {
            setChecked(s.entry.id, true);
            const prog = reviewProgress(rvSeq());
            playCheckSound(prog.done);
            rvStreak++;
            if (fxOn) {
                rvPopPr = s.pr;
                showStamp();
                if (prog.done) celebrateBooklet(); else checkpointFor(rv.start, prog.checked, prog.entries);
                rvBusy = true;
                const pr = rv.pr, start = rv.start;
                setTimeout(() => { rvBusy = false; if (rv && !rv.summary && rv.start === start && rv.pr === pr) rvGo(1); }, reducedMotion() ? 120 : 380);
                return;
            }
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
// Review: a payment line with just the reference number (falls back to the method name when there is none).
function reviewPayText(p) {
    const label = !p.method || p.method === "Cash" ? "Cash" : [p.method === "Bank Transfer" ? (p.bank || "").trim() : (p.channel || "").trim(), (p.ref || "").trim()].filter(Boolean).join(" ") || p.method;
    return `${label} ${money(p.amount)}`;
}

function receiptPaperHtml(e) {
    const total = entryTotal(e);
    const pays = Array.isArray(e.payments) && e.payments.length
        ? e.payments : [{ method: e.mop && e.mop !== "Split" ? e.mop : "Cash", amount: total, ref: e.mopRef || "", bank: e.mopBank || "", channel: e.mopChannel || "" }];
    const multi = pays.length > 1;
    const hasCash = pays.some(p => !p.method || p.method === "Cash");
    const check = pays.find(p => /^che(que|ck)$/i.test(p.method));
    const bank = pays.find(p => p.method === "Bank Transfer");
    const online = pays.filter(p => p.method && !["Cash", "Check", "Cheque", "Bank Transfer"].includes(p.method));
    const chanOf = p => (p.channel || "").trim();
    const invoiceRef = online.map(p => `${chanOf(p) ? chanOf(p) + " " : ""}${(p.ref || "").trim() || (chanOf(p) ? "" : p.method)}${multi ? " (" + money(p.amount) + ")" : ""}`).join(", ");
    const chanNames = [...new Set(online.map(chanOf).filter(Boolean))].join(", ");
    const bankText = bank ? `${(bank.bank || "").trim() || "Bank Transfer"}${bank.ref ? " " + bank.ref : ""}${multi ? " (" + money(bank.amount) + ")" : ""}` : "";

    const rows = e.items.map(i => ({ text: `${i.desc} - ${i.qty}`, amt: money(round2(i.qty * i.price)) }));
    while (rows.length < 6) rows.push({ text: "", amt: "" });
    // Registered name on the paper: any non-cash payment (invoice, GCash, bank...) reads "Online Payment".
    const allCash = pays.every(p => !p.method || p.method === "Cash");
    const named = (e.buyer || "").trim() && !/^an+onymous$/i.test(e.buyer.trim());
    const onlineLabel = chanNames ? `Online Payment (${chanNames})` : "Online Payment";
    const regName = allCash ? `Cash - ${e.buyer || "Anonymous"}` : named ? `${onlineLabel} - ${e.buyer.trim()}` : onlineLabel;
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

    let cpCount = 0;
    $("rvStrip").innerHTML = seq.map(s => {
        const cls = s.type === "entry" ? (s.checked ? "checked" : "") : s.type === "mark" ? "mark" : "missing";
        const current = !rv.summary && s.pr === cur.pr ? " current" : "";
        const pop = rvPopPr !== null && s.pr === rvPopPr ? " pop" : "";
        const cp = s.type === "entry" && s.checked && ++cpCount % 10 === 0 ? " cp" : ""; // flag on every 10th checked PR
        return `<button type="button" class="rv-chip ${cls}${current}${pop}${cp}" data-pr="${s.pr}" title="${s.type === "mark" ? s.status : s.type === "missing" ? "No entry" : s.checked ? "Checked" : "Not checked yet"}">${s.pr}</button>`;
    }).join("");
    rvPopPr = null;
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
            ? e.payments.map(p => esc(reviewPayText(p))).join("<br>")
            : esc(e.mop && e.mop !== "Cash" && e.mop !== "Split" ? ([e.mop === "Bank Transfer" ? (e.mopBank || "").trim() : (e.mopChannel || "").trim(), (e.mopRef || "").trim()].filter(Boolean).join(" ") || e.mop) : (mopText(e) || "Cash"));
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
        fitPaper(true);
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

// Receipt size in review: "fit" (whole receipt on screen) or "larger" (fills the width, scroll to see the bottom). Remembered.
let rvWide = localStorage.getItem("pre_rv_wide") === "1";
function updateRvZoomBtn() {
    $("rvZoom").innerHTML = rvWide ? '<i class="ri-zoom-out-line"></i> Fit screen' : '<i class="ri-zoom-in-line"></i> Larger';
    $("rvZoom").title = rvWide ? "Show the whole receipt on screen (Z)" : "Make the receipt larger to read it better (Z)";
}
function toggleRvZoom() {
    rvWide = !rvWide;
    localStorage.setItem("pre_rv_wide", rvWide ? "1" : "0");
    updateRvZoomBtn();
    fitPaper(true);
}
$("rvZoom").addEventListener("click", toggleRvZoom);
updateRvZoomBtn();
function fitPaper(resetScroll = false) {
    resetScroll = resetScroll === true;
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
    if (rvWide) { // larger: fill the width, the card scrolls up and down
        const zw = Math.max(0.3, Math.min(stage.clientWidth / nw, 2.4));
        paper.style.zoom = zw.toFixed(4);
        stage.style.flex = "none";
        stage.style.height = Math.ceil(nh * zw) + 2 + "px";
        if (resetScroll) card.scrollTop = 0;
        return;
    }
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
            <tfoot><tr><td colspan="3">TOTAL</td><td class="num">${money(sec.total)}</td></tr>${cls === "online" ? (s.channels || []).map(c => `<tr class="rs-chan"><td colspan="3">&nbsp;&nbsp;${esc(c.channel)}</td><td class="num">${money(c.total)}</td></tr>`).join("") : ""}</tfoot>
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
        <div class="rs-topgrid">
            <div class="rs-topleft">
                <p style="color:var(--color-text-muted)">Booklet ${esc(bookletLabel(rv.start))}${prog.lastAt ? `, last checked ${esc(fmtStamp(prog.lastAt))}` : ""}.</p>
                <div class="rs-stats">
                    <span><b>${prog.entries}</b> receipts</span>
                    <span><b>${prog.checked}/${prog.entries}</b> checked</span>
                    <span><b>${prog.marks}</b> void or not used</span>
                    <span>Total sales <b>${peso(sales)}</b></span>
                    ${(() => { const v = bookletVerification(entries, rv.start); return v.checks >= 2 ? `<span title="Active checking time. Pauses over 5 minutes are not counted. First check to last check: ${esc(formatDuration(v.spanMs))}.">Verification time <b>${esc(formatDuration(v.ms))}${v.approx ? " approx." : ""}</b></span>` : ""; })()}
                </div>
            </div>
            <table class="rs-totalsbox" aria-label="Sales totals">
                <tr><th>Cash Sales</th><td>${money(split.cash)}</td></tr>
                <tr><th>Online Payment</th><td>${money(split.online)}</td></tr>
                <tr><th>Total Sales</th><td>${money(sales)}</td></tr>
            </table>
        </div>
        ${summaryHtml(bookEntries)}
        ${allDone ? "" : `<p>Still open: ${open.slice(0, 12).map(s => "#" + s.pr).join(", ")}${open.length > 12 ? ", ..." : ""}</p>`}`;
    $("rvActions").innerHTML = (rv.viewOnly
        ? `<button type="button" class="btn btn-secondary btn-lg" data-rv="reviewfirst"><i class="ri-checkbox-circle-line"></i> Review PRs</button>`
        : `<button type="button" class="btn btn-secondary btn-lg" data-rv="back"><i class="ri-arrow-left-line"></i> Back</button>`) + `<div class="grp">
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
        case "reviewfirst": { const s0 = rvSeq(); rv.viewOnly = false; rv.pr = s0[0].pr; rv.summary = false; renderReview(); break; }
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
$("rvRestart").addEventListener("click", async () => {
    if (!rv) return;
    if (locks.includes(rv.start)) return lockedToast();
    const checked = entries.filter(e => bookletStart(e.pr) === rv.start && e.checkedAt);
    if (!checked.length) return toast("Nothing is checked in this booklet.");
    if (!(await askConfirm({ title: "Restart the review?", message: `Uncheck all ${checked.length} checked PRs in booklet ${bookletLabel(rv.start)} and start again.`, ok: "Uncheck all" }))) return;
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
    [...cpShown].filter(k => k.startsWith(rv.start + ":")).forEach(k => cpShown.delete(k));
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
    const used = ["Enter", "ArrowLeft", "ArrowRight", " ", "Escape", "e", "E", "u", "U", "v", "V", "n", "N", "l", "L", "z", "Z"];
    if (!used.includes(k)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (rvBusy) return; // the CHECKED stamp is showing
    if (k === "Enter") rvConfirm();
    else if (k === "ArrowLeft") rvGo(-1);
    else if (k === "ArrowRight" || k === " ") rvGo(1);
    else if (k === "Escape") { if (!closeExportMenu()) closeReview(); } // Esc closes the Export menu first
    else if (k.toLowerCase() === "e") rvEdit();
    else if (k.toLowerCase() === "u") rvUncheck();
    else if (k.toLowerCase() === "v") rvMark("void");
    else if (k.toLowerCase() === "n") rvMark("unused");
    else if (k.toLowerCase() === "l") rvEncodeLater();
    else if (k.toLowerCase() === "z") toggleRvZoom();
}, true);

// ---------- Shortcuts legend (collapsible, remembered) ----------
const scBox = $("shortcutsBox");
// Collapsed by default; once you open it, that choice is remembered on this device (new key, so everyone starts collapsed).
if (localStorage.getItem("pre_sc_open_v2") === "1") scBox.open = true;
const syncScLabel = () => { scBox.querySelector(".sc-toggle").textContent = scBox.open ? "hide" : "show"; };
syncScLabel();
scBox.addEventListener("toggle", () => { localStorage.setItem("pre_sc_open_v2", scBox.open ? "1" : "0"); syncScLabel(); });

// ---------- Init ----------
setStatus("offline", "Connecting");
catalogOptions();
fillChannelSelects();
bindChannelInput($("fChannel"), $("fChannelNew"));
bindChannelInput($("sChannel"), $("sChannelNew"));
resetForm();
refresh();

// ---------- Sticky section tabs ----------
const sectionTabs = [...document.querySelectorAll("#sectionTabs [data-target]")];
sectionTabs.forEach(a => a.addEventListener("click", ev => {
    ev.preventDefault();
    const t = $(a.dataset.target);
    if (t) t.scrollIntoView({ behavior: "smooth", block: "start" });
}));
let tabsQueued = false;
function updateTabs() {
    tabsQueued = false;
    let current = null;
    for (const a of sectionTabs) {
        const t = $(a.dataset.target);
        const gone = !t || t.classList.contains("hidden") || (t.id === "bkSummary" && !t.children.length);
        a.classList.toggle("hidden", gone); // e.g. Verified only shows once a booklet is verified
        if (!gone && t.getBoundingClientRect().top <= 120) current = a;
    }
    sectionTabs.forEach(a => a.classList.toggle("active", a === (current || sectionTabs[0])));
}
const queueTabs = () => { if (!tabsQueued) { tabsQueued = true; requestAnimationFrame(updateTabs); } };
window.addEventListener("scroll", queueTabs, { passive: true });
window.addEventListener("resize", queueTabs);
new MutationObserver(queueTabs).observe($("verifiedCard"), { attributes: true, attributeFilter: ["class"] });
new MutationObserver(queueTabs).observe($("continueCard"), { attributes: true, attributeFilter: ["class"] });
new MutationObserver(queueTabs).observe($("bkSummary"), { childList: true });
updateTabs();

// ---------- Tutorial video ----------
function closeTutorial() {
    $("tutVideo").pause();
    $("tutorialModal").classList.add("hidden");
}
$("tutorialBtn").addEventListener("click", () => {
    const v = $("tutVideo");
    if (!v.getAttribute("src")) v.src = "./tutorial/pr-encoding-tutorial.mp4"; // loaded only when opened (it is a few MB)
    $("tutorialModal").classList.remove("hidden");
});
$("tutorialClose").addEventListener("click", closeTutorial);
$("tutorialModal").addEventListener("mousedown", ev => { if (ev.target === $("tutorialModal")) closeTutorial(); });
document.addEventListener("keydown", ev => {
    if (ev.key === "Escape" && !$("tutorialModal").classList.contains("hidden")) closeTutorial();
});

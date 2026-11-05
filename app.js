import { initializeApp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-app.js";
import {
    getFirestore, collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, getDocs
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";
import {
    money, fmtDate, entryTotal, filterEntries, flatten, toTSV, toCSV, nextPr, checkPr, round2
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
}, err => {
    console.error("Firestore listener error", err);
    remoteOk = false;
    setStatus("error", "Local only");
    toast("Cloud sync unavailable. Data is saved on this device only.");
    refresh();
});

function remoteFail(err) {
    console.error(err);
    remoteOk = false;
    setStatus("error", "Local only");
    toast("Could not save to cloud. Saved on this device only.");
}

async function persist(entry, oldId) {
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

function removeEntry(id) {
    entries = entries.filter(e => e.id !== id);
    saveLocal();
    refresh();
    deleteDoc(doc(col, id)).catch(remoteFail);
}

// ---------- Form ----------
function catalogOptions() {
    $("catalogList").innerHTML = catalog.map(c => `<option value="${esc(c.desc)}"></option>`).join("");
}

function addItemRow(item = { desc: "", qty: 1, price: "" }) {
    const row = document.createElement("div");
    row.className = "item-row";
    row.innerHTML = `
        <input class="item-name" type="text" list="catalogList" placeholder="Search or type item" value="${esc(item.desc)}">
        <input class="item-qty" type="number" min="1" step="1" placeholder="Qty" value="${item.qty}">
        <input class="item-price" type="number" min="0" step="0.01" placeholder="Unit price" value="${item.price}">
        <div class="line-total">${peso(item.qty * (item.price || 0))}</div>
        <button type="button" class="btn btn-danger btn-icon-only" title="Remove item"><i class="ri-close-line"></i></button>`;
    const name = row.querySelector(".item-name");
    const qty = row.querySelector(".item-qty");
    const price = row.querySelector(".item-price");
    name.addEventListener("input", () => {
        const hit = catalog.find(c => c.desc.toLowerCase() === name.value.trim().toLowerCase());
        if (hit) price.value = hit.price;
        updateFormTotal();
    });
    qty.addEventListener("input", updateFormTotal);
    price.addEventListener("input", updateFormTotal);
    row.querySelector("button").addEventListener("click", () => {
        if ($("itemsList").children.length > 1) row.remove(); else { name.value = ""; qty.value = 1; price.value = ""; }
        updateFormTotal();
    });
    $("itemsList").appendChild(row);
    updateFormTotal();
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
    $("formTotal").textContent = peso(sum);
}

function updatePrWarning() {
    const el = $("prWarn");
    const pr = $("fPr").value;
    if (!pr) { el.classList.add("hidden"); return true; }
    const { duplicate, gap, expected } = checkPr(entries, pr, editingId);
    el.classList.remove("error");
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
    $("fPr").value = lastPr > 0 ? lastPr + 1 : nextPr(entries);
    $("fBuyer").value = "Anonymous";
    $("fMop").value = "Cash";
    $("fRef").value = "";
    updateRefField();
    $("itemsList").innerHTML = "";
    addItemRow();
    $("formTitle").textContent = "New Provisional Receipt";
    $("submitText").textContent = "Add PR to output";
    $("editBadge").classList.add("hidden");
    $("cancelEditBtn").classList.add("hidden");
    updatePrWarning();
}

function startEdit(id) {
    const e = entries.find(x => x.id === id);
    if (!e) return;
    editingId = id;
    setDate(e.date);
    $("fPr").value = e.pr;
    $("fBuyer").value = e.buyer || "";
    $("fMop").value = e.mop || "Cash";
    $("fRef").value = e.mopRef || "";
    updateRefField();
    $("itemsList").innerHTML = "";
    e.items.forEach(addItemRow);
    $("formTitle").textContent = `Edit PR #${e.pr}`;
    $("submitText").textContent = "Save changes";
    $("editBadge").classList.remove("hidden");
    $("cancelEditBtn").classList.remove("hidden");
    updatePrWarning();
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
$("fDate").addEventListener("input", () => {
    const digits = $("fDate").value.replace(/\D/g, "").slice(0, 8);
    let out = digits;
    if (digits.length > 4) out = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}-${digits.slice(2)}`;
    $("fDate").value = out;
    $("fDate").classList.toggle("invalid", out.length === 10 && !getDate());
    const iso = getDate();
    if (iso) localStorage.setItem(LS_LAST_DATE, iso);
});
// "09-21" -> "09-21-<current year>", "09-21-26" -> "09-21-2026"
function completeYear() {
    const el = $("fDate");
    const digits = el.value.replace(/\D/g, "");
    const year = new Date().getFullYear();
    if (digits.length === 4) el.value = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-${year}`;
    else if (digits.length === 6) el.value = `${digits.slice(0, 2)}-${digits.slice(2, 4)}-20${digits.slice(4)}`;
    else return;
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
$("fPr").addEventListener("input", updatePrWarning);
$("addRowBtn").addEventListener("click", () => addItemRow());
$("cancelEditBtn").addEventListener("click", resetForm);

$("prForm").addEventListener("submit", ev => {
    ev.preventDefault();
    if (!updatePrWarning()) { toast("Duplicate PR number."); return; }
    completeYear();
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
    const oldId = editingId;
    const wasEdit = !!editingId;
    persist(entry, oldId);
    toast(wasEdit ? `PR #${pr} updated.` : `PR #${pr} added.`);
    localStorage.setItem(LS_LAST_DATE, entry.date);
    if (!wasEdit) localStorage.setItem(LS_LAST_PR, String(pr));
    resetForm();
    $("itemsList").querySelector(".item-name").focus();
});

// ---------- Output ----------
function currentFilter() {
    return { q: $("searchInput").value, from: $("fromDate").value, to: $("toDate").value };
}
function visibleRows() { return flatten(filterEntries(entries, currentFilter())); }

function refresh() {
    const f = currentFilter();
    const shown = filterEntries(entries, f);
    const rows = flatten(shown);
    const body = $("outBody");
    body.innerHTML = rows.map(r => `
        <tr class="${r.first ? "pr-first" : ""}">
            <td>${r.first ? esc(r.date) : ""}</td>
            <td class="pr-no">${r.first ? esc(r.pr) : ""}</td>
            <td>${r.first ? esc(r.buyer) : ""}</td>
            <td>${esc(r.desc)}</td>
            <td class="num">${r.qty}</td>
            <td class="num">${money(r.price)}</td>
            <td class="num">${money(r.total)}</td>
            <td class="num">${money(r.grand)}</td>
            <td>${r.first ? esc(r.mop) : ""}</td>
            <td class="no-print">${r.first ? `<div class="row-actions">
                <button class="btn btn-secondary btn-icon-only" data-edit="${esc(r.entry.id)}" title="Edit"><i class="ri-edit-line"></i></button>
                <button class="btn btn-danger btn-icon-only" data-del="${esc(r.entry.id)}" title="Delete"><i class="ri-delete-bin-line"></i></button>
            </div>` : ""}</td>
        </tr>`).join("");
    $("emptyMsg").classList.toggle("hidden", rows.length > 0);
    $("emptyMsg").textContent = entries.length ? "No receipts match the filter." : "No receipts encoded yet.";
    const total = rows.length ? rows[rows.length - 1].grand : 0;
    $("valAmount").textContent = peso(total);
    $("valSub").textContent = `${shown.length} receipt${shown.length === 1 ? "" : "s"}` + (f.q || f.from || f.to ? " (filtered)" : "");
    const range = f.from || f.to ? `${f.from ? fmtDate(f.from) : "start"} to ${f.to ? fmtDate(f.to) : "latest"}` : "All dates";
    $("printTitle").textContent = `PR Summary - ${range} - Total ${peso(total)}`;
    updatePrWarning();
}

$("outBody").addEventListener("click", ev => {
    const b = ev.target.closest("button");
    if (!b) return;
    if (b.dataset.edit) startEdit(b.dataset.edit);
    if (b.dataset.del) {
        const e = entries.find(x => x.id === b.dataset.del);
        if (e && confirm(`Delete PR #${e.pr}?`)) {
            removeEntry(e.id);
            if (editingId === e.id) resetForm();
        }
    }
});

["searchInput", "fromDate", "toDate"].forEach(id => $(id).addEventListener("input", refresh));
$("clearFilterBtn").addEventListener("click", () => {
    $("searchInput").value = ""; $("fromDate").value = ""; $("toDate").value = ""; refresh();
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

$("clearBtn").addEventListener("click", async () => {
    if (!entries.length) return toast("Nothing to clear.");
    if (!confirm(`Delete ALL ${entries.length} receipts? This cannot be undone.`)) return;
    if (!confirm("Really delete everything? Consider downloading a CSV first.")) return;
    const ids = entries.map(e => e.id);
    entries = [];
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
    toast(`Cleared ${ids.length} receipts.`);
});

// ---------- Catalog modal ----------
function renderCatalogRows() {
    $("catalogBody").innerHTML = catalog.map((c, i) => `
        <div class="cat-row">
            <input type="text" value="${esc(c.desc)}" data-i="${i}" data-k="desc">
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
    catalog = catalog.filter(c => c.desc.trim()).map(c => ({ desc: c.desc.trim(), price: Number(c.price) || 0 }));
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

// ---------- Init ----------
setStatus("offline", "Connecting");
catalogOptions();
resetForm();
refresh();

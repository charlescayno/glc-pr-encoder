# GLC PR Encoder

A small static web app for encoding Provisional Receipts (PR) and turning them into a spreadsheet-style table.
It is styled like [glc-inventory](https://charlescayno.github.io/glc-inventory/).

Live site: https://charlescayno.github.io/glc-pr-encoder/

## Features
- Encode a PR: date, PR number, buyer, MOP (with reference number), and multiple sold items.
- Item catalog with prices (defaults to the glc-inventory price list; editable under Catalog, saved per device).
- Output table: DATE, PR NUMBER, BUYER, SOLD ITEMS, QTY, UNIT PRICE, TOTAL, GRAND TOTAL, MOP. Grand total runs down the rows.
- Duplicate PR number blocking and skipped-number warnings.
- Search and date filter; the running total is recomputed over the visible rows.
- Copy table (paste straight into Excel or Google Sheets), CSV download, printable summary.
- Edit and delete receipts. Installable as an app (PWA).

## Storage
Receipts are stored in Firestore in the `pr_encoder_entries` collection of the same Firebase project as glc-inventory.
It never reads or writes glc-inventory's documents (`inventory/main`, `history/main`, `receipts/main`).
A copy is also kept in the browser's `localStorage`. If the cloud is unreachable, the status badge shows "Local only".

Firestore security rules are project-wide and are not changed by this repo. If writes are denied, add a rule for
`pr_encoder_entries` in the Firebase console, for example:

```
match /pr_encoder_entries/{id} {
  allow read, write: if true;
}
```

The same applies to the other collections this app uses: `pr_encoder_marks` (void / not used sheets),
`pr_encoder_locks` (locked booklets) and `pr_encoder_cashcounts` (cash count per booklet, one document `bk_<first PR>`
with the counted bills and coins). Add the same kind of rule for each one that is denied.

## Access and privacy
The site is open to anyone with the link, the same as glc-inventory. Anyone with the link can view and edit receipts,
and the Firebase web config is visible in the page source (this is normal for Firebase web apps; rules are what protect data).

## Run locally
Modules need a web server:

```
python -m http.server 8123
```

Then open http://localhost:8123. Logic tests: `node test.mjs`, or open `test.html` through the server.

## Tutorial video
`tutorial/pr-encoding-tutorial.mp4` is a short how-to video (about 2.5 minutes) on encoding a PR. It opens from the **Tutorial** button
in the page header. `python tutorial/build.py` rebuilds it (needs `pillow` and `imageio-ffmpeg`; uses the Windows voice).

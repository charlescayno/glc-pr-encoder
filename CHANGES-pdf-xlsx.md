# PDF and XLSX output after booklet verification

When every PR in a booklet is checked, the review summary screen now shows three extra buttons:

| Button | Output file | Matches |
|---|---|---|
| TOP Sheet PDF | `<first>-<last> TOP Sheet.pdf` | `Downloads\TOP Sheet.pdf` (PR range and date range, CASH table, ONLINE PAYMENT table) |
| Booklet Summary PDF | `<first>-<last> PR Booklet Summary.pdf` | `Downloads\PR Booklet Summary.pdf` (all receipt rows with running grand total and invoice refs, *** NOTHING FOLLOWS ***, Cash Sales / Online Payment / Total Sales, cash count, Prepared / Checked / Received By) |
| Download XLSX | `<first>-<last> PR Booklet Summary.xlsx` | Sheet "Booklet Summary" (tally, void, not used, cash count) and sheet "Receipts" (full table) |

Notes
- "Prepared By" defaults to "Ynah Orgasan" (asked on download, editable, and the last name used is remembered on this device).
- Cash count rows come from the cash count entered on the summary screen.
- Libraries (jsPDF, autotable, SheetJS) load from a CDN on first use, so an internet connection is needed for downloads.
- Code: new `export.js`, wiring in `app.js` (`exportBooklet`), `sw.js` precaches `export.js`.
- Not yet committed or pushed. Test locally with `python -m http.server 8123`, then `git add . ; git commit ; git push origin main` to publish.

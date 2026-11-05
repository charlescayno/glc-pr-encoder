# PDF and XLSX output after booklet verification

When every PR in a booklet is checked, the review summary screen now shows two extra buttons:

| Button | Output file | Matches |
|---|---|---|
| Download PDF | `<first>-<last> PR Booklet.pdf` (one letter-size PDF: page 1 is the TOP sheet, then the PR booklet summary with receipt rows, totals, cash count, signature lines) | Both sample PDFs combined |
| Download XLSX | `<first>-<last> PR Booklet Summary.xlsx` | Sheet "Booklet Summary" (tally, void, not used, cash count) and sheet "Receipts" (full table) |

Notes
- "Prepared By" is always "Ynah Orgasan" (no prompt).
- Cash count rows come from the cash count entered on the summary screen.
- Libraries (jsPDF, autotable, SheetJS) load from a CDN on first use, so an internet connection is needed for downloads.
- Code: new `export.js`, wiring in `app.js` (`exportBooklet`), `sw.js` precaches `export.js`.
- Not yet committed or pushed. Test locally with `python -m http.server 8123`, then `git add . ; git commit ; git push origin main` to publish.

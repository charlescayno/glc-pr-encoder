// Sample sheet: PR 42701-42750 (09-20-2026). Compact form: PR, items (T = Tagalog, E = English, qty), MOP ref.
// Every price is 3.00. Expanded into spreadsheet text so it goes through the same parser as a paste.
const R = [
[42701,"T10"],[42702,"T100"],[42703,"T50"],[42704,"T20 E10"],[42705,"E35 T32","INVOICE REF # 302351"],
[42706,"T100"],[42707,"T25 E25","INVOICE REF # 747086"],[42708,"T10"],[42709,"T10 E10"],[42710,"T25 E25"],
[42711,"T50 E50","INVOICE REF # 951276"],[42712,"E200 T50","INVOICE REF # 751702"],[42713,"E50 T100"],[42714,"T25 E25"],
[42715,"T50"],[42716,"E100"],[42717,"T20"],[42718,"E10"],[42719,"T10 E10"],[42720,"T10"],[42721,"T25 E25"],
[42722,"T50 E50"],[42723,"T10 E10"],[42724,"T10 E20"],[42725,"E20 T10","INVOICE REF # 675314"],
[42726,"E10","INVOICE REF # 150361"],[42727,"E10","INVOICE REF # 004626310044556"],[42728,"T10 E10"],
[42729,"T10 E10","INVOICE REF # 182977"],[42730,"E20 T10"],[42731,"T10 E10"],[42732,"T200 E50"],[42733,"E75 T75"],
[42734,"E25 T25"],[42735,"E15 T15","INVOICE REF # 423595"],[42736,"T20"],[42737,"T10 E10"],[42738,"T50"],
[42739,"T25 E25","INVOICE REF # 50145903"],[42740,"T60 E50"],[42741,"T50"],[42742,"T25 E25"],
[42743,"T50 E50","INVOICE REF # 149474"],[42744,"T50 E10"],[42745,"T50"],[42746,"E50","INVOICE REF 2B6D EF8A0F45"],
[42747,"T50 E50","INVOICE REF # 801438"],[42748,"T10"],[42749,"T5 E5"],[42750,"T75 E75"],
];
const NAME = { T: "Gospel Tract Tagalog", E: "Gospel Tract English" };
export const SHEET_0920 = R.map(([pr, items, mop = ""]) =>
    items.split(" ").map((it, i) => {
        const q = Number(it.slice(1));
        return [i ? "" : "09-20-2026", i ? "" : pr, i ? "" : "Annonymous", NAME[it[0]], q, "3.00", (q * 3).toFixed(2), "", i ? "" : mop].join("\t");
    }).join("\n")
).join("\n");

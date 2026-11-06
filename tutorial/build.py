"""Builds tutorial/pr-encoding-tutorial.mp4: 1920x1080 explainer on encoding a Provisional Receipt.
Run: python tutorial/build.py   (needs pillow, imageio-ffmpeg; uses the Windows voice)
"""
import os, subprocess, wave, shutil
from PIL import Image, ImageDraw, ImageFont
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WORK = os.path.join(HERE, "work")
W, H = 1920, 1080
BLUE, TEAL, DARK, RED, ORANGE = "#009ee2", "#2a9d99", "#0f172a", "#dc2626", "#f59e0b"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
FONTS = {}


def font(size, bold=False):
    key = (size, bold)
    if key not in FONTS:
        FONTS[key] = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf", size)
    return FONTS[key]


def box(d, r, fill="#ffffff", outline="#94a3b8", w=2, rad=10):
    d.rounded_rectangle(r, radius=rad, fill=fill, outline=outline, width=w)


def text(d, xy, s, size=26, bold=False, fill="#0f172a", anchor="la"):
    d.text(xy, s, font=font(size, bold), fill=fill, anchor=anchor)


def wrap(s, size, width, bold=False):
    words, lines, cur = s.split(), [], ""
    for w in words:
        t = (cur + " " + w).strip()
        if font(size, bold).getlength(t) <= width:
            cur = t
        else:
            lines.append(cur)
            cur = w
    return lines + [cur]


# ---------- mock of the app ----------
R = {  # named rectangles used for highlights
    "status": (1560, 28, 1860, 72), "mop": (215, 290, 445, 340), "ref": (465, 290, 695, 340), "split": (715, 290, 885, 340),
    "pr": (1090, 265, 1330, 315), "date": (1090, 325, 1450, 375), "warn": (1475, 262, 1735, 380),
    "buyer": (420, 450, 760, 495), "row1": (190, 560, 1520, 606), "row2": (190, 612, 1520, 658), "addrow": (190, 705, 360, 750),
    "total": (1380, 700, 1735, 752), "submit": (1380, 812, 1735, 866), "void": (190, 815, 330, 866), "unused": (350, 815, 530, 866),
    "table": (190, 250, 1735, 600), "edit": (1655, 313, 1715, 363), "card": (160, 190, 1760, 880),
}


def money(n):
    return f"{n:,.2f}"


def draw_app(st):
    img = Image.new("RGB", (W, H), "#eef2f7")
    d = ImageDraw.Draw(img)
    d.rectangle((0, 0, W, 100), fill=BLUE)
    logo = Image.open(os.path.join(ROOT, "glc-logo.png")).convert("RGBA")
    logo.thumbnail((70, 70))
    img.paste(logo, (40, 15), logo)
    text(d, (130, 22), "PR Encoder", 40, True, "#ffffff")
    ok = st.get("online", True)
    box(d, R["status"], "#ffffff", "#ffffff", 1, 22)
    d.ellipse((1580, 42, 1596, 58), fill="#22c55e" if ok else "#f59e0b")
    text(d, (1612, 38), "Online" if ok else "Local only", 24, True, "#166534")
    # card
    box(d, R["card"], "#ffffff", "#cbd5e1", 2, 18)
    if st.get("table"):
        text(d, (190, 205), "Output", 32, True)
        draw_table(d, st["table"], st.get("grand"))
        return img, d
    # form of payment
    box(d, (190, 215, 900, 385), "#f0fdfa", TEAL, 3)
    text(d, (215, 225), "FORM OF PAYMENT", 22, True, TEAL)
    mop = st.get("mop", "Cash")
    text(d, (215, 262), "MOP", 18, False, "#475569")
    box(d, R["mop"]); text(d, (232, 300), mop, 26); d.polygon([(420, 308), (434, 308), (427, 320)], fill="#475569")
    if st.get("ref") is not None:
        text(d, (465, 262), "Invoice No." if mop == "Invoice" else "Reference No.", 18, False, "#475569")
        box(d, R["ref"]); text(d, (480, 300), st["ref"], 26)
    box(d, R["split"], "#e2e8f0", "#94a3b8"); text(d, (800, 315), "Split payment", 22, True, anchor="mm")
    text(d, (190, 395 - 4), "", 10)
    # receipt header
    text(d, (1090, 218), "PROVISIONAL RECEIPT", 30, True, "#dc2626")
    text(d, (1030, 272), "N\u00ba", 30, True, "#dc2626")
    box(d, R["pr"], "#ffffff", "#dc2626"); text(d, (1105, 270), st.get("pr", ""), 30, True, "#dc2626")
    text(d, (980, 332), "Date:", 26, True)
    box(d, R["date"]); text(d, (1105, 332), st.get("date", ""), 28)
    if st.get("warn"):
        err = st.get("warn_err", False)
        box(d, R["warn"], "#fee2e2" if err else "#fef3c7", "#dc2626" if err else ORANGE, 2, 8)
        for i, ln in enumerate(wrap(st["warn"], 19, 235)):
            text(d, (1487, 270 + i * 24), ln, 19, False, "#7f1d1d" if err else "#78350f")
    # bands
    d.rectangle((190, 405, 1735, 442), fill=TEAL); text(d, (205, 410), "Received From:", 24, True, "#fff")
    text(d, (205, 458), "Registered Name:", 24, True)
    box(d, R["buyer"]); text(d, (435, 454), st.get("buyer", ""), 26)
    d.rectangle((190, 515, 1735, 552), fill=TEAL); text(d, (205, 520), "Description of Transaction / Nature of Service", 24, True, "#fff")
    items = st.get("items", [("", "", "")])
    for i, (desc, qty, price) in enumerate(items[:3]):
        y = 560 + i * 52
        box(d, (190, y, 1000, y + 46)); text(d, (205, y + 7), desc, 26)
        box(d, (1020, y, 1120, y + 46)); text(d, (1070, y + 7), str(qty), 26, anchor="ma")
        box(d, (1140, y, 1280, y + 46)); text(d, (1155, y + 7), str(price), 26)
        if qty != "" and price != "":
            text(d, (1300, y + 7), "\u20b1 " + money(qty * price), 26, True)
    box(d, R["addrow"], "#e2e8f0", "#94a3b8"); text(d, (275, 727), "+ Add item", 22, True, anchor="mm")
    tot = sum(q * p for _, q, p in items if q != "" and p != "")
    box(d, R["total"], "#f0fdfa", TEAL, 3); text(d, (1396, 716), "TOTAL PAID", 20, True, TEAL)
    text(d, (1720, 712), "\u20b1 " + money(tot), 28, True, anchor="ra")
    text(d, (190, 782), "Cancelled / blank sheet", 20, False, "#475569")
    box(d, R["void"], "#fff", RED); text(d, (260, 840), "Void", 24, True, RED, "mm")
    box(d, R["unused"], "#fff", "#64748b"); text(d, (440, 840), "Not used", 24, True, "#475569", "mm")
    box(d, R["submit"], BLUE, BLUE, 1, 12); text(d, (1557, 839), "+ Add PR to output", 26, True, "#fff", "mm")
    return img, d


def draw_table(d, rows, grand):
    cols = [("DATE", 190, 140), ("PR NUMBER", 335, 125), ("BUYER", 465, 160), ("SOLD ITEMS", 625, 400), ("QTY", 1040, 70),
            ("UNIT PRICE", 1105, 130), ("TOTAL", 1235, 110), ("GRAND TOTAL", 1350, 150), ("MOP", 1500, 160)]
    d.rectangle((190, 250, 1735, 292), fill="#e2e8f0")
    for name, x, _ in cols:
        text(d, (x + 8, 258), name, 20, True, "#475569")
    y = 300
    run = 0
    for r in rows:
        run += r["total"]
        vals = [r.get("date", ""), r.get("pr", ""), r.get("buyer", ""), r["desc"], r["qty"], money(r["price"]), money(r["total"]), money(run), r.get("mop", "")]
        for (name, x, w), v in zip(cols, vals):
            text(d, (x + 8, y + 6), str(v), 22)
        d.line((190, y + 50, 1735, y + 50), fill="#e2e8f0", width=2)
        d.polygon([(1672, y + 36), (1680, y + 38), (1692, y + 16), (1686, y + 12)], fill=BLUE)
        y += 54
    d.rectangle((190, 700, 1735, 770), fill="#f0fdfa", outline=TEAL, width=3)
    text(d, (215, 720), "Total Sales", 30, True, TEAL)
    text(d, (1710, 720), "\u20b1 " + money(run), 32, True, anchor="ra")


def finish(img, d, step, title, caption, hi=None, note=None, note_pos="above"):
    if hi:
        x0, y0, x1, y1 = R[hi]
        for g, a in ((10, 70), (6, 140)):
            d.rounded_rectangle((x0 - g, y0 - g, x1 + g, y1 + g), radius=14, outline=ORANGE, width=3)
        d.rounded_rectangle((x0 - 5, y0 - 5, x1 + 5, y1 + 5), radius=12, outline=ORANGE, width=7)
        if note:
            tw = max(font(24, True).getlength(l) for l in wrap(note, 24, 520, True)) + 40
            lines = wrap(note, 24, 520, True)
            bh = 26 * len(lines) + 24
            bx = min(max(x0, 170), 1750 - tw)
            by = y0 - bh - 22 if note_pos == "above" else y1 + 22
            d.rounded_rectangle((bx, by, bx + tw, by + bh), radius=12, fill=ORANGE)
            for i, ln in enumerate(lines):
                text(d, (bx + 20, by + 12 + i * 26), ln, 24, True, DARK)
    # title row and caption bar
    text(d, (160, 118), f"STEP {step}", 24, True, BLUE)
    text(d, (290, 108), title, 40, True, DARK)
    d.rectangle((0, 920, W, H), fill=DARK)
    lines = wrap(caption, 36, 1680)
    y = 1000 - 22 * len(lines) + 4
    for i, ln in enumerate(lines):
        text(d, (W // 2, y + i * 46), ln, 36, False, "#ffffff", "ma")
    return img


def title_card(title, sub):
    img = Image.new("RGB", (W, H), BLUE)
    d = ImageDraw.Draw(img)
    logo = Image.open(os.path.join(ROOT, "glc-logo.png")).convert("RGBA")
    logo.thumbnail((260, 260))
    img.paste(logo, (W // 2 - logo.width // 2, 190), logo)
    for i, ln in enumerate(wrap(title, 76, 1500, True)):
        text(d, (W // 2, 520 + i * 92), ln, 76, True, "#ffffff", "ma")
    text(d, (W // 2, 760), sub, 38, False, "#e0f2fe", "ma")
    return img


def checklist_card():
    img = Image.new("RGB", (W, H), BLUE)
    d = ImageDraw.Draw(img)
    text(d, (W // 2, 120), "Quick recap", 72, True, "#fff", "ma")
    items = ["1  PR number from the paper receipt", "2  Date (MM-DD-YYYY)", "3  Buyer (Anonymous if no name)", "4  Sold items: shorthand, quantity, price",
             "5  Form of payment (Cash, online, or split)", "6  Add PR to output (Ctrl+Enter)", "7  Void (Alt+V) or Not used (Alt+U) when needed"]
    for i, s in enumerate(items):
        text(d, (400, 270 + i * 82), s, 46, i < 6 or True, "#ffffff")
    text(d, (W // 2, 900), "Always compare with the paper receipt before you add.", 40, True, "#fde68a", "ma")
    return img


# ---------- scenes: (narration, [beats]) ; a beat is a function returning an image ----------
def app_beat(step, title, caption, hi=None, note=None, pos="above", **st):
    def make():
        img, d = draw_app(st)
        return finish(img, d, step, title, caption, hi, note, pos)
    return make


GTE = ("Gospel Tracts English (New)", 10, 3)
B7 = ("GLC Book 7: The Family Life (New)", 1, 80)
ROW = {"date": "11-06-2026", "pr": 42757, "buyer": "Anonymous", "desc": GTE[0], "qty": 10, "price": 3, "total": 30, "mop": ""}
ROW2 = {"date": "", "pr": "", "buyer": "", "desc": B7[0], "qty": 1, "price": 80, "total": 80, "mop": ""}
OLD = {"date": "11-06-2026", "pr": 42756, "buyer": "Maria Santos", "desc": "Real Talk Booklet", "qty": 3, "price": 25, "total": 75, "mop": "INVOICE REF # 689746"}

SCENES = [
    ("Welcome! In this video, you will learn how to encode a Provisional Receipt, or P R, using the P R Encoder. Once you get the hang of it, one receipt takes about a minute.",
     [lambda: title_card("How to Encode a Provisional Receipt (PR)", "PR Encoder tutorial for new volunteers")]),
    ("Open the P R Encoder in your browser. Look at the badge at the top right. Online means your work is saved to the cloud. If it says Local only, your receipts are saved on this device only, so tell your admin.",
     [app_beat(1, "Open the PR Encoder", "Online = saved to the cloud. Local only = saved on this device only.", "status", "Check the status badge", "below")]),
    ("First, type the P R number printed on your paper receipt. Then type the date in month, day, year format. If you skip a number, the app warns you, so double check the paper.",
     [app_beat(2, "PR number and date", "Type the PR number printed on the paper receipt.", "pr", "PR number from the paper", "below", pr="42757"),
      app_beat(2, "PR number and date", "Type the date as MM-DD-YYYY.", "date", "Format: MM-DD-YYYY", "below", pr="42757", date="11-06-2026"),
      app_beat(2, "PR number and date", "Skipped a number? The app warns you. Check the paper.", "warn", "Warning: number skipped", "below", pr="42757", date="11-06-2026",
               warn="PR #42757 skips ahead. The next expected number is #42756.")]),
    ("Next, the buyer. If the sheet has no name, leave it as Anonymous. Otherwise, type the registered name.",
     [app_beat(3, "Buyer", "No name on the sheet? Leave it as Anonymous.", "buyer", "Default: Anonymous", "below", pr="42757", date="11-06-2026", buyer="Anonymous"),
      app_beat(3, "Buyer", "Name written on the sheet? Type the registered name.", "buyer", "Type the registered name", "below", pr="42757", date="11-06-2026", buyer="Maria Santos")]),
    ("Now the sold items. Click the item box and type a shorthand code, like G T E for Gospel Tracts English, or B 7 for Book 7, then press Enter. The price fills in automatically. Set the quantity. To add another item, press Alt N. The total updates as you go.",
     [app_beat(4, "Sold items", "Type a shorthand code, like gte or b7, then press Enter.", "row1", "Shorthand: gte + Enter", "above", pr="42757", date="11-06-2026", buyer="Anonymous", items=[("gte", "", "")]),
      app_beat(4, "Sold items", "The item name and price fill in. Set the quantity.", "row1", "Item, quantity, price", "above", pr="42757", date="11-06-2026", buyer="Anonymous", items=[GTE]),
      app_beat(4, "Sold items", "Alt+N adds another item. The total updates.", "total", "Total updates as you go", "below", pr="42757", date="11-06-2026", buyer="Anonymous", items=[GTE, B7])]),
    ("Choose the form of payment. Cash is the default. For Invoice, G Cash, or Bank Transfer, pick the method and type the reference number. If the buyer paid part in cash and part online, click Split payment and enter both amounts.",
     [app_beat(5, "Form of payment", "Cash is the default.", "mop", "Cash by default", "below", pr="42757", date="11-06-2026", buyer="Anonymous", items=[GTE, B7]),
      app_beat(5, "Form of payment", "Online payment? Pick the method and type the reference number.", "ref", "Type the reference number", "below", pr="42757", date="11-06-2026", buyer="Anonymous", items=[GTE, B7], mop="Invoice", ref="689746"),
      app_beat(5, "Form of payment", "Part cash, part online? Use Split payment (Alt+S).", "split", "Split payment (Alt+S)", "below", pr="42757", date="11-06-2026", buyer="Anonymous", items=[GTE, B7], mop="Invoice", ref="689746")]),
    ("When everything matches the paper receipt, click Add P R to output, or press Control Enter. The receipt appears in the output table, and the grand total updates.",
     [app_beat(6, "Add to output", "Everything matches the paper? Click Add PR to output, or press Ctrl+Enter.", "submit", "Ctrl+Enter", "above", pr="42757", date="11-06-2026", buyer="Anonymous", items=[GTE, B7]),
      app_beat(6, "Add to output", "Your receipt shows in the table. The grand total updates.", "table", None, table=[ROW, ROW2])]),
    ("Some sheets are not sold. If a P R was cancelled, press Alt V to mark it Void. If a number was skipped or left blank, press Alt U for Not used. This keeps your booklet complete.",
     [app_beat(7, "Void and Not used", "Cancelled sheet: Void (Alt+V).", "void", "Cancelled sheet: Alt+V", "above", pr="42758"),
      app_beat(7, "Void and Not used", "Skipped or blank sheet: Not used (Alt+U).", "unused", "Skipped or blank: Alt+U", "above", pr="42758")]),
    ("Made a mistake? Click the pencil icon on any row to edit it. The app will not let you reuse a number that already exists, so you cannot encode the same P R twice.",
     [app_beat(8, "Fix mistakes", "Click the pencil icon on a row to edit it.", "edit", "Edit a receipt", "below", table=[OLD, ROW, ROW2]),
      app_beat(8, "Fix mistakes", "A number that already exists is blocked, so no double encoding.", "warn", "Duplicate PR number", "below", pr="42757", date="11-06-2026",
               warn="PR #42757 already exists. Use a different number, or edit the existing receipt.", warn_err=True)]),
    ("That's it! Remember: number, date, buyer, items, payment, then add. Always compare with the paper receipt. Thanks for watching!",
     [checklist_card]),
]


# ---------- audio + video ----------
def wav_len(p):
    with wave.open(p) as w:
        return w.getnframes() / w.getframerate()


def speak(s, wav):
    """Offline Windows voice (Zira) to a wav file, through PowerShell System.Speech."""
    txt = os.path.join(WORK, "narration.txt")
    with open(txt, "w", encoding="utf-8") as f:
        f.write(s)
    ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
          "try { $s.SelectVoice('Microsoft Zira Desktop') } catch {}; $s.Rate = 0; "
          f"$s.SetOutputToWaveFile('{wav}'); $s.Speak([IO.File]::ReadAllText('{txt}')); $s.Dispose()")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True, timeout=120)
    if r.returncode or not os.path.exists(wav):
        raise RuntimeError(r.stderr)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode:
        raise RuntimeError(r.stderr[-1500:])


def main():
    shutil.rmtree(WORK, ignore_errors=True)
    os.makedirs(WORK)
    clips = []
    for si, (narr, beats) in enumerate(SCENES, 1):
        wav = os.path.join(WORK, f"s{si:02d}.wav")
        speak(narr, wav)
        dur = wav_len(wav) + 1.2
        per = dur / len(beats)
        parts = []
        for bi, make in enumerate(beats):
            png = os.path.join(WORK, f"s{si:02d}_{bi}.png")
            make().save(png)
            seg = os.path.join(WORK, f"s{si:02d}_{bi}.mp4")
            fade = f"fade=t=in:st=0:d=0.35,fade=t=out:st={per - 0.35:.2f}:d=0.35"
            run([FFMPEG, "-y", "-loop", "1", "-framerate", "30", "-t", f"{per:.3f}", "-i", png, "-vf", f"{fade},format=yuv420p",
                 "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", seg])
            parts.append(seg)
        lst = os.path.join(WORK, f"s{si:02d}.txt")
        with open(lst, "w") as f:
            f.writelines(f"file '{p.replace(os.sep, '/')}'\n" for p in parts)
        clip = os.path.join(WORK, f"scene{si:02d}.mp4")
        run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-i", wav, "-af", "adelay=500|500,apad", "-c:v", "libx264", "-preset", "veryfast",
             "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-shortest", "-t", f"{dur:.3f}", clip])
        clips.append(clip)
        print(f"scene {si}: {dur:.1f}s")
    lst = os.path.join(WORK, "all.txt")
    with open(lst, "w") as f:
        f.writelines(f"file '{p.replace(os.sep, '/')}'\n" for p in clips)
    out = os.path.join(HERE, "pr-encoding-tutorial.mp4")
    run([FFMPEG, "-y", "-f", "concat", "-safe", "0", "-i", lst, "-c", "copy", out])
    print("done:", out)


if __name__ == "__main__":
    main()

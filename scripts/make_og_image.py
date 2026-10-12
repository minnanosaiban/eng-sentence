"""Regenerate og-image-square.png and og-image-large.png (same layout as sidenote / pdf-tools).

Requires Pillow and a Japanese-capable TrueType font (Meiryo on Windows).
Run: python scripts/make_og_image.py"""

from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = r"C:\Windows\Fonts\meiryo.ttc"
FONT_BOLD_PATH = r"C:\Windows\Fonts\meiryob.ttc"
OUT_DIR = Path(__file__).resolve().parent.parent / "public"

TITLE = "英文学習アプリ"
DESC_LINES = ["英文を、区切り・品詞・", "和訳・音声で学ぶ。"]
SUB_LINE = "TOEIC対策／暗号化クラウド同期つき"
SQUARE_LINES = ["英文", "学習"]
URL = "eng-sentence"

BG = "#fafafa"
TEXT = "#0a0a0a"
MUTED = "#4d4d4d"
BORDER = "#e5e5e5"
BODY_BG = "#f2f2f2"
LINE = "#eceef1"
LINE_STRONG = "#d7dade"
STAMP = "#b93226"


def font(size, bold=False):
    return ImageFont.truetype(FONT_BOLD_PATH if bold else FONT_PATH, size, index=0)


def bar(d, x, y, w, h, color=LINE, radius=None):
    d.rounded_rectangle([x, y, x + w, y + h], radius=radius if radius is not None else h / 2, fill=color)


def browser_frame(img):
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = 664, 146, 1144, 486
    d.rounded_rectangle([x0, y0, x1, y1], radius=18, fill="#ffffff", outline=BORDER, width=1)
    d.rounded_rectangle([x0, y0, x1, y0 + 46], radius=18, fill="#f3f3f3")
    d.rectangle([x0, y0 + 28, x1, y0 + 46], fill="#f3f3f3")
    d.line([x0, y0 + 46, x1, y0 + 46], fill=BORDER, width=1)
    for i, c in enumerate(("#ff5f57", "#ffbd2e", "#28c840")):
        cx = x0 + 24 + i * 20
        d.ellipse([cx - 6, y0 + 17, cx + 6, y0 + 29], fill=c)
    d.rounded_rectangle([x0 + 92, y0 + 12, x1 - 24, y0 + 34], radius=11, fill="#ffffff", outline=BORDER, width=1)
    d.text((x0 + 106, y0 + 16), URL, font=font(13), fill="#71717a")
    d.rectangle([x0 + 1, y0 + 47, x1 - 1, y1 - 1], fill=BODY_BG)
    return d, (x0, y0, x1, y1)


CHUNKS = (("Candidates", "#2563eb", 120), ("are advised", "#ea580c", 108), ("to arrive", "#16a34a", 84), ("early.", "#7c3aed", 60))


def draw_mock(img):
    d, (x0, y0, x1, y1) = browser_frame(img)
    px0, py0, px1, py1 = x0 + 22, y0 + 66, x1 - 22, y1 - 22
    d.rounded_rectangle([px0, py0, px1, py1], radius=12, fill="#ffffff", outline=BORDER, width=1)
    # 英文を区切りごとに色分け（区切りの下に線と品詞のラベル）
    x = px0 + 30
    y = py0 + 46
    f = font(19, bold=True)
    for text, color, w in CHUNKS:
        d.text((x, y), text, font=f, fill=TEXT)
        tw = d.textlength(text, font=f)
        d.rounded_rectangle([x, y + 32, x + tw, y + 36], radius=2, fill=color)
        bar(d, x, y + 46, tw * 0.8, 7, color, radius=3)
        x += tw + 12
    # 和訳・文法の行
    bar(d, px0 + 30, py0 + 122, 330, 10)
    bar(d, px0 + 30, py0 + 146, 250, 10)
    # 学習タブ風のボタン
    for i, (t, on) in enumerate((("全文", False), ("区切り", True), ("品詞", False), ("和訳", False))):
        bx = px0 + 30 + i * 92
        d.rounded_rectangle([bx, py1 - 62, bx + 80, py1 - 30], radius=8, fill="#1e2126" if on else "#f2f2f2", outline=BORDER)
        d.text((bx + 40, py1 - 46), t, font=font(14, bold=on), fill="#ffffff" if on else MUTED, anchor="mm")


def make_large():
    w, h = 1200, 630
    img = Image.new("RGB", (w, h), BG)
    d = ImageDraw.Draw(img)

    title_font = font(46, bold=True)
    tb = d.textbbox((0, 0), TITLE, font=title_font)
    desc_font, sub_font = font(26), font(16)
    line_h = 42
    total = (tb[3] - tb[1]) + 28 + line_h * len(DESC_LINES) + 26
    top = (h - total) / 2
    d.text((72, top - tb[1]), TITLE, font=title_font, fill=TEXT)
    ty = top + (tb[3] - tb[1]) + 28
    for t in DESC_LINES:
        d.text((72, ty), t, font=desc_font, fill=MUTED)
        ty += line_h
    d.text((72, ty + 8), SUB_LINE, font=sub_font, fill="#71717a")

    draw_mock(img)
    img.save(OUT_DIR / "og-image-large.png")


def make_square():
    size = 630
    pad_x = 34
    line1, line2 = SQUARE_LINES
    scratch = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    avail_w = size - 2 * pad_x
    font_size = 260
    while font_size > 10:
        f = font(font_size)
        b1 = scratch.textbbox((0, 0), line1, font=f)
        b2 = scratch.textbbox((0, 0), line2, font=f)
        if max(b1[2] - b1[0], b2[2] - b2[0]) <= avail_w:
            break
        font_size -= 2
    h1, h2 = b1[3] - b1[1], b2[3] - b2[1]
    gap = round(font_size * 0.35)
    top = (size - (h1 + h2 + gap)) / 2

    img = Image.new("RGB", (size, size), "#000000")
    d = ImageDraw.Draw(img)
    d.text(((size - (b1[2] - b1[0])) / 2 - b1[0], top - b1[1]), line1, font=f, fill="#ffffff")
    d.text(((size - (b2[2] - b2[0])) / 2 - b2[0], top + h1 + gap - b2[1]), line2, font=f, fill="#ffffff")
    img.save(OUT_DIR / "og-image-square.png")


if __name__ == "__main__":
    make_square()
    make_large()
    print("wrote", OUT_DIR / "og-image-square.png")
    print("wrote", OUT_DIR / "og-image-large.png")

#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent
W, H = 1200, 630
INK = (0, 0, 0)
PAPER = (244, 243, 239)
ACCENT = (255, 77, 0)
SLATE = (90, 90, 96)

BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"
REG = "/System/Library/Fonts/Supplemental/Arial.ttf"

TRUST_NAMES = ["Tenet Healthcare", "Omni Hotels & Resorts", "Oakley", "Ray-Ban", "Arnette", "Revo"]
TRUST_EYEBROW = "METHODOLOGY DISTILLED FROM IN-HOUSE WORK AT"

pages = [
    ("home", "SXO Audits for\nSEO, AEO & GEO", "$5,000 one-time audit. No retainer. No upsell."),
    ("services", "One audit.\nEvery engine.", "SEO, AEO, GEO, and the off-site content engines quote."),
    ("how-it-works", "How the\nSXO Audit Works", "Six fixed steps. One deliverable."),
    ("why-sxo", "SEO vs AEO\nvs GEO vs SXO", "The post-ten-blue-links search layer."),
    ("pricing", "One price.\nPublic.", "$5,000 one-time. Fixed scope. No retainer."),
    ("about", "A narrow practice,\non purpose.", "Audits only. Senior-led. Fixed fee."),
]

def wrap_lines(text):
    return text.split("\n")

for slug, headline, sub in pages:
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    # Top black band with WC mark + wordmark
    d.rectangle([(0, 0), (W, 80)], fill=INK)
    mark_font = ImageFont.truetype(BLACK, 34)
    d.text((60, 22), "WC", font=mark_font, fill=PAPER)
    word_font = ImageFont.truetype(BOLD, 22)
    d.text((115, 28), "WEB CITED", font=word_font, fill=PAPER)
    label_font = ImageFont.truetype(BOLD, 18)
    label = "SEARCH EXPERIENCE OPTIMIZATION"
    bbox = d.textbbox((0, 0), label, font=label_font)
    d.text((W - 60 - (bbox[2] - bbox[0]), 30), label, font=label_font, fill=PAPER)

    # Accent bar
    d.rectangle([(0, 80), (160, 92)], fill=ACCENT)

    # Headline
    head_font = ImageFont.truetype(BLACK, 104)
    y = 170
    for line in wrap_lines(headline):
        d.text((60, y), line, font=head_font, fill=INK)
        y += 118

    # Subhead
    sub_font = ImageFont.truetype(BOLD, 34)
    d.text((60, H - 190), sub, font=sub_font, fill=SLATE)

    # Trust strip: small eyebrow + flattened brand-experience list.
    # Keeps the copy-level promise honest (past in-house work, not clients)
    # and matches the on-page experience-strip treatment.
    eyebrow_font = ImageFont.truetype(BOLD, 14)
    d.text((60, H - 115), TRUST_EYEBROW, font=eyebrow_font, fill=SLATE)
    trust_font = ImageFont.truetype(BOLD, 20)
    trust_line = "  ·  ".join(TRUST_NAMES)
    d.text((60, H - 90), trust_line, font=trust_font, fill=INK)

    # Bottom URL
    url_font = ImageFont.truetype(BOLD, 22)
    d.text((60, H - 55), "web-cited.com", font=url_font, fill=INK)

    img.save(OUT / f"{slug}.png", "PNG", optimize=True)
    print(f"wrote {slug}.png")

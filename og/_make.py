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

pages = [
    ("home", "SXO Audits for\nSEO, AEO & GEO", "$5,000 one-time audit. $20/mo monitor."),
    ("services", "SXO Audit\n+ Monitor", "$5K audit. $20/mo citation tracking."),
    ("how-it-works", "How the\nSXO Audit Works", "Six steps. Four weeks. Fixed price."),
    ("why-sxo", "SEO vs AEO\nvs GEO vs SXO", "The post-ten-blue-links search layer."),
    ("pricing", "Two prices.\nBoth public.", "$5,000 one-time. $20/month. No retainer."),
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
    d.text((60, H - 130), sub, font=sub_font, fill=SLATE)

    # Bottom URL
    url_font = ImageFont.truetype(BOLD, 22)
    d.text((60, H - 55), "k0kesh.github.io/web-cited", font=url_font, fill=INK)

    img.save(OUT / f"{slug}.png", "PNG", optimize=True)
    print(f"wrote {slug}.png")

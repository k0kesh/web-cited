#!/usr/bin/env python3
"""Generate the OG / Twitter card image for the Invisible 10 study page.

Output: og/invisible-10-compliance.png  (1200 x 630 PNG)

Uses the SITE's accent color (#CC0000 red) not the orange used on the
other OG images, because this image is for the research study page
specifically and that page's red eyebrow is the visual anchor.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent
W, H = 1200, 630
INK = (0, 0, 0)
PAPER = (244, 243, 239)
ACCENT = (204, 0, 0)
SLATE_PAPER = (180, 178, 172)

BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"

img = Image.new("RGB", (W, H), INK)
d = ImageDraw.Draw(img)

# Header strip (same proportions as other OGs)
mark_font = ImageFont.truetype(BLACK, 34)
d.text((60, 30), "WC", font=mark_font, fill=PAPER)
word_font = ImageFont.truetype(BOLD, 22)
d.text((115, 36), "WEB CITED", font=word_font, fill=PAPER)
label_font = ImageFont.truetype(BOLD, 18)
label = "RESEARCH"
bbox = d.textbbox((0, 0), label, font=label_font)
d.text((W - 60 - (bbox[2] - bbox[0]), 38), label, font=label_font, fill=PAPER)

# Accent bar in red (mirrors the study page's red top border)
d.rectangle([(0, 100), (160, 112)], fill=ACCENT)

# Red eyebrow
eyebrow_font = ImageFont.truetype(BOLD, 18)
d.text((60, 150), "THE INVISIBLE 10 / COMPLIANCE / MAY 2026", font=eyebrow_font, fill=ACCENT)

# Massive headline (two lines to fit cleanly)
head_font = ImageFont.truetype(BLACK, 156)
d.text((60, 200), "ZERO OF", font=head_font, fill=PAPER)
d.text((60, 360), "600.", font=head_font, fill=PAPER)

# Subhead
sub_font = ImageFont.truetype(BOLD, 28)
d.text((60, 540), "10 funded compliance vendors. None cited by AI search.", font=sub_font, fill=PAPER)

# Bottom URL
url_font = ImageFont.truetype(BOLD, 18)
d.text((60, 580), "web-cited.com/research/compliance/2026-05", font=url_font, fill=SLATE_PAPER)

out_path = OUT / "invisible-10-compliance.png"
img.save(out_path, "PNG", optimize=True)
print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")

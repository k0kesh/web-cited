#!/usr/bin/env python3
"""Generate an OG / Twitter card image for any research study page.

Usage:
    python3 _make_research.py \\
        --slug devtools-2026-05 \\
        --eyebrow "THE INVISIBLE 10 / DEVTOOLS / MAY 2026" \\
        --big-line1 "ZERO OF" \\
        --big-line2 "600." \\
        --subtitle "10 funded developer-tools brands. None cited by AI search." \\
        --url "web-cited.com/research/devtools/2026-05"

Output: og/{slug}.png  (1200 x 630 PNG)
"""
from __future__ import annotations
import argparse
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT_DIR = Path(__file__).parent
W, H = 1200, 630
INK = (0, 0, 0)
PAPER = (244, 243, 239)
ACCENT = (204, 0, 0)
SLATE_PAPER = (180, 178, 172)
BLACK = "/System/Library/Fonts/Supplemental/Arial Black.ttf"
BOLD = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


def make(slug, eyebrow, big_line1, big_line2, subtitle, url):
    img = Image.new("RGB", (W, H), INK)
    d = ImageDraw.Draw(img)

    mark_font = ImageFont.truetype(BLACK, 34)
    d.text((60, 30), "WC", font=mark_font, fill=PAPER)
    word_font = ImageFont.truetype(BOLD, 22)
    d.text((115, 36), "WEB CITED", font=word_font, fill=PAPER)
    label_font = ImageFont.truetype(BOLD, 18)
    label = "RESEARCH"
    bbox = d.textbbox((0, 0), label, font=label_font)
    d.text((W - 60 - (bbox[2] - bbox[0]), 38), label, font=label_font, fill=PAPER)

    d.rectangle([(0, 100), (160, 112)], fill=ACCENT)

    eyebrow_font = ImageFont.truetype(BOLD, 18)
    d.text((60, 150), eyebrow, font=eyebrow_font, fill=ACCENT)

    head_font = ImageFont.truetype(BLACK, 156)
    d.text((60, 200), big_line1, font=head_font, fill=PAPER)
    d.text((60, 360), big_line2, font=head_font, fill=PAPER)

    sub_font = ImageFont.truetype(BOLD, 28)
    d.text((60, 540), subtitle, font=sub_font, fill=PAPER)

    url_font = ImageFont.truetype(BOLD, 18)
    d.text((60, 580), url, font=url_font, fill=SLATE_PAPER)

    out_path = OUT_DIR / f"{slug}.png"
    img.save(out_path, "PNG", optimize=True)
    print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--slug", required=True)
    p.add_argument("--eyebrow", required=True)
    p.add_argument("--big-line1", required=True)
    p.add_argument("--big-line2", required=True)
    p.add_argument("--subtitle", required=True)
    p.add_argument("--url", required=True)
    args = p.parse_args()
    make(args.slug, args.eyebrow, args.big_line1, args.big_line2, args.subtitle, args.url)

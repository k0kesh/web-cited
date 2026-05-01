#!/bin/bash
# cwv-monthly.sh: Run mobile Lighthouse against every public Web Cited
# page, extract LCP/CLS/TBT (proxy for INP), assert each is in the
# Good range, and emit drift=true if any page misses.

set -euo pipefail

# Good-range thresholds (web.dev). All in ms except CLS which is
# unitless. Lighthouse reports LCP and TBT in ms, CLS as a fraction.
LCP_MAX=2500
TBT_MAX=200
CLS_MAX_X100=10  # 0.10 expressed as integer to dodge bash float ops

PAGES=(
  "https://web-cited.com/"
  "https://web-cited.com/pricing"
  "https://web-cited.com/services"
  "https://web-cited.com/how-it-works"
  "https://web-cited.com/why-sxo"
  "https://web-cited.com/start"
  "https://web-cited.com/about"
  "https://web-cited.com/faq"
  "https://web-cited.com/support"
  "https://web-cited.com/contact"
  "https://web-cited.com/privacy"
  "https://web-cited.com/terms"
)

DRIFT=false
REPORT=/tmp/cwv-report.md
TMPDIR=/tmp/cwv-runs
mkdir -p "$TMPDIR"

CHROME_BIN=$(find "$CHROME_PATH" -name 'Google Chrome for Testing' -type f 2>/dev/null | head -1)
if [ -z "$CHROME_BIN" ]; then
  CHROME_BIN=$(find "$CHROME_PATH" -name 'chrome' -type f -perm -111 2>/dev/null | head -1)
fi
export CHROME_PATH="$CHROME_BIN"

echo "## Core Web Vitals monthly audit, $(date -u +%Y-%m-%d) UTC" > "$REPORT"
echo "" >> "$REPORT"
echo "Form factor: mobile (Lighthouse default Pixel emulation). Thresholds: LCP < ${LCP_MAX}ms, TBT (INP proxy) < ${TBT_MAX}ms, CLS < 0.10." >> "$REPORT"
echo "" >> "$REPORT"
echo "| Page | LCP (ms) | TBT (ms) | CLS | Status |" >> "$REPORT"
echo "| --- | --- | --- | --- | --- |" >> "$REPORT"

for url in "${PAGES[@]}"; do
  slug=$(echo "$url" | sed 's|https://||;s|/|-|g;s|--*|-|g;s|-$||')
  out="$TMPDIR/$slug.json"
  set +e
  lighthouse "$url" \
    --quiet \
    --chrome-flags="--headless=new --no-sandbox --disable-gpu" \
    --output=json \
    --output-path="$out" \
    --only-categories=performance \
    --form-factor=mobile 2>&1 | tail -3
  rc=$?
  set -e
  if [ $rc -ne 0 ] || [ ! -s "$out" ]; then
    echo "| $url | err | err | err | LIGHTHOUSE FAILED |" >> "$REPORT"
    DRIFT=true
    continue
  fi
  lcp=$(jq -r '.audits["largest-contentful-paint"].numericValue | round' "$out")
  tbt=$(jq -r '.audits["total-blocking-time"].numericValue | round' "$out")
  cls_raw=$(jq -r '.audits["cumulative-layout-shift"].numericValue' "$out")
  cls_x100=$(awk -v v="$cls_raw" 'BEGIN{printf "%d", (v*100)+0.5}')
  cls_disp=$(awk -v v="$cls_raw" 'BEGIN{printf "%.3f", v}')

  status="OK"
  if [ "$lcp" -gt "$LCP_MAX" ] || [ "$tbt" -gt "$TBT_MAX" ] || [ "$cls_x100" -gt "$CLS_MAX_X100" ]; then
    status="OUT OF GOOD RANGE"
    DRIFT=true
  fi
  echo "| $url | $lcp | $tbt | $cls_disp | $status |" >> "$REPORT"
done

echo "" >> "$REPORT"
echo "drift=$DRIFT" >> "$GITHUB_OUTPUT"

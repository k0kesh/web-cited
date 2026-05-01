#!/bin/bash
# lighthouse-monthly.sh: Run Lighthouse against every public Web Cited
# marketing page, parse the JSON output, and emit drift=true if any
# category score on any page falls below threshold.
#
# Env (set by the caller workflow):
#   PERF_THRESHOLD   minimum Performance score 0-100 (default 95)
#   CHROME_PATH      path where Chromium was installed
#
# Outputs (written to $GITHUB_OUTPUT):
#   drift=true|false
# Side effect: writes /tmp/lighthouse-report.md (consumed by the
# notify script if drift=true).

set -euo pipefail

PERF_THRESHOLD=${PERF_THRESHOLD:-95}
A11Y_THRESHOLD=100
BP_THRESHOLD=95
SEO_THRESHOLD=100

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
REPORT=/tmp/lighthouse-report.md
TMPDIR=/tmp/lh-runs
mkdir -p "$TMPDIR"
: > "$REPORT"

# Resolve installed Chrome binary
CHROME_BIN=$(find "$CHROME_PATH" -name 'Google Chrome for Testing' -type f 2>/dev/null | head -1)
if [ -z "$CHROME_BIN" ]; then
  CHROME_BIN=$(find "$CHROME_PATH" -name 'chrome' -type f -perm -111 2>/dev/null | head -1)
fi
if [ -z "$CHROME_BIN" ]; then
  echo "::error::Chromium binary not found under $CHROME_PATH"
  exit 1
fi
export CHROME_PATH="$CHROME_BIN"

echo "## Lighthouse monthly audit, $(date -u +%Y-%m-%d) UTC" >> "$REPORT"
echo "" >> "$REPORT"
echo "Thresholds: Performance >= $PERF_THRESHOLD, Accessibility = $A11Y_THRESHOLD, Best Practices >= $BP_THRESHOLD, SEO = $SEO_THRESHOLD." >> "$REPORT"
echo "" >> "$REPORT"
echo "| Page | Perf | A11y | BP | SEO | Status |" >> "$REPORT"
echo "| --- | --- | --- | --- | --- | --- |" >> "$REPORT"

for url in "${PAGES[@]}"; do
  slug=$(echo "$url" | sed 's|https://||;s|/|-|g;s|--*|-|g;s|-$||')
  out="$TMPDIR/$slug.json"
  set +e
  lighthouse "$url" \
    --quiet \
    --chrome-flags="--headless=new --no-sandbox --disable-gpu" \
    --output=json \
    --output-path="$out" \
    --only-categories=performance,accessibility,best-practices,seo \
    --form-factor=desktop \
    --screenEmulation.disabled \
    --throttling-method=provided 2>&1 | tail -3
  rc=$?
  set -e
  if [ $rc -ne 0 ] || [ ! -s "$out" ]; then
    echo "| $url | err | err | err | err | LIGHTHOUSE FAILED |" >> "$REPORT"
    DRIFT=true
    continue
  fi

  perf=$(jq -r '.categories.performance.score * 100 | round' "$out")
  a11y=$(jq -r '.categories.accessibility.score * 100 | round' "$out")
  bp=$(jq -r '.categories["best-practices"].score * 100 | round' "$out")
  seo=$(jq -r '.categories.seo.score * 100 | round' "$out")

  status="OK"
  if [ "$perf" -lt "$PERF_THRESHOLD" ] || [ "$a11y" -lt "$A11Y_THRESHOLD" ] || [ "$bp" -lt "$BP_THRESHOLD" ] || [ "$seo" -lt "$SEO_THRESHOLD" ]; then
    status="BELOW THRESHOLD"
    DRIFT=true
  fi
  echo "| $url | $perf | $a11y | $bp | $seo | $status |" >> "$REPORT"
done

echo "" >> "$REPORT"
echo "drift=$DRIFT" >> "$GITHUB_OUTPUT"

if [ "$DRIFT" = "true" ]; then
  echo "Drift detected; a GitHub Issue will be filed." >> "$REPORT"
else
  echo "All pages meet threshold. No action required." >> "$REPORT"
fi

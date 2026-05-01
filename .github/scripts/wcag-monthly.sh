#!/bin/bash
# wcag-monthly.sh: Run axe-core via Playwright/Chromium against every
# public Web Cited marketing page. Tags wcag2a, wcag2aa, wcag21a,
# wcag21aa. Emits drift=true if any page returns >0 violations.
#
# Outputs:
#   drift=true|false  written to $GITHUB_OUTPUT
# Side effect: writes /tmp/wcag-report.md and /tmp/wcag-violations.json.

set -euo pipefail

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

REPORT=/tmp/wcag-report.md
VIOLATIONS_JSON=/tmp/wcag-violations.json
DRIFT=false

# Build the page list as a JSON array for the Node runner.
pages_json=$(printf '%s\n' "${PAGES[@]}" | jq -R . | jq -s .)
echo "$pages_json" > /tmp/wcag-pages.json

cat > /tmp/wcag-runner.mjs <<'EOF'
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import fs from 'node:fs';

const pages = JSON.parse(fs.readFileSync('/tmp/wcag-pages.json', 'utf8'));
const results = [];
const browser = await chromium.launch({ headless: true });
try {
  for (const url of pages) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    let violations = [];
    let err = null;
    try {
      await page.goto(url, { waitUntil: 'load', timeout: 30000 });
      const r = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      violations = r.violations;
    } catch (e) {
      err = String(e && e.message ? e.message : e);
    }
    await ctx.close();
    results.push({
      url,
      violationCount: violations.length,
      violations: violations.map(v => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
      })),
      error: err,
    });
  }
} finally {
  await browser.close();
}
fs.writeFileSync('/tmp/wcag-violations.json', JSON.stringify(results, null, 2));
EOF

node /tmp/wcag-runner.mjs

echo "## WCAG 2.1 AA monthly audit, $(date -u +%Y-%m-%d) UTC" > "$REPORT"
echo "" >> "$REPORT"
echo "Engine: axe-core via Playwright/Chromium. Tags: wcag2a, wcag2aa, wcag21a, wcag21aa." >> "$REPORT"
echo "" >> "$REPORT"
echo "| Page | Violations | Status |" >> "$REPORT"
echo "| --- | --- | --- |" >> "$REPORT"

while IFS= read -r row; do
  url=$(echo "$row" | jq -r '.url')
  count=$(echo "$row" | jq -r '.violationCount')
  err=$(echo "$row" | jq -r '.error // ""')
  if [ -n "$err" ]; then
    echo "| $url | err | RUN ERROR: $err |" >> "$REPORT"
    DRIFT=true
  elif [ "$count" -gt 0 ]; then
    echo "| $url | $count | VIOLATIONS |" >> "$REPORT"
    DRIFT=true
  else
    echo "| $url | 0 | OK |" >> "$REPORT"
  fi
done < <(jq -c '.[]' "$VIOLATIONS_JSON")

echo "" >> "$REPORT"

if [ "$DRIFT" = "true" ]; then
  echo "### Violation detail" >> "$REPORT"
  echo "" >> "$REPORT"
  jq -r '.[] | select(.violationCount > 0) | "**" + .url + "**\n" + (.violations | map("- " + .id + " (" + (.impact // "n/a") + ", " + (.nodes|tostring) + " nodes): " + .help) | join("\n")) + "\n"' "$VIOLATIONS_JSON" >> "$REPORT"
fi

echo "drift=$DRIFT" >> "$GITHUB_OUTPUT"

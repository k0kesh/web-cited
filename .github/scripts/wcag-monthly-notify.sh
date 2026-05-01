#!/bin/bash
# wcag-monthly-notify.sh: Open a GitHub Issue when the monthly axe-core
# audit detects any WCAG 2.1 AA violation on a public Web Cited page.

set -euo pipefail

REPORT=/tmp/wcag-report.md
TODAY=$(date -u +%Y-%m-%d)

if [ ! -s "$REPORT" ]; then
  echo "::error::notify step ran but $REPORT is missing or empty."
  exit 1
fi

BODY=$(cat <<EOF
The monthly WCAG 2.1 AA audit flagged at least one violation on a public Web Cited marketing page. Web Cited sells WCAG audits, so a self-clean track record is a brand promise: prioritize fixes.

$(cat "$REPORT")

---
_Triggered by \`.github/workflows/wcag-monthly.yml\`._
EOF
)

gh issue create \
  --repo k0kesh/wcag-audit \
  --title "Web Cited WCAG violations detected $TODAY" \
  --body "$BODY" \
  --assignee k0kesh

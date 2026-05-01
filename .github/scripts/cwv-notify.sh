#!/bin/bash
# cwv-notify.sh: Open a GitHub Issue when monthly CWV measurements drift
# out of the Good range.

set -euo pipefail

REPORT=/tmp/cwv-report.md
TODAY=$(date -u +%Y-%m-%d)

if [ ! -s "$REPORT" ]; then
  echo "::error::notify step ran but $REPORT is missing or empty."
  exit 1
fi

BODY=$(cat <<EOF
The monthly Core Web Vitals (mobile) audit flagged at least one Web Cited marketing page outside the Good range. CWV affects search ranking, so prioritize fixes to keep parity with the rest of the marketing surface.

$(cat "$REPORT")

---
_Triggered by \`.github/workflows/cwv-monthly.yml\`. Synthetic CWV varies run-to-run; if the drift is small (< 5%) and the next monthly run clears, treat it as noise._
EOF
)

gh issue create \
  --repo k0kesh/wcag-audit \
  --title "Web Cited CWV drift detected $TODAY" \
  --body "$BODY" \
  --assignee k0kesh

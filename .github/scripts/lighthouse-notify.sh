#!/bin/bash
# lighthouse-notify.sh: Open a GitHub Issue when the monthly Lighthouse
# audit detects a score below threshold. Body is the markdown report
# written by lighthouse-monthly.sh.
#
# Env:
#   GH_TOKEN     GITHUB_TOKEN with issues:write

set -euo pipefail

REPORT=/tmp/lighthouse-report.md
TODAY=$(date -u +%Y-%m-%d)

if [ ! -s "$REPORT" ]; then
  echo "::error::notify step ran but $REPORT is missing or empty."
  exit 1
fi

BODY=$(cat <<EOF
The monthly Lighthouse audit flagged at least one Web Cited marketing page below threshold.

$(cat "$REPORT")

---
_Triggered by \`.github/workflows/lighthouse-monthly.yml\`. If the regression is transient (e.g. Cloudflare cache miss timing, a one-off network blip), close this issue without action and the next monthly run will re-confirm._
EOF
)

gh issue create \
  --repo k0kesh/wcag-audit \
  --title "Web Cited Lighthouse drift detected $TODAY" \
  --body "$BODY" \
  --assignee k0kesh

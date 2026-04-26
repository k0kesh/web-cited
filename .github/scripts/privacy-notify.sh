#!/bin/bash
# privacy-notify.sh: Post a GitHub Issue in k0kesh/web-cited using the
# drift report written by privacy-audit.sh. Only invoked when the audit
# step flagged drift=true.
#
# The Issue is assigned to k0kesh, which triggers GitHub's built-in
# assignment email to the notification address on file. That email
# covers the "tell me drift happened" use case; we intentionally do
# not send a separate transactional email.
#
# Env (set by the caller workflow):
#   GH_TOKEN   GITHUB_TOKEN with issues:write
#   CUTOFF     YYYY-MM-DD of last privacy.html commit (for subject line)

set -euo pipefail

REPORT=/tmp/privacy-report.md
TODAY=$(date -u +%Y-%m-%d)

if [ ! -s "$REPORT" ]; then
  echo "::error::notify step ran but /tmp/privacy-report.md is missing or empty."
  exit 1
fi

BODY=$(cat <<EOF
Monthly privacy-policy drift check flagged changes to data-relevant files across the three Web Cited repos since the policy was last updated on **$CUTOFF**.

Review these commits and decide whether any of them introduced a new data surface (a new subprocessor, a new field collected, a new retention behavior, a new cookie/pixel/widget, or a new automated decision) that should be disclosed in \`privacy.html\`.

$(cat "$REPORT")

---
_Triggered by \`.github/workflows/privacy-audit.yml\`. If the flagged commits are unrelated to data handling, close this issue without action._
EOF
)

echo "---- Opening GitHub issue ----"
gh issue create \
  --repo k0kesh/web-cited \
  --title "Privacy policy review due: drift detected $TODAY" \
  --body "$BODY" \
  --assignee k0kesh

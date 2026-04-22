#!/bin/bash
# privacy-notify.sh — Post a GitHub Issue in k0kesh/web-cited and send an
# email via Resend, using the drift report written by privacy-audit.sh.
# Only invoked when the audit step flagged drift=true.
#
# Env (set by the caller workflow):
#   GH_TOKEN           GITHUB_TOKEN with issues:write
#   RESEND_API_TOKEN   Resend API key
#   NOTIFY_EMAIL       Recipient address (plain email, no display name)
#   CUTOFF             YYYY-MM-DD of last privacy.html commit (for subject line)

set -euo pipefail

REPORT=/tmp/privacy-report.md
TODAY=$(date -u +%Y-%m-%d)

if [ ! -s "$REPORT" ]; then
  echo "::error::notify step ran but /tmp/privacy-report.md is missing or empty."
  exit 1
fi

BODY=$(cat <<EOF
Monthly privacy-policy drift check flagged changes to data-relevant files across the three Web Cited repos since the policy was last updated on **$CUTOFF**.

Review these commits and decide whether any of them introduced a new data surface — a new subprocessor, a new field collected, a new retention behavior, a new cookie/pixel/widget, or a new automated decision — that should be disclosed in \`privacy.html\`.

$(cat "$REPORT")

---
_Triggered by \`.github/workflows/privacy-audit.yml\`. If the flagged commits are unrelated to data handling, close this issue without action._
EOF
)

echo "---- Opening GitHub issue ----"
gh issue create \
  --repo k0kesh/web-cited \
  --title "Privacy policy review due — drift detected $TODAY" \
  --body "$BODY" \
  --assignee k0kesh

if [ -z "${RESEND_API_TOKEN:-}" ]; then
  echo "::warning::RESEND_API_TOKEN not set — GitHub Issue created but email skipped."
  exit 0
fi

echo "---- Sending email via Resend ----"
PAYLOAD=$(jq -nc \
  --arg from "Web Cited Audit <intake@send.web-cited.com>" \
  --arg to "$NOTIFY_EMAIL" \
  --arg subject "Privacy policy review due — drift detected $TODAY" \
  --arg text "$BODY" \
  '{from: $from, to: [$to], subject: $subject, text: $text}')

HTTP_STATUS=$(curl -sS -o /tmp/resend-response.json -w '%{http_code}' \
  -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer $RESEND_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

if [ "$HTTP_STATUS" -lt 200 ] || [ "$HTTP_STATUS" -ge 300 ]; then
  echo "::error::Resend returned HTTP $HTTP_STATUS"
  cat /tmp/resend-response.json
  exit 1
fi

echo "Email sent. Resend response:"
cat /tmp/resend-response.json
echo

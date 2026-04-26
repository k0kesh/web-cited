#!/bin/bash
# tos-notify.sh: Post a GitHub Issue in k0kesh/web-cited using the
# drift report written by tos-audit.sh. Only invoked when the audit
# step flagged drift=true.
#
# The Issue is assigned to k0kesh, which triggers GitHub's built-in
# assignment email to the notification address on file. That email
# covers the "tell me drift happened" use case; we intentionally do
# not send a separate transactional email.
#
# Env (set by the caller workflow):
#   GH_TOKEN   GITHUB_TOKEN with issues:write
#   CUTOFF     YYYY-MM-DD of last terms.html commit (for subject line)

set -euo pipefail

REPORT=/tmp/tos-report.md
TODAY=$(date -u +%Y-%m-%d)

if [ ! -s "$REPORT" ]; then
  echo "::error::notify step ran but /tmp/tos-report.md is missing or empty."
  exit 1
fi

BODY=$(cat <<EOF
Monthly Terms of Service drift check flagged changes to TOS-relevant files across the three Web Cited repos since the contract was last updated on **$CUTOFF**.

Review these commits and decide whether any of them changed a commitment the TOS makes. Common surfaces to check:

- **Pricing** (§3, §4.3): a change to tier prices on the Site, in \`billing.py\`, in \`scope-email.ts\` TIER_META, or in invoice generation.
- **Turnaround SLAs** (§4.6): a change to TIER_TURNAROUND values in \`scope-email.ts\` or \`kickoff-email.ts\`, or to claims on \`how-it-works.html\` and \`pricing.html\`.
- **Tier definitions and deliverables** (§3, §6.1): a change to what each tier includes (URL count, prompt count, brand count, deliverable artifacts), to PDF or Playbook templates, or to the Library catalog content.
- **Refund and credit mechanics** (§4.5, §4.6, §4.7): a change to the work-commencement trigger, the SLA-credit threshold, the deliverable acceptance window, or any of those defaults in code.
- **Subprocessors** (§6.7): a new third-party API or vendor used for intake, audit, billing, or delivery.
- **Engine list** (§6.8): a new LLM engine queried, a search-engine change, or a removal that should be reflected in the algorithm-and-ecosystem-changes section.
- **Intake schema** (§5.1): a change to required intake fields, to the Customer Content license scope, or to the consent acknowledgement.
- **Customer Content retention** (§5.6, §6.1): a change to deletion timelines or to the Playbook hosting/archive lifecycle.

If the live public-host fingerprint below names a host or CDN that is not described in the privacy policy or in TOS §6.7, that also belongs in this review.

$(cat "$REPORT")

---
_Triggered by \`.github/workflows/tos-audit.yml\`. If the flagged commits do not change any TOS commitment, close this issue without action._
EOF
)

echo "---- Opening GitHub issue ----"
gh issue create \
  --repo k0kesh/web-cited \
  --title "Terms of Service review due: drift detected $TODAY" \
  --body "$BODY" \
  --assignee k0kesh

#!/bin/bash
# privacy-audit.sh — Detect whether any data-relevant code has changed
# across the three Web Cited repos since privacy.html was last updated.
#
# Exits 0 in both cases; drift/no-drift is signalled via $GITHUB_OUTPUT:
#   drift=true|false
#   cutoff=YYYY-MM-DD        (date of the last privacy.html commit)
#
# When drift=true, the markdown report is written to /tmp/privacy-report.md
# for the notify step to pick up.
#
# Allowlist rationale:
#   web-cited            — any HTML/JS/CSS that could introduce a browser
#                          tracker, embed a third-party widget, or change
#                          what the intake form collects.
#   web-cited-api        — all Worker source (every route touches PII).
#   web-cited-pipeline   — the files that handle PII or configure
#                          subprocessors; crawler/analytics files are
#                          intentionally excluded because they don't
#                          transmit user-submitted data.

set -euo pipefail

# If FORCE_CUTOFF_ISO is set (via workflow_dispatch inputs.since), use it
# as the cutoff instead of the real privacy.html commit date. Useful for
# smoke-testing the drift/notify path, or for ad-hoc "what changed since
# <date>" audits. The PRIVACY_SHA_SHORT filter still excludes the actual
# privacy.html commit from the drift list.
if [ -n "${FORCE_CUTOFF_ISO:-}" ]; then
  CUTOFF_ISO="$FORCE_CUTOFF_ISO"
  CUTOFF_DATE="${FORCE_CUTOFF_ISO%%T*}"   # strip time if present
  echo "::notice::Cutoff overridden via workflow input: $CUTOFF_ISO"
else
  CUTOFF_ISO=$(git log -1 --format=%cI -- privacy.html)
  CUTOFF_DATE=$(git log -1 --format=%cs -- privacy.html)
fi
PRIVACY_SHA_SHORT=$(git log -1 --format=%h -- privacy.html)

echo "Privacy policy last updated: $CUTOFF_DATE (commit $PRIVACY_SHA_SHORT)"

REPORT=/tmp/privacy-report.md
: > "$REPORT"

# ---- web-cited (this repo) ----
# Grep-out the privacy.html commit itself so it doesn't show up as
# "drift" against itself.
DRIFT=$(git log --since="$CUTOFF_ISO" \
  --pretty=format:'- `%h` %s _(%cs, %an)_' \
  --no-merges \
  -- start.html index.html js css 2>/dev/null | grep -v "$PRIVACY_SHA_SHORT" || true)
if [ -n "$DRIFT" ]; then
  printf '### web-cited (public site)\n\n%s\n\n' "$DRIFT" >> "$REPORT"
fi

# ---- web-cited-api (Cloudflare Worker) ----
DRIFT=$(cd /tmp/web-cited-api && git log --since="$CUTOFF_ISO" \
  --pretty=format:'- `%h` %s _(%cs, %an)_' \
  --no-merges \
  -- src 2>/dev/null || true)
if [ -n "$DRIFT" ]; then
  printf '### web-cited-api (Cloudflare Worker)\n\n%s\n\n' "$DRIFT" >> "$REPORT"
fi

# ---- web-cited-pipeline (audit pipeline) ----
DRIFT=$(cd /tmp/web-cited-pipeline && git log --since="$CUTOFF_ISO" \
  --pretty=format:'- `%h` %s _(%cs, %an)_' \
  --no-merges \
  -- \
  src/pipeline/airtable.py \
  src/pipeline/billing.py \
  src/pipeline/config.py \
  src/pipeline/crm.py \
  src/pipeline/hubspot.py \
  src/pipeline/intake.py \
  src/pipeline/mailer.py \
  src/pipeline/stripe_client.py \
  2>/dev/null || true)
if [ -n "$DRIFT" ]; then
  printf '### web-cited-pipeline (audit pipeline)\n\n%s\n\n' "$DRIFT" >> "$REPORT"
fi

# ---- Emit outputs + step summary ----
{
  echo "cutoff=$CUTOFF_DATE"
  echo "cutoff_iso=$CUTOFF_ISO"
} >> "$GITHUB_OUTPUT"

if [ -s "$REPORT" ]; then
  echo "drift=true" >> "$GITHUB_OUTPUT"
  {
    echo "## Privacy policy drift detected"
    echo ""
    echo "Policy last updated: **$CUTOFF_DATE**"
    echo ""
    cat "$REPORT"
  } >> "$GITHUB_STEP_SUMMARY"
  echo "---- Drift report ----"
  cat "$REPORT"
else
  echo "drift=false" >> "$GITHUB_OUTPUT"
  {
    echo "## No drift"
    echo ""
    echo "No data-surface changes since privacy policy was last updated on **$CUTOFF_DATE**."
  } >> "$GITHUB_STEP_SUMMARY"
  echo "No drift."
fi

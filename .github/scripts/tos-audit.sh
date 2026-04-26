#!/bin/bash
# tos-audit.sh: Detect whether any TOS-relevant code or copy has
# changed across the three Web Cited repos since terms.html was last
# updated.
#
# Mirrors privacy-audit.sh in shape but with a different allowlist:
#   - The privacy audit watches for new data surfaces (subprocessors,
#     fields collected, retention behavior, cookies, automated decisions).
#   - The TOS audit watches for changes to commitments the contract
#     makes: tier prices, turnaround SLAs, deliverables, scope,
#     refund/credit mechanics, intake field schema, the LLM engine list
#     covered by §6.8, and the Library catalog content (which is
#     deliverable scope under §6.1).
#
# Exits 0 in both cases; drift/no-drift is signalled via $GITHUB_OUTPUT:
#   drift=true|false
#   cutoff=YYYY-MM-DD        (date of the last terms.html commit)
#
# When drift=true (or when the hosting fingerprint is non-empty),
# the markdown report is written to /tmp/tos-report.md for the notify
# step to pick up.
#
# Allowlist rationale:
#   web-cited           : public marketing pages whose claims the TOS
#                          commits to (pricing, services, how-it-works,
#                          why-sxo, index, start, about). Excludes
#                          terms.html itself and privacy.html.
#   web-cited-api       : all Worker source. Every route shapes intake
#                          schema, dealname, scope-email content, or
#                          turnaround constants the TOS commits to.
#   web-cited-pipeline  : files that shape pricing, scope, dealname,
#                          deliverable templates, the engine list, or
#                          the Library catalog content.

set -euo pipefail

# If FORCE_CUTOFF_ISO is set (via workflow_dispatch inputs.since), use
# it as the cutoff instead of the real terms.html commit date. Useful
# for smoke-testing the drift/notify path or for ad-hoc "what changed
# since <date>" audits. The TERMS_SHA_SHORT filter still excludes the
# actual terms.html commit from the drift list.
if [ -n "${FORCE_CUTOFF_ISO:-}" ]; then
  CUTOFF_ISO="$FORCE_CUTOFF_ISO"
  CUTOFF_DATE="${FORCE_CUTOFF_ISO%%T*}"
  echo "::notice::Cutoff overridden via workflow input: $CUTOFF_ISO"
else
  CUTOFF_ISO=$(git log -1 --format=%cI -- terms.html)
  CUTOFF_DATE=$(git log -1 --format=%cs -- terms.html)
fi
TERMS_SHA_SHORT=$(git log -1 --format=%h -- terms.html)

echo "Terms of Service last updated: $CUTOFF_DATE (commit $TERMS_SHA_SHORT)"

REPORT=/tmp/tos-report.md
: > "$REPORT"

# ---- web-cited (this repo): public claims the TOS commits to ----
DRIFT=$(git log --since="$CUTOFF_ISO" \
  --pretty=format:'- `%h` %s _(%cs, %an)_' \
  --no-merges \
  -- pricing.html services.html how-it-works.html why-sxo.html \
     index.html start.html about.html 2>/dev/null \
  | grep -v "$TERMS_SHA_SHORT" || true)
if [ -n "$DRIFT" ]; then
  printf '### web-cited (public claims)\n\n%s\n\n' "$DRIFT" >> "$REPORT"
fi

# ---- web-cited-api: scope-email constants, intake schema, dealname ----
DRIFT=$(cd /tmp/web-cited-api && git log --since="$CUTOFF_ISO" \
  --pretty=format:'- `%h` %s _(%cs, %an)_' \
  --no-merges \
  -- src 2>/dev/null || true)
if [ -n "$DRIFT" ]; then
  printf '### web-cited-api (Cloudflare Worker)\n\n%s\n\n' "$DRIFT" >> "$REPORT"
fi

# ---- web-cited-pipeline: pricing, dealname, deliverables, engines ----
# git log -- <path> tolerates non-existent paths (returns empty), so we
# can list optimistic candidates without breaking on layout drift.
DRIFT=$(cd /tmp/web-cited-pipeline && git log --since="$CUTOFF_ISO" \
  --pretty=format:'- `%h` %s _(%cs, %an)_' \
  --no-merges \
  -- \
  src/pipeline/billing.py \
  src/pipeline/crm.py \
  src/pipeline/intake.py \
  src/pipeline/models.py \
  src/pipeline/scope_email.py \
  src/pipeline/playbook_data \
  src/pipeline/playbook_render \
  src/pipeline/pdf_render \
  src/pipeline/engines \
  src/pipeline/llm_clients \
  2>/dev/null || true)
if [ -n "$DRIFT" ]; then
  printf '### web-cited-pipeline (audit pipeline)\n\n%s\n\n' "$DRIFT" >> "$REPORT"
fi

# ---- Public-host fingerprint (appended only when other drift was found) ----
# The TOS does not directly name hosting providers; it names
# subprocessors in §6.7 (Cloudflare, HubSpot, Resend, Stripe, OpenAI,
# Anthropic, Google, Perplexity, DataForSEO). A host migration that
# adds or removes a subprocessor will already show up as code drift in
# the api or pipeline repo. The fingerprint is included here purely as
# context for the human reviewer when other drift has been flagged, so
# the live infrastructure picture is visible alongside the change list.
if [ -s "$REPORT" ]; then
  HOSTING=$( bash "$(dirname "$0")/hosting-facts.sh" || true )
  if [ -n "$HOSTING" ]; then
    printf '%s\n' "$HOSTING" >> "$REPORT"
  fi
fi

# ---- Emit outputs + step summary ----
{
  echo "cutoff=$CUTOFF_DATE"
  echo "cutoff_iso=$CUTOFF_ISO"
} >> "$GITHUB_OUTPUT"

if [ -s "$REPORT" ]; then
  echo "drift=true" >> "$GITHUB_OUTPUT"
  {
    echo "## Terms of Service drift detected"
    echo ""
    echo "Terms last updated: **$CUTOFF_DATE**"
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
    echo "No TOS-relevant changes since terms.html was last updated on **$CUTOFF_DATE**."
  } >> "$GITHUB_STEP_SUMMARY"
  echo "No drift."
fi

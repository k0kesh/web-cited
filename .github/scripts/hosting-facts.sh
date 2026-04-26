#!/bin/bash
# hosting-facts.sh: Capture the current public-host fingerprint for
# web-cited.com and api.web-cited.com. Sourced by both the privacy and
# TOS drift audits so each generated report reflects who is actually
# serving traffic right now, regardless of what the policy text claims.
#
# Why this exists:
#   The privacy policy and Terms of Service make specific factual
#   claims about who hosts the site (currently GitHub Pages + Fastly
#   for content delivery, and Cloudflare for authoritative DNS and the
#   intake API edge). If we move to a new host (Cloudflare Pages,
#   Railway, Vercel, Netlify, anywhere else), those claims go stale.
#   Code drift detection alone won't catch this; a host migration is
#   typically a DNS or vendor switch, not a source-code change.
#
#   So both audits dump the live response headers into the issue body
#   every month. The human reviewer eyeballs them and decides whether
#   the headers still match the policy text.
#
# Output: prints a markdown block to stdout. Caller appends to its
# report. Empty if no endpoint responded. No exit codes: purely
# informational.

set -euo pipefail

emit_fingerprint() {
  local url="$1"
  local label="$2"
  local headers
  headers=$(curl -sI --max-time 10 "$url" 2>/dev/null || true)
  if [ -z "$headers" ]; then
    return 0
  fi

  local server via x_served_by x_fastly cf_ray x_powered_by x_vercel railway
  server=$(printf '%s\n' "$headers"      | awk -F': ' 'tolower($1)=="server"{sub(/\r$/,"",$2); print $2; exit}')
  via=$(printf '%s\n' "$headers"         | awk -F': ' 'tolower($1)=="via"{sub(/\r$/,"",$2); print $2; exit}')
  x_served_by=$(printf '%s\n' "$headers" | awk -F': ' 'tolower($1)=="x-served-by"{sub(/\r$/,"",$2); print $2; exit}')
  x_fastly=$(printf '%s\n' "$headers"    | awk -F': ' 'tolower($1)=="x-fastly-request-id"{sub(/\r$/,"",$2); print $2; exit}')
  cf_ray=$(printf '%s\n' "$headers"      | awk -F': ' 'tolower($1)=="cf-ray"{sub(/\r$/,"",$2); print $2; exit}')
  x_powered_by=$(printf '%s\n' "$headers" | awk -F': ' 'tolower($1)=="x-powered-by"{sub(/\r$/,"",$2); print $2; exit}')
  x_vercel=$(printf '%s\n' "$headers"    | awk -F': ' 'tolower($1)=="x-vercel-id"{sub(/\r$/,"",$2); print $2; exit}')
  railway=$(printf '%s\n' "$headers"     | awk -F': ' 'tolower($1)=="x-railway-edge"{sub(/\r$/,"",$2); print $2; exit}')

  printf '**%s** (`%s`):\n' "$label" "$url"
  [ -n "$server" ]       && printf -- '- `server`: %s\n' "$server"
  [ -n "$via" ]          && printf -- '- `via`: %s\n' "$via"
  [ -n "$x_served_by" ]  && printf -- '- `x-served-by`: %s\n' "$x_served_by"
  [ -n "$x_fastly" ]     && printf -- '- `x-fastly-request-id`: present (Fastly CDN)\n'
  [ -n "$cf_ray" ]       && printf -- '- `cf-ray`: present (Cloudflare in request path)\n'
  [ -n "$x_powered_by" ] && printf -- '- `x-powered-by`: %s\n' "$x_powered_by"
  [ -n "$x_vercel" ]     && printf -- '- `x-vercel-id`: present (Vercel)\n'
  [ -n "$railway" ]      && printf -- '- `x-railway-edge`: present (Railway)\n'
  printf '\n'
}

PUBLIC=$(emit_fingerprint "https://web-cited.com/"     "Public site")
API=$(emit_fingerprint    "https://api.web-cited.com/" "Intake API")

if [ -z "$PUBLIC" ] && [ -z "$API" ]; then
  exit 0
fi

printf '### Current public-host fingerprint\n\n'
[ -n "$PUBLIC" ] && { printf '%s' "$PUBLIC"; printf '\n\n'; }
[ -n "$API" ]    && { printf '%s' "$API"; printf '\n\n'; }
cat <<'NOTE'
_Compare the headers above to who the policy and TOS name as hosting / CDN / DNS providers. If the live fingerprint includes a host or CDN that is **not** mentioned in the policy text (or no longer matches it), that is drift even if no commits show up in the lists below. Common signals of a host migration: `server` value changes (e.g. `GitHub.com` -> `cloudflare` or a Railway / Vercel string), `cf-ray` appears or disappears, `x-fastly-request-id` disappears, a new `x-powered-by` value._

NOTE

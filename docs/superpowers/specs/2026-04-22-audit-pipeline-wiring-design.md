# Audit Pipeline Wiring — Phase 0+1 Design Spec

**Date:** 2026-04-22 (revised same-day after codebase audit)
**Author:** Craig Kokesh (via brainstorming with Claude)
**Status:** Design approved; implementation plan pending
**Related specs:**
- `2026-04-21-audit-report-design.md` — deliverable content + design system
- `2026-04-21-email-refresh-and-delivery.md` — `sendDeliveryEmail` consumer (shipped)
- `docs/superpowers/specs/2026-04-20-hubspot-capture-everything-design.md` (in `web-cited-api` repo) — the AST-enforced single-write-path pattern this spec builds on

---

## Purpose

Wire the Cloudflare Worker (`web-cited-api`, TypeScript) and the audit pipeline (`web-cited-pipeline`, Python) into a single coherent system with clean ownership boundaries. The invoice-paid event in the Worker should cause the Python pipeline to run an audit and call back with a bearer-authed completion request; the Worker then sends the already-built delivery email and logs `report_delivered` via the existing capture path.

**Scope of this spec:** Phase 0+1 of the two-service architecture — just the transport and the delivery-email ownership boundary. No statistical methodology work, no new checks, no report redesign, **and no broad migration of other pipeline HubSpot writes**. The pipeline keeps producing the same deliverables it produces today; we're wiring *where* and *how* the final delivery email is triggered.

## Problem framing — what's actually broken

Two repos have independently grown parts of a commerce stack. The symptoms:

1. **`web-cited-pipeline/src/pipeline/cli.py`** runs every audit today. Its side effects during a run include:
   - `send_intake_invoice` → Stripe (may be a no-op in prod if `stripe_api_key` is unset on the Python side — the Worker already creates the invoice)
   - `sync_intake` + `sync_audit_result` → HubSpot via `pipeline/hubspot.py` + Airtable via `pipeline/airtable.py`
   - `send_report_ready` → Resend, using the old un-Brutalist delivery copy in `pipeline/mailer.py`
2. **`web-cited-api/src/`** owns the other half: Stripe invoicing, HubSpot writes via the AST-enforced `hubspotCapture()` single-write-path, and — as of last week — the new Brutalist scope/kickoff/delivery emails. `sendDeliveryEmail` is shipped but has no trigger.
3. The Worker's `POST /capture` endpoint already accepts `source: "pipeline"` and its `EventKind` enum includes the full audit lifecycle (`audit_started`, `crawl_complete`, `llm_tests_complete`, `findings_graded`, `report_rendered`, `report_delivered`). The pipeline is *not* currently using this path — `grep -rn CAPTURE_SECRET pipeline/` finds nothing.
4. The Worker has no way to *trigger* an audit. Every paid invoice today requires manual `web-cited-audit audit --intake <file>` on the operator's laptop.
5. Airtable is a third CRM target with only the Python side writing to it. A decision on whether to keep it, move it, or drop it is deferred.

The decision already made during brainstorming: **Option A** — TS Worker is the front door (commerce, email orchestration, HubSpot logging), Python pipeline is compute (audit + artifact render + signed completion callback), communication via HTTPS, no queue.

**Why no queue at 1–2 audits/week:** signed HTTPS + idempotency sentinels in KV + the existing `CAPTURE_DEAD_LETTER` operator-banner recovery path already solve the same problem. Queues are a failure-isolation mechanism worth adding only once volume justifies the moving parts.

## Architecture

```
[web-cited.com/start.html form]
            │
            ▼
[TS Worker · api.web-cited.com]           ← front door
  - POST /intake                    → validate + HubSpot + Stripe invoice + scope email
  - POST /stripe/webhook            → on invoice.paid: kickoff email + startAudit()       ← extended
  - POST /capture                   → bearer-auth'd HubSpot write path (existing, unchanged)
  - POST /audit/complete            → NEW: bearer-auth'd completion handler
  - POST /audit/retrigger           → NEW: query-param-token operator re-trigger (for start failures)
            │
            │  HTTPS + bearer tokens (two distinct secrets)
            ▼
[Python FastAPI · audit.web-cited.com]    ← compute
  - POST /audit/start               → 202 accepted; background task runs audit
  - GET  /audit/{dealId}            → status (for operator debugging)
            │
            ├─▶ [LLM + signal checks]   (existing pipeline/checks/)
            ├─▶ [render PDF via WeasyPrint + Playbook HTML]  (existing reporter_html + new renderer)
            ├─▶ [upload to R2 · artifacts.web-cited.com]
            └─▶ [POST back to Worker /audit/complete with AuditDeliverable payload]
```

**Why `/audit/complete` is separate from `/capture`:** `/capture` is disciplined pure logging — the AST-enforced single non-initial HubSpot write path (see `scripts/check-capture-coverage.ts` in the Worker repo). Adding side-effects (send the delivery email) to its handler would violate that framing. `/audit/complete` is the *orchestrator* for the completion event: it calls `sendDeliveryEmail`, and *internally* calls `hubspotCapture({ kind: "report_delivered", ... })` to log to HubSpot via the existing path. Two endpoints, one responsibility each.

**Identifier: `dealId`, not a new `jobId`.** The Worker already keys `INTAKE_CACHE` by dealId, carries dealId through Stripe webhook metadata, and anchors every HubSpot capture on dealId. The audit pipeline inherits that identifier end-to-end. No new ID.

**Trigger point:** inline inside `handleStripeWebhook` → `case "invoice.paid":` in `src/index.ts`, right after the kickoff-email try-block. Wrapped in its own try/catch so a trigger failure does not roll back the 200 OK to Stripe.

## Hosting — Phase 0+1 choice and migration plan

**Phase 0+1 host: operator laptop + Cloudflare Tunnel (free).**

- `uvicorn` binds `127.0.0.1:8000` under a launchd plist at login.
- `cloudflared tunnel` under a second launchd plist, named tunnel `audit-tunnel`, routes `audit.web-cited.com` → `localhost:8000`. DNS record is a CNAME to `<tunnel-id>.cfargotunnel.com`, managed by `cloudflared tunnel route dns`.
- Cost: $0. Cloudflare Tunnel is free on the free plan; R2 free tier covers our volume (10 GB storage + 10 GB egress/month; a full audit artifact bundle is <5 MB).
- No public ingress on the operator machine. The tunnel dials out from the laptop to CF edge; CF handles TLS termination.

**Why this is OK at 1–2 audits/week:**
- Operator runs audits manually today anyway — a tunneled service is strictly better than an SSH-triggered shell command.
- Operator-asleep-at-invoice-paid is the same failure mode that already exists with manual runs. On transport failure the trigger writes a HubSpot note via `hubspotCapture` (`audit_status: "start_failed"`), and the deal surfaces in the operator's weekly review queue. Operator clicks the retrigger link in the ops email → `POST /audit/retrigger?deal={dealId}` re-runs `startAudit`. (If the HubSpot write itself fails, `hubspotCapture`'s own fallback pushes to `CAPTURE_DEAD_LETTER` and the [Retry all] banner covers the HubSpot recovery.)
- Single-laptop failure (disk dies, stolen, etc.) costs at most one audit. Operator re-triggers via `POST /audit/retrigger` once replacement hardware is online.

**Migration triggers to Fly.io:**

Evaluate when *any* of these fire:

1. **Audit volume exceeds 5 completed audits per month** — asleep-laptop misses become user-visible.
2. **Two consecutive operator-asleep misses in the dead letter** — pattern means hosting is wrong.
3. **Phase 3 methodology work begins** — confidence-interval sampling means each audit makes ~50× more LLM calls; longer-running jobs collide with laptop sleep cycles.
4. **Operator travel > 1 week** — dead-letter recovery needs hands on the laptop.
5. **Paying customer SLA tightens** — if any tier's turnaround guarantee drops below 5 business days, asleep-laptop-Friday becomes a commercial risk.

**Fly.io fit (Phase 2):** same FastAPI process, `fly.toml` with `internal_port = 8000`, `flyctl secrets set` for pipeline tokens + R2 keys, HTTPS termination free. Single region (sjc or dfw, operator-proximal), `min_machines_running = 1`. Estimated cost at Phase 2 volume: ~$5–10/mo (shared-cpu-1x, 512 MB).

## Scope — what's in and out

### In scope (this spec)

1. **Python FastAPI surface** (`src/pipeline/api.py`) exposing:
   - `POST /audit/start` — bearer-auth'd, takes `{ dealId, intake }`, kicks off an audit, returns 202 immediately.
   - `GET /audit/{dealId}` — bearer-auth'd, returns `queued | running | done | failed` for operator debugging.
2. **Python completion call** (`src/pipeline/completion_client.py`) — POSTs the `AuditDeliverable` + `dealId` + timing to the Worker at `/audit/complete` with bearer auth. Retry schedule 1s / 4s / 15s / 60s / 300s; after 5 failures, enqueue in local SQLite `pending_completion_callbacks`, scheduler re-drains every 5 min.
3. **Python refactor of `cli.py`** — extract `run_audit(intake, queries) -> AuditRunResult` (pure compute). The existing `audit` Typer command calls `run_audit` then conditionally fires commerce side-effects behind `PIPELINE_COMMERCE_ENABLED=false` (default). This preserves the ad-hoc `--url` dev-run path. `AuditRunResult` is a new Pydantic model that wraps the existing `AuditReport` with `ArtifactUrls` + `CitationShareResult`.
4. **Python R2 uploader** (`src/pipeline/artifacts.py`) — `upload_artifacts(deal_id, pdf_bytes, playbook_html, schema_zip_bytes) -> ArtifactUrls`. `boto3` against R2's S3-compatible endpoint. Stable public URLs under `https://artifacts.web-cited.com/{dealId}/{filename}`.
5. **WeasyPrint PDF generation** — wire `weasyprint` into `run_audit` to render the existing `reporter_html.py` output to PDF bytes. Shipped alongside the HTML so artifacts on R2 include a real `.pdf` file, not HTML-named-pdf.
6. **TS audit trigger** (`src/audit-trigger.ts`) — `startAudit(env, intake, dealId, invoiceId) -> Promise<void>`. Checks KV `audit-started-{invoiceId}` sentinel for idempotency. Stashes intake in `INTAKE_CACHE` via existing `cacheIntake()` (already done at scope-email time; re-writes are safe). POSTs to `env.AUDIT_PIPELINE_URL + "/audit/start"` with bearer. On transport failure: writes a `hubspotCapture` note with `kind: "audit_started"` and `dealPropertyPatch: { audit_status: "start_failed" }` so the operator sees the stuck deal; the existing dead-letter drain path covers HubSpot-write failures on top.
7. **TS completion handler** (`src/audit-complete.ts`) — handles `POST /audit/complete`. Verifies bearer `AUDIT_COMPLETE_SECRET`. Checks KV `audit-complete-{dealId}` sentinel for idempotency (if present, return 200 noop). Parses body as `AuditCompletionBody`. Loads intake via `fetchCachedIntake(env.INTAKE_CACHE, dealId)`. Calls `sendDeliveryEmail(env.RESEND_TOKEN, intake, deliverable)`. Calls `hubspotCapture({ kind: "report_delivered", source: "pipeline", dealId, contactId, summary: ..., payload: ..., dealPropertyPatch: { audit_status: "delivered" } })`. Sets KV sentinel. Returns 200. Any internal failure after bearer verification returns 500 so Python retries.
8. **TS operator re-trigger** (`src/audit-retrigger.ts`) — handles `POST /audit/retrigger?deal={dealId}&token={CAPTURE_SECRET}` (query-param token, same pattern as the shipped `/capture/retry`). Loads cached intake and re-invokes `startAudit()` with a fresh `retrigger-${Date.now()}` sentinel key so the original `audit-started-${invoiceId}` gate doesn't block the retry. Linked from the operator email when a deal has `audit_status: "start_failed"`.
9. **Contract mirror** — TS `AuditDeliverable` in `types.ts` (already exists) mirrored by Pydantic `AuditDeliverable` in `pipeline/models.py`. A shared `audit-completion.json` fixture lives in both repos; contract tests on both sides load it and assert parsability.
10. **Infra** — R2 bucket `web-cited-audit-artifacts` (location hint `ENAM`) exposed at `artifacts.web-cited.com` (R2 custom domain); cloudflared named tunnel `audit-tunnel` routing `audit.web-cited.com` → `localhost:8000`; two launchd plists (uvicorn + cloudflared).

### Out of scope (explicit, so planning doesn't drift)

- **Methodology upgrade.** Confidence intervals, bootstrap resampling, rolling windows. Phase 3.
- **Airtable decision.** Python keeps writing Airtable directly via `pipeline/airtable.py` during the audit. No change in v1.
- **Moving mid-audit HubSpot writes to `/capture`.** Python's `sync_intake` and `sync_audit_result` continue to write HubSpot directly during the audit. v1 only moves the *final delivery email trigger* + the `report_delivered` log. Phase 2 can consolidate the mid-audit writes into a pipeline→Worker `/capture` flow.
- **Playbook web surface build.** `playbookUrl` in `AuditDeliverable` is populated only when the Playbook ships (separate spec). Until then, pipeline uploads a PDF + schema-pack-zip, no Playbook file; `AuditCompletionBody.deliverable.playbookUrl` is omitted; delivery-email renders the PDF-only treatment (already implemented).
- **Auto-failure webhook.** If the Python audit itself errors (LLM outage, R2 upload fails), v1 logs via Sentry, the HubSpot deal sits at `audit_status: "in_progress"`, and the operator notices stuck deals during weekly review. Phase 2 can add a `/audit/failed` endpoint that flips `audit_status: "failed"` and notifies the operator via Resend.
- **Fly.io migration.** Triggered by the criteria above, not this phase.
- **Deleting `pipeline/mailer.py`.** Stays in the codebase for dev-mode ad-hoc runs (`PIPELINE_COMMERCE_ENABLED=true`). In Worker-driven mode it is never called.
- **Deleting the abandoned stub at `/Users/craigkokesh/web-cited/pipeline/`.** Unrelated dead code in the marketing site repo. Spawn a separate cleanup ticket.

## Components

### Python pipeline (`web-cited-pipeline`)

| Path | Action | Responsibility |
|---|---|---|
| `src/pipeline/api.py` | **Create** | FastAPI app. `POST /audit/start` (bearer, 202 + background task), `GET /audit/{dealId}`. Job state lives in an in-memory dict keyed by `dealId`. Pipeline restart = job lost, operator re-triggers via `/audit/retrigger` on the Worker. |
| `src/pipeline/artifacts.py` | **Create** | `upload_artifacts(deal_id, pdf_bytes, playbook_html_or_none, schema_zip_bytes) -> ArtifactUrls`. `boto3` against `https://{r2_account_id}.r2.cloudflarestorage.com`. `ArtifactUrls` is a dataclass `(pdf_url, playbook_url, schema_pack_zip_url)` where `playbook_url` is `None` when no Playbook was rendered. Content-types: `application/pdf`, `text/html; charset=utf-8`, `application/zip`. |
| `src/pipeline/completion_client.py` | **Create** | `post_completion(deal_id, deliverable, completed_at, duration_s) -> None`. POSTs JSON body to `settings.audit_complete_url` with `Authorization: Bearer ${settings.audit_complete_secret}`. Retries 1s / 4s / 15s / 60s / 300s. After 5 failures, writes the payload to SQLite table `pending_completion_callbacks(deal_id PRIMARY KEY, payload_json, next_retry_at, attempt_count)` at `~/.local/share/webcited/pipeline.db`. APScheduler job re-drains every 5 min. |
| `src/pipeline/cli.py` | **Modify** | Extract `run_audit(intake, queries) -> AuditRunResult` (pure compute: checks + render + R2 upload + `AuditDeliverable` construction). The existing `audit` Typer command calls `run_audit` and then *conditionally* calls the commerce/mailer side-effects behind `if settings.pipeline_commerce_enabled:`. Default false. Preserves `--url` dev-run path. |
| `src/pipeline/config.py` | **Modify** | Add: `pipeline_commerce_enabled: bool = False`, `pipeline_bearer_token: str` (for inbound `/audit/start` auth), `audit_complete_url: str` (target URL, defaults to `https://api.web-cited.com/audit/complete`), `audit_complete_secret: str` (bearer token we send), `r2_account_id`, `r2_access_key_id`, `r2_secret_access_key`, `r2_bucket_name: str = "web-cited-audit-artifacts"`, `r2_public_base_url: str = "https://artifacts.web-cited.com"`. Read via pydantic-settings. |
| `src/pipeline/models.py` | **Modify** | Add Pydantic models mirroring the TS contract: `CitationShareResult`, `AuditDeliverable`, `AuditCompletionBody` (wraps `AuditDeliverable` with `dealId`, `completedAt`, `durationSeconds`), `AuditRunResult` (wraps `AuditReport` with `ArtifactUrls` + `CitationShareResult`). Reconcile with the existing `intake.py` if it has a duplicate `Intake` shape. |
| `pyproject.toml` | **Modify** | Add to `dependencies`: `fastapi>=0.111`, `uvicorn[standard]>=0.30`, `boto3>=1.34`, `apscheduler>=3.10`, `weasyprint>=61`. Add to `dev` optional group: `freezegun>=1.5`, `moto>=5`. |
| `tests/test_api.py` | **Create** | `TestClient` coverage: bearer rejection, 202 on valid body, status endpoint echoes job state, background task is invoked (monkeypatched). |
| `tests/test_completion_client.py` | **Create** | Bearer round-trip (TS mock accepts correct token, rejects wrong); retry backoff uses `freezegun`; SQLite dead-letter row is written after 5 failures; scheduler re-drains the row and clears it on success. |
| `tests/test_artifacts.py` | **Create** | `moto`-mocked S3, assert three files uploaded with correct keys + content-types, returned URLs are `https://artifacts.web-cited.com/<dealId>/...`. |
| `tests/test_contract.py` | **Create** | Load `tests/fixtures/audit-completion.json` (checked into both repos) and assert `AuditCompletionBody.model_validate(fixture)` succeeds. |
| `tests/fixtures/audit-completion.json` | **Create** | Canonical body both repos test against. |
| `scripts/run-api.sh` | **Create** | `set -a; source ~/.config/webcited/pipeline.env; set +a; exec uvicorn pipeline.api:app --host 127.0.0.1 --port 8000`. Called by launchd plist. |
| `scripts/run-tunnel.sh` | **Create** | `exec cloudflared tunnel run audit-tunnel`. Called by launchd plist. |
| `docs/ops/launchd-setup.md` | **Create** | Operator runbook: install the two plists, register the tunnel, set env vars in `~/.config/webcited/pipeline.env` (mode 600), validate with `curl https://audit.web-cited.com/audit/healthz`. |

### TS Worker (`web-cited-api`)

**Important:** there is no `src/webhooks.ts`. The Stripe webhook is routed inline in `src/index.ts` at `/stripe/webhook`. The first draft of this spec incorrectly referred to a non-existent file. Actual edits below.

| Path | Action | Responsibility |
|---|---|---|
| `src/audit-trigger.ts` | **Create** | `startAudit(env, intake, dealId, invoiceId) -> Promise<void>`. Checks KV sentinel `audit-started-${invoiceId}` (90-day TTL, matching the `kickoff-sent-${invoiceId}` precedent in `handleStripeWebhook`). If already set, return. Writes sentinel *before* the POST (matches kickoff-email discipline — we'd rather have a stuck audit than a duplicate run). POSTs `{ dealId, intake, triggeredAt }` to `env.AUDIT_PIPELINE_URL + "/audit/start"` with `Authorization: Bearer ${env.AUDIT_PIPELINE_TOKEN}`. On non-2xx or network error: log via `console.error`, call `hubspotCapture({ kind: "audit_started", source: "webhook", dealId, contactId, summary: "Audit start FAILED — operator must retrigger", payload: { error, invoiceId }, dealPropertyPatch: { audit_status: "start_failed" } })` — the existing dead-letter machinery covers HubSpot-write failures on top of this. |
| `src/audit-complete.ts` | **Create** | `handleAuditComplete(req, env) -> Response`. Verifies bearer `AUDIT_COMPLETE_SECRET`. Parses body as `AuditCompletionBody`. Checks KV `audit-complete-${dealId}` sentinel — if present, returns 200 noop. Loads intake via `fetchCachedIntake(env.INTAKE_CACHE, dealId)`; if missing, returns 500 (Python retries) and logs — 30-day `INTAKE_CACHE` TTL should cover the longest plausible audit. Calls `sendDeliveryEmail(env.RESEND_TOKEN, cached.intake, body.deliverable)`. Calls `hubspotCapture({ kind: "report_delivered", source: "pipeline", dealId, contactId: cached.contactId, summary: ..., payload: { pdfUrl, durationSeconds }, dealPropertyPatch: { audit_status: "delivered", audit_completed_at: ISO } })`. Sets KV sentinel `audit-complete-${dealId}` (90-day TTL). Returns 200. Any failure after bearer verify returns 500. |
| `src/audit-retrigger.ts` | **Create** | `handleAuditRetrigger(req, env) -> Response`. Query-param auth'd via `?token=${env.CAPTURE_SECRET}` (same pattern as `/capture/retry`). Takes `?deal={dealId}`. Loads cached intake. Invokes `startAudit(env, cached.intake, dealId, "retrigger-" + Date.now())` — fresh sentinel key so the original gate doesn't block the retry. Returns a small HTML page (same `htmlResponse` helper used by `/scope-email/approve`). |
| `src/index.ts` | **Modify** | Route `POST /audit/complete` → `handleAuditComplete`; route `POST /audit/retrigger` → `handleAuditRetrigger`. In `handleStripeWebhook` → `case "invoice.paid"`, immediately after the kickoff-email try-block (around the current line ~742), add a sibling try/catch guarded by the `AUDIT_PIPELINE_ENABLED` feature flag: `if (env.AUDIT_PIPELINE_ENABLED === "true" && dealId) { try { await startAudit(env, cached.intake, dealId, invoiceId); } catch (err) { console.error("startAudit failed", err); } }`. |
| `src/types.ts` | **Modify** | Add `AuditCompletionBody` interface (`dealId`, `completedAt`, `durationSeconds`, `deliverable: AuditDeliverable`). `AuditDeliverable` already exists (shipped in the email-refresh work). |
| `src/audit-trigger.test.ts` | **Create** | Sentinel idempotency (second call with same invoiceId is a no-op), non-2xx pipeline response triggers the `hubspotCapture` fallback with `dealPropertyPatch: audit_status: "start_failed"`, happy path hits `AUDIT_PIPELINE_URL/audit/start` exactly once. |
| `src/audit-complete.test.ts` | **Create** | Bearer rejection → 401, idempotency short-circuit (sentinel present → 200 noop, no email sent), intake-cache miss → 500 with logged error, happy path calls `sendDeliveryEmail` once and `hubspotCapture` once with correct kind + patch. |
| `src/audit-retrigger.test.ts` | **Create** | Bearer rejection, missing-deal rejection, happy path re-invokes `startAudit` with a new sentinel key. |
| `src/contract.test.ts` | **Create** | Load `tests/fixtures/audit-completion.json` (copy of Python-side fixture), validate against the TS `AuditCompletionBody` shape via a small runtime validator (no framework — the type is simple). |
| `wrangler.jsonc` | **Modify** | Add to `vars`: `"AUDIT_PIPELINE_URL": "https://audit.web-cited.com"`, `"AUDIT_PIPELINE_ENABLED": "false"` (feature flag — flipped to `"true"` at cut-over). Add to the secret comment block: `AUDIT_PIPELINE_TOKEN` (bearer we send to Python), `AUDIT_COMPLETE_SECRET` (bearer Python sends to us). Both set via `wrangler secret put`. |
| `scripts/check-capture-coverage.ts` | **Potentially modify** | If the AST scanner enumerates allowed call sites, add `src/audit-complete.ts` and `src/audit-trigger.ts` so they're recognized as permitted `hubspotCapture` callers. If the scanner is pattern-based (match imports from `./hubspot-capture`), no change needed. |

### Shared test fixture

| Path | Action | Responsibility |
|---|---|---|
| `tests/fixtures/audit-completion.json` (both repos) | **Create** | Canonical completion body. The two copies must match byte-for-byte; any field change lands in both repos in one PR. A short `scripts/verify-fixture-parity.sh` in each repo diffs against the other on CI when both checkouts are available (the privacy-audit GHA already pulls both via deploy keys — same mechanism is available here if we choose to add a CI check; not required for v1). |

## Communication contract

### `POST /audit/start` (TS → Python)

**Headers:**
- `Authorization: Bearer <AUDIT_PIPELINE_TOKEN>` — bearer shared between TS and Python. Stored as `AUDIT_PIPELINE_TOKEN` in Worker secrets and `pipeline_bearer_token` in `~/.config/webcited/pipeline.env`.
- `Content-Type: application/json`

**Body:**
```json
{
  "dealId": "18234567890",
  "intake": { "tier": "Audit", "first_name": "Sarah", ... },
  "triggeredAt": "2026-04-22T15:04:05.678Z"
}
```

**Response:** `202 Accepted`, body `{ "dealId": "18234567890", "status": "queued" }`.

**Rejection cases:**
- Missing/invalid bearer → `401`
- Body fails pydantic validation → `422`
- `dealId` already present in Python's in-memory job table as `running` or `done` → `409`. Python state is in-memory — pipeline restart resets the table. TS-side KV sentinel `audit-started-${invoiceId}` is the durable idempotency layer.

### `GET /audit/{dealId}` (Python, operator debugging)

Bearer auth same as above. Returns `{ "dealId", "status", "startedAt", "completedAt"?, "error"? }`. Not called by the Worker in v1; exists for operator `curl` during debugging.

### `POST /audit/complete` (Python → TS)

**Auth:** bearer `AUDIT_COMPLETE_SECRET`, distinct from `AUDIT_PIPELINE_TOKEN` so compromise of one direction doesn't grant the other.

**Why bearer not HMAC:** the existing `/capture` endpoint uses bearer (`CAPTURE_SECRET`) and is the architectural precedent for "trusted external service calls into Worker." HMAC-over-body is stronger against replay but inconsistent with the shipped pattern; at 1–2 audits/week with per-`dealId` idempotency sentinels, replay is not an active threat. If we later move to Fly.io and lose the tunnel's transport-level pairing, revisit HMAC.

**Body (`AuditCompletionBody`):**
```json
{
  "dealId": "18234567890",
  "completedAt": "2026-04-22T16:47:12.345Z",
  "durationSeconds": 5827,
  "deliverable": {
    "pdfUrl": "https://artifacts.web-cited.com/18234567890/audit-report.pdf",
    "playbookUrl": "https://artifacts.web-cited.com/18234567890/playbook/index.html",
    "schemaPackZipUrl": "https://artifacts.web-cited.com/18234567890/schema-pack.zip",
    "citationShare": {
      "you": { "name": "Acme Heating", "percent": 22 },
      "leader": { "name": "Competitor Inc", "percent": 67 },
      "promptsTested": 8,
      "enginesTested": 4,
      "competitorsCount": 2
    },
    "deliveredInBusinessDays": 7
  }
}
```

`deliverable.playbookUrl` is **omitted** from the JSON body (not `null`) for Pulse tier and until the Playbook ships — matches the existing TS `AuditDeliverable` where `playbookUrl?: string` is optional. Same for `deliverable.citationShare.leader` when the intake had zero competitors. Pydantic uses `model_dump(exclude_none=True)`; the TS handler treats absent and `null` equivalently.

**Response:**
- `200 OK` on success — including the idempotent repeat case where the sentinel is already set.
- `401` on bearer mismatch.
- `422` on body validation failure.
- `500` on any internal failure after validation — causes Python retry.

### `POST /audit/retrigger?deal={dealId}&token=...` (operator → TS)

Query-param token auth via `?token=${env.CAPTURE_SECRET}` (same pattern as the shipped `/capture/retry` endpoint — the token is in the URL so the operator can click a link from the ops email without constructing headers). Linked from the operator-email dead-letter banner when an `audit_started/start_failed` note exists on a deal.

### Idempotency keys — summary

| Key | KV namespace | TTL | Meaning |
|---|---|---|---|
| `audit-started-${invoiceId}` | `INTAKE_CACHE` | 90d | One audit-start per paid invoice. Set before the POST fires. |
| `audit-complete-${dealId}` | `INTAKE_CACHE` | 90d | One delivery email per audit. Set after `sendDeliveryEmail` + `hubspotCapture` both succeed. |
| `pending_completion_callbacks.deal_id` | Python SQLite | no TTL | Persistent retry queue for Python→TS completion POSTs. Row removed on 2xx. |
| `intake-cache-${dealId}` | `INTAKE_CACHE` | 30d | Existing — intake + score for scope-email approve flow + audit-complete handler reads. |

## Infrastructure

### Cloudflare R2 bucket

- Name: `web-cited-audit-artifacts`, location hint `ENAM`.
- Public access via R2 → Settings → Custom Domains → `artifacts.web-cited.com`. Objects are public-readable, not listable. Keys are dealId-prefixed (HubSpot deal IDs are long numeric strings, unguessable in practice).
- Lifecycle rule: objects older than 180 days deleted. Operator-laptop `reports/` directory keeps a local cold copy.
- No versioning in v1.

### Cloudflared named tunnel

- Tunnel name: `audit-tunnel`, `cloudflared tunnel create audit-tunnel` (one-time). Credentials at `~/.cloudflared/<tunnel-id>.json` — never commit.
- DNS: `cloudflared tunnel route dns audit-tunnel audit.web-cited.com` (one-time).
- Config at `~/.cloudflared/config.yml`:
  ```yaml
  tunnel: <tunnel-id>
  credentials-file: /Users/<operator>/.cloudflared/<tunnel-id>.json
  ingress:
    - hostname: audit.web-cited.com
      service: http://localhost:8000
    - service: http_status:404
  ```

### launchd plists (both at `~/Library/LaunchAgents/`)

- `com.webcited.audit-api.plist` — runs `scripts/run-api.sh`, `RunAtLoad=true`, `KeepAlive=true`, logs to `/usr/local/var/log/webcited/audit-api.{out,err}.log`.
- `com.webcited.audit-tunnel.plist` — runs `scripts/run-tunnel.sh`, same flags, logs to `audit-tunnel.{out,err}.log`.

Installed via `launchctl load ~/Library/LaunchAgents/<name>.plist`. Neither runs as root. Env vars load from `~/.config/webcited/pipeline.env` (mode 600).

Full runbook: `docs/ops/launchd-setup.md` in the pipeline repo.

## Secrets

| Name | Set on | Shared? | Purpose |
|---|---|---|---|
| `AUDIT_PIPELINE_TOKEN` | Worker (`wrangler secret`) + Python `~/.config/webcited/pipeline.env` as `pipeline_bearer_token` | **Yes** | Bearer for TS → Python `POST /audit/start` and `GET /audit/{dealId}`. Rotate quarterly. |
| `AUDIT_COMPLETE_SECRET` | Worker (`wrangler secret`) + Python env as `audit_complete_secret` | **Yes** | Bearer for Python → TS `POST /audit/complete`. Rotate quarterly. |
| `R2_ACCOUNT_ID` | Python only | No | Cloudflare R2 account. |
| `R2_ACCESS_KEY_ID` | Python only | No | R2 S3-compat key with write access to `web-cited-audit-artifacts`. |
| `R2_SECRET_ACCESS_KEY` | Python only | No | R2 S3-compat secret. |

All existing secrets unchanged. Python keeps `HUBSPOT_TOKEN`, `AIRTABLE_TOKEN`, `STRIPE_SECRET_KEY` for dev-mode commerce runs (`PIPELINE_COMMERCE_ENABLED=true`).

## Error handling — v1

| Failure mode | Degrade path |
|---|---|
| Python `/audit/start` returns 5xx or times out | TS `startAudit` calls `hubspotCapture({ kind: "audit_started", ..., dealPropertyPatch: { audit_status: "start_failed" } })`. Operator-email banner surfaces deals with `audit_status = "start_failed"`. Operator clicks re-trigger link hitting `POST /audit/retrigger?deal=...`. |
| Python audit itself throws (LLM outage, R2 fails, WeasyPrint error, etc.) | Logged via Sentry (pipeline already has `observability.init_sentry`). HubSpot deal stays at `audit_status: "in_progress"`. Operator notices during weekly deal review. No auto-failure webhook in v1. |
| Python → TS `/audit/complete` POST fails | Retry 1s/4s/15s/60s/300s. After 5 failures, SQLite `pending_completion_callbacks` row. Scheduler re-drains every 5 min forever. Worker never distinguishes "completed quickly" from "completed via retry" — sentinel makes it safe. |
| TS `/audit/complete` fails after bearer verify (Resend rate limit, KV write timeout) | 500 → Python retries → eventually succeeds when transient cause clears. **Phase-2 consideration:** add TS-side dead-letter so persistent failures (e.g. Resend account suspended) don't spin forever. Acceptable to omit in v1 since Python's SQLite retry queue provides durability. |
| Operator laptop sleeps during audit | In-memory job state lost. Operator notices deal stuck at `audit_status: "in_progress"`, hits `/audit/retrigger`. Python re-runs from scratch. R2 upload overwrites any partial artifacts. |
| INTAKE_CACHE miss in `/audit/complete` (30-day TTL expired) | `/audit/complete` returns 500, Python retries indefinitely. Extremely unlikely given 30d TTL vs. ~90-min audit. If it does happen, operator escalates manually and we extend TTL. Out-of-spec for v1 auto-recovery. |

Under expected volume (1–5 audits/month with an attentive operator), the dominant failure modes are (1) and (5). Both land on the existing operator-banner surface.

## Testing strategy

**Unit tests (both sides):**

- Bearer: wrong token → 401 on both `/audit/start` and `/audit/complete`; correct token → happy path.
- Idempotency: second POST with same `invoiceId` (trigger) or `dealId` (complete) is a no-op on both sides.
- Python retry backoff: `freezegun` advances time; assert exactly 5 POSTs at the scheduled intervals, then SQLite row insertion.
- TS sentinel write-before-send discipline for `startAudit` (matches kickoff-email precedent).
- Contract: shared `audit-completion.json` fixture parses cleanly into both `AuditCompletionBody` models.

**Integration tests (Python only, `moto` + `httpx.MockTransport`):**

- `POST /audit/start` under bearer: observe job transitions in the in-memory table, observe mocked R2 uploads, observe mocked completion POST.
- End-to-end dry run: `pytest tests/test_end_to_end.py` runs `run_audit` against a cached Cepheid (molecular-diagnostics) intake fixture with all LLM calls stubbed.

**Smoke test (manual, post-deploy):**

1. On operator laptop, `curl https://audit.web-cited.com/audit/healthz` → 200.
2. From anywhere, bearer-authed `curl -X POST https://audit.web-cited.com/audit/start` with a test intake body → 202.
3. Within ~90 min, delivery email arrives in test inbox with real `artifacts.web-cited.com` URLs.
4. Re-POST the trigger → no duplicate email, no duplicate R2 upload.
5. Re-POST the completion → no duplicate email (sentinel guards).

## Implementation notes

**PDF generation (WeasyPrint decision):** `reporter_html.py` produces HTML with `@page Letter` print CSS. v1 wires `weasyprint>=61` into `run_audit` to render the HTML to PDF bytes server-side, then uploads those bytes as `audit-report.pdf` to R2. First plan task should smoke-test WeasyPrint against the existing fixtures to confirm our Brutalist CSS renders acceptably. Fallback (only if WeasyPrint output diverges from browser print-preview in operator review): ship the HTML file with `.pdf` extension and `Content-Disposition: inline; filename="audit-report.pdf"`.

**Plan ordering when this spec becomes tasks:**

1. **Python side first** — `api.py`, `artifacts.py`, `completion_client.py`, `cli.py` refactor, WeasyPrint wiring, test coverage. End-to-end tested against a mocked Worker. Ship to operator laptop under the tunnel. Smoke-test `curl` with a test body and observe R2 uploads. At this point nothing in prod changes — the Worker isn't calling it yet.
2. **TS side second** — `audit-trigger.ts`, `audit-complete.ts`, `audit-retrigger.ts`, wire into `handleStripeWebhook`'s `invoice.paid` case, route registration, wrangler secrets. Deploy behind a `AUDIT_PIPELINE_ENABLED` `vars` toggle (default `false` until ready). Run the smoke test from §Testing.
3. **Cut over** — flip `AUDIT_PIPELINE_ENABLED=true` on the Worker. Set `PIPELINE_COMMERCE_ENABLED=false` on the operator laptop's `~/.config/webcited/pipeline.env`. From that point forward, `cli.py` invoked without `--commerce` runs in pure-compute mode — the Worker owns invoice creation (already true in practice) and the final delivery email (new). Mid-audit HubSpot writes and Airtable writes continue from Python. `--url` dev mode still works for ad-hoc runs.

**Architectural precedents to reuse (not reinvent):**

- `src/hubspot-capture.ts` — single write path; `canonicalJson` for stable serialization; `CaptureInput` shape with optional `dealPropertyPatch`.
- `src/dead-letter.ts` — the `CAPTURE_DEAD_LETTER` KV namespace, `pushDeadLetter` / `listDeadLetter` / `clearDeadLetter` functions, operator-banner surfacing.
- `src/intake-cache.ts` — `cacheIntake` / `fetchCachedIntake`, 30-day TTL.
- `src/scope-approve.ts` — HMAC helper `hmacSha256Hex` (available if we need token-binding for the operator retrigger link in a later iteration).
- `src/stripe.ts` `verifyWebhookSignature` — HMAC-over-raw-body pattern, precedent if we ever upgrade `/audit/complete` from bearer to HMAC.
- The `kickoff-sent-${invoiceId}` sentinel pattern in `handleStripeWebhook` — write the sentinel *before* the email fires; we'd rather miss a send than duplicate one.

**Airtable:** `pipeline/airtable.py` stays live in Python during v1. The `sync_audit_result` path continues to write `Domain`-keyed rows via `performUpsert`. Decision on whether to migrate Airtable writes into the Worker's `/capture` path (with a new `AIRTABLE_TOKEN` binding) is deferred — separate decision ticket.

**Why no `POST /audit/{dealId}/cancel`:** at 1–2/week volume, operator can `launchctl stop com.webcited.audit-api` and `launchctl start` to kill a stuck audit. Not worth an endpoint.

**Why not extend `/capture` instead of adding `/audit/complete`:** `/capture` is disciplined pure HubSpot logging (AST-enforced as the single non-initial write path). Adding a side-effect (call `sendDeliveryEmail`) to its handler breaks that invariant. `/audit/complete` is the completion orchestrator; it *calls* `hubspotCapture` internally to satisfy the single-write-path rule. Two endpoints, one responsibility each.

**Why `dealId` as the identifier:** it's already the cache key (`intake-cache-{dealId}`), flows through Stripe metadata, and is present in every capture call. Introducing a new `jobId` would add a second index that nothing else uses.

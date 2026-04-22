# Audit Pipeline Wiring — Phase 0+1 Design Spec

**Date:** 2026-04-22
**Author:** Craig Kokesh (via brainstorming with Claude)
**Status:** Design approved; implementation plan pending
**Related specs:**
- `2026-04-21-audit-report-design.md` — deliverable content + design system
- `2026-04-21-email-refresh-and-delivery.md` — `sendDeliveryEmail` consumer (shipped)

---

## Purpose

Wire the Cloudflare Worker (`web-cited-api`, TypeScript) and the audit pipeline (`web-cited-pipeline`, Python) into a single coherent system with clean ownership boundaries. The invoice-paid event in the Worker should cause the Python pipeline to run an audit and call back with a signed completion webhook; the Worker then sends the already-built delivery email.

**Scope of this spec:** Phase 0+1 of the two-service architecture — just the transport and ownership boundary. No statistical methodology work, no new checks, no report redesign. The pipeline keeps producing the same deliverables it produces today; we're moving *where* and *how* it is triggered.

## Problem framing — what's actually broken

Two repos have independently grown a full commerce stack. The symptoms:

1. **`web-cited-pipeline/src/pipeline/cli.py`** owns Stripe invoicing (`send_intake_invoice`), HubSpot contact+deal creation (`sync_intake`, `sync_audit_result`), Airtable writes, AND the delivery email (`send_report_ready` via `pipeline/mailer.py`).
2. **`web-cited-api/src/`** owns the same Stripe invoicing (`stripe.ts`, `intake.ts`), HubSpot writes (`hubspot.ts`), scope/kickoff/delivery emails (`scope-email.ts`, `kickoff-email.ts`, `delivery-email.ts`). The delivery email is brand-new, Brutalist, and not yet triggered by anything.
3. Both repos dropped a "remove Loom from deliverables" commit within fifteen seconds of each other on 2026-04-21. That is not migration — that is live duplication.
4. The pipeline writes to Airtable. The Worker writes to HubSpot. Neither writes to both. Airtable is a **third** CRM target that needs a decision later (out of scope for this spec — see §Out of scope).
5. The Worker has no way to *trigger* an audit. Every paid invoice today requires manual `web-cited-audit audit --intake <file>` on the operator's laptop.

The decision already made during brainstorming: **Option A** — TS Worker is the front door (commerce, CRM, emails), Python pipeline is pure compute (audit + artifact render + signed completion callback), communication via HTTPS webhooks, no queue.

Why no queue at 1–2 audits/week: a queue is a failure-isolation mechanism. Signed webhooks with a dead-letter KV entry are simpler, observable (CF tail logs + operator email banner already exists), and recoverable (operator clicks [Retry all] — pattern already in production for HubSpot capture failures).

## Scope — what this spec produces

**In scope:**

1. **Python FastAPI surface** on the pipeline repo (`src/pipeline/api.py`) exposing:
   - `POST /audit` — bearer-auth'd, takes an `IntakePayload` + `jobId`, kicks off an audit, returns 202 immediately.
   - `GET /audit/{jobId}` — bearer-auth'd, returns `queued | running | done | failed` for operator visibility during debugging. Not called by the Worker in v1.
2. **Python completion webhook** (`src/pipeline/completion_webhook.py`) that POSTs an `AuditDeliverable`-shaped body back to the Worker with an HMAC-SHA256 signature, plus a local SQLite-backed retry queue for transient failures.
3. **Python refactor of `cli.py`** — extract the pure-audit function `run_audit(intake, queries) -> AuditRunResult` away from the Stripe/HubSpot/Airtable/mailer calls. `AuditRunResult` is a new Pydantic model (defined in `pipeline/models.py`) that wraps the existing `AuditReport` with the three artifact URLs + the derived `CitationShareResult`. A `PIPELINE_COMMERCE_ENABLED=false` flag (default false once the Worker is driving things) makes the commerce/email side-effects opt-in so the CLI still works for ad-hoc dev runs against `--url`.
4. **Python R2 uploader** (`src/pipeline/artifacts.py`) — pushes PDF + Playbook HTML + schema-pack zip to Cloudflare R2, returns stable public URLs under `artifacts.web-cited.com`. The bucket is public-readable (not listable); UUID-prefixed keys are the access control.
5. **TS audit trigger** (`src/audit-trigger.ts`) — `startAudit(intake, invoiceId)` called from the existing `invoice.paid` Stripe webhook handler; POSTs to the Python `/audit` endpoint with a generated `jobId`; idempotent via KV sentinel `audit-started-{invoiceId}`; falls back to `CAPTURE_DEAD_LETTER` on transport failure so the operator email banner surfaces the miss.
6. **TS completion webhook** (`src/audit-complete-webhook.ts`) — `POST /webhooks/audit-complete`, verifies HMAC, looks up intake from `INTAKE_CACHE`, calls `sendDeliveryEmail(intake, deliverable)`, captures a `report_delivered` event to HubSpot, writes KV sentinel `audit-complete-{jobId}` for idempotency.
7. **Contract mirroring** — TS `AuditDeliverable` in `types.ts` mirrored by Pydantic `AuditDeliverable` in `pipeline/models.py`. Contract test on each side asserts fixture parity.
8. **Infra** — R2 bucket `web-cited-audit-artifacts` exposed at `artifacts.web-cited.com` (CF custom domain), cloudflared named tunnel `audit-tunnel` exposing operator laptop `localhost:8000` at `audit.web-cited.com`, two launchd plists (uvicorn + cloudflared) running on login.

**Out of scope:**

- Statistical methodology upgrade (confidence intervals, bootstrap resampling, rolling windows). This is Phase 3 work. It's the reason the architecture needs to exist, but it is not this spec.
- Airtable deprecation — Airtable still gets written by `sync_audit_result` today; the decision on whether to keep it, move it to the Worker, or drop it is deferred. The wiring work here does not make Airtable worse; it leaves it where it is.
- Redesigning the PDF or Playbook. The Python side keeps producing the same `reporter_html.py` output as today; the only change is it uploads them to R2 instead of writing to `reports/` locally and emailing a localhost URL.
- Building the Playbook web surface (that's a separate deliverable in the audit-report-design spec). In v1 the Worker's `AuditDeliverable` will include `playbookUrl` pointing at the R2-hosted Playbook when the Playbook ships; until then, Audit+Enterprise will get the PDF URL only (pipeline passes `playbookUrl: undefined` — delivery email renders PDF-only treatment).
- Auto-failure webhooks. If the pipeline errors, v1 logs it and leaves the HubSpot deal stuck at `audit_in_progress` — the operator notices stuck deals during the weekly review. Phase 2 can add `POST /webhooks/audit-failed`.
- Migrating the pipeline to Fly.io or any other host. That's a later phase with explicit triggers (see §Migration triggers).
- Replacing the existing `pipeline/mailer.py` `send_report_ready` function. It stays in the codebase for dev-mode ad-hoc runs (when `PIPELINE_COMMERCE_ENABLED=true`). In Worker-driven mode it is never called.

## Architecture

```
[web-cited.com/start.html form]
            │
            ▼
[TS Worker · api.web-cited.com]           ← source of truth for commerce/CRM/email
  - POST /intake             → validate + HubSpot + Stripe invoice + scope email
  - POST /webhooks/stripe    → on invoice.paid: kickoff email + startAudit()
  - POST /webhooks/audit-complete  ← NEW (HMAC-verified; calls sendDeliveryEmail)
            │
            │  signed HTTPS (bearer on request, HMAC on completion body)
            ▼
[Python FastAPI · audit.web-cited.com]    ← pure compute
  - POST /audit              → 202 accepted, bg task runs audit
  - GET  /audit/{jobId}      → status
            │
            ├─▶ [LLM + signal checks]  (existing checks/)
            ├─▶ [render PDF + Playbook] (existing reporter_html)
            ├─▶ [upload to R2 · artifacts.web-cited.com]
            └─▶ [POST back to Worker /webhooks/audit-complete]
```

**Why two separate endpoints on the Worker (`stripe` + `audit-complete`):** same reason Stripe has its own endpoint — each upstream has a different signature scheme (Stripe HMAC with their format, audit HMAC with ours), different retry behavior, different failure modes. Collapsing them hides the contracts.

**Trigger point:** inside the existing `invoice.paid` handler in `src/webhooks.ts` (or wherever `sendKickoffEmail` is called from). Right after `sendKickoffEmail` succeeds, call `startAudit(intake, invoice.id)`. Kickoff-email failure does not block the audit; audit-start failure does not block the kickoff email. They are independent.

**`jobId` generation:** TS side, `crypto.randomUUID()`. Passed in request body to Python. Python echoes it on the completion webhook. Used as the KV idempotency key on both sides.

## Hosting — Phase 0+1 choice and migration plan

**Phase 0+1 host: operator laptop + Cloudflare Tunnel (free).**

- uvicorn binds `127.0.0.1:8000` under a launchd plist at login.
- `cloudflared tunnel` under a second launchd plist, named tunnel `audit-tunnel`, routes `audit.web-cited.com` → `localhost:8000`. DNS record is a CNAME to `<tunnel-id>.cfargotunnel.com`, managed by `cloudflared tunnel route dns`.
- Cost: $0. Cloudflare Tunnel is free on the free plan; R2 free tier covers our volume (10 GB storage + 10 GB egress/month; a full audit artifact bundle is <5 MB).
- No public ingress on the operator machine. The tunnel dials out from the laptop to CF edge; CF handles TLS termination and routes signed traffic inbound. The laptop's firewall stays closed.

**Why this is OK at 1–2 audits/week:**
- Operator runs audits manually today anyway. A tunneled service is strictly better than an SSH-triggered shell command.
- Operator-asleep-at-invoice-paid is the same failure mode that already exists. `CAPTURE_DEAD_LETTER` already has a [Retry all] operator-banner UI; extending it to handle `{ kind: "audit-start", ... }` entries alongside the existing HubSpot-capture entries is a few lines in the drain path. When the operator wakes up, they click the banner.
- Single-laptop failure (hard drive dies, stolen, etc.) costs at most one audit, which the operator re-runs manually. Not an availability win, but not a disaster.

**Migration triggers to Fly.io (or similar):**

Evaluate the move when *any* of these fire:

1. **Audit volume exceeds 5 completed audits per month** — at that cadence, asleep-laptop misses become user-visible.
2. **Two consecutive operator-asleep misses in the dead letter** — even below 5/mo, a repeated failure pattern means the hosting is wrong.
3. **Phase 3 methodology work begins** — confidence-interval sampling means each audit makes ~50× more LLM calls. That's longer-running jobs where laptop sleep cycles start causing partial-run failures. Migrate before, not after.
4. **Operator travel > 1 week** — the dead-letter recovery requires hands on the laptop. If the operator is going to be out, fire up Fly ahead of time.
5. **Paying customer SLA tightens** — if any tier's turnaround guarantee drops below 5 business days, asleep-laptop-Friday is a real commercial risk.

**Fly.io fit (Phase 2):** Same FastAPI process, `fly.toml` binds `internal_port = 8000`, `flyctl secrets set` for the pipeline tokens + R2 keys, HTTPS termination free via Fly. Single region (sjc or dfw, operator-proximal), min_machines_running = 1, so the audit endpoint is always warm. Estimated cost at Phase 2 volume: ~$5–10/mo (shared-cpu-1x, 512 MB). Cheap insurance.

## Components

### Python pipeline (`web-cited-pipeline`)

| Path | Action | Responsibility |
|---|---|---|
| `src/pipeline/api.py` | **Create** | FastAPI app. `POST /audit` (bearer auth, 202 + background task), `GET /audit/{jobId}`. No DB for job state in v1 — use an in-memory dict. Surviving a restart = job is lost; operator re-triggers via the dead-letter banner on the Worker side. |
| `src/pipeline/artifacts.py` | **Create** | `upload_artifacts(job_id, pdf_bytes, playbook_html, schema_zip_bytes) -> ArtifactUrls`. Uses `boto3` against R2's S3-compatible endpoint (`endpoint_url = f"https://{r2_account_id}.r2.cloudflarestorage.com"`). `ArtifactUrls` is a small dataclass `(pdf_url, playbook_url, schema_pack_zip_url)`. Returns stable URLs under `https://artifacts.web-cited.com/{jobId}/{filename}`. Content-types: `application/pdf`, `text/html; charset=utf-8`, `application/zip`. |
| `src/pipeline/completion_webhook.py` | **Create** | `post_completion(job_id, deliverable)` — POSTs to Worker with `X-Audit-Signature: sha256=<hex>` header. Retries with exponential backoff: 1s, 4s, 15s, 60s, 300s (5 attempts total). After all retries fail, writes the payload to a local SQLite table `pending_completion_webhooks(job_id PRIMARY KEY, payload_json, next_retry_at, attempt_count)`. A separate APScheduler job re-drains every 5 min. |
| `src/pipeline/cli.py` | **Modify** | Extract `run_audit(intake, queries) -> AuditArtifacts` (pure compute, no I/O to HubSpot / Stripe / Airtable / mailer). The existing `audit` Typer command calls `run_audit` and then conditionally calls the commerce/mailer side-effects behind `if settings.pipeline_commerce_enabled:`. Default is `false`. Preserves the ad-hoc `--url` dev-run path. |
| `src/pipeline/config.py` | **Modify** | Add `pipeline_commerce_enabled: bool = False`, `pipeline_bearer_token: str`, `audit_webhook_secret: str`, `audit_webhook_target_url: str`, `r2_account_id: str`, `r2_access_key_id: str`, `r2_secret_access_key: str`, `r2_bucket_name: str = "web-cited-audit-artifacts"`, `r2_public_base_url: str = "https://artifacts.web-cited.com"`. Read via pydantic-settings from env / `.env`. |
| `src/pipeline/models.py` | **Modify** | Add Pydantic models mirroring the TS contract: `CitationShareResult`, `AuditDeliverable`, `AuditCompletionBody` (adds `jobId` + timing metadata). Add `IntakePayload` if not already present and reconcile with the existing `intake.py` shape. |
| `pyproject.toml` | **Modify** | Add `fastapi>=0.111`, `uvicorn[standard]>=0.30`, `boto3>=1.34`, `apscheduler>=3.10`, `weasyprint>=61` to `dependencies`. `freezegun`, `moto>=5` go in the `dev` optional group. |
| `tests/test_api.py` | **Create** | TestClient coverage: bearer rejection, 202 on valid body, status endpoint echoes job state, background task is invoked (monkeypatched). |
| `tests/test_completion_webhook.py` | **Create** | HMAC round-trip (signature matches what the Worker verifies), retry backoff uses `freezegun`, dead-letter SQLite row written after 5 failures. |
| `tests/test_artifacts.py` | **Create** | `moto`-mocked S3, assert three files uploaded with correct keys + content-types, returned URLs are `https://artifacts.web-cited.com/<jobId>/...`. |
| `tests/test_contract.py` | **Create** | Load a fixture `tests/fixtures/audit-completion.json` (checked into both repos) and assert `AuditCompletionBody.model_validate(fixture)` succeeds. |
| `scripts/run-api.sh` | **Create** | `exec uvicorn pipeline.api:app --host 127.0.0.1 --port 8000 --log-config config/log-config.yaml`. Called by the launchd plist. |
| `scripts/run-tunnel.sh` | **Create** | `exec cloudflared tunnel run audit-tunnel`. Called by the launchd plist. |
| `docs/ops/launchd-setup.md` | **Create** | Operator runbook: how to install the two plists, register the tunnel, set env vars in `.env`, validate the stack. |

### TS Worker (`web-cited-api`)

| Path | Action | Responsibility |
|---|---|---|
| `src/audit-trigger.ts` | **Create** | `startAudit(env, intake, invoiceId) -> Promise<{ jobId: string }>`. Checks KV `audit-started-{invoiceId}` for idempotency, generates `jobId`, stores `INTAKE_CACHE` mapping `jobId → intake` (30-day TTL), POSTs `{ jobId, intake }` to `env.AUDIT_PIPELINE_URL + "/audit"` with `Authorization: Bearer ${env.AUDIT_PIPELINE_TOKEN}`. On transport failure: write to `CAPTURE_DEAD_LETTER` as `{ kind: "audit-start", invoiceId, intake, at }`, surface on operator-email banner. |
| `src/audit-complete-webhook.ts` | **Create** | Handles `POST /webhooks/audit-complete`. Verifies `X-Audit-Signature` HMAC against `env.AUDIT_WEBHOOK_SECRET`. Checks KV `audit-complete-{jobId}` for idempotency (if present, return 200 noop). Parses body as `AuditCompletionBody`. Looks up intake via `INTAKE_CACHE.get(jobId)`. Calls `sendDeliveryEmail(env.RESEND_TOKEN, intake, deliverable)`. Captures `report_delivered` event via the existing HubSpot capture path. Sets KV sentinel. Returns 200. Any internal failure after signature verification returns 500 so Python retries. |
| `src/index.ts` | **Modify** | Add route registration for `POST /webhooks/audit-complete`. No change to existing routes. |
| `src/webhooks.ts` | **Modify** | In the `invoice.paid` handler, after `sendKickoffEmail` resolves, `await startAudit(env, intake, event.data.object.id)` wrapped in try/catch so a trigger failure does not roll back the webhook ack. |
| `src/types.ts` | **Modify** | Add `AuditCompletionBody` interface (wraps existing `AuditDeliverable` with `jobId`, `completedAt`, `durationSeconds`). |
| `src/audit-trigger.test.ts` | **Create** | Idempotency (second call with same invoiceId returns the same jobId), transport failure writes to dead-letter, happy path hits the pipeline URL once. |
| `src/audit-complete-webhook.test.ts` | **Create** | Signature rejection, idempotency short-circuit, intake cache miss path, happy path calls `sendDeliveryEmail`. |
| `src/contract.test.ts` | **Create** | Load the same fixture as the Python side, assert it satisfies the TS `AuditCompletionBody` shape via a tiny runtime validator. |
| `wrangler.jsonc` | **Modify** | Add env vars: `AUDIT_PIPELINE_URL = "https://audit.web-cited.com"`. Add secrets (referenced in comment, set via `wrangler secret put`): `AUDIT_PIPELINE_TOKEN`, `AUDIT_WEBHOOK_SECRET`. |

### Shared fixture

| Path | Action | Responsibility |
|---|---|---|
| `tests/fixtures/audit-completion.json` (both repos) | **Create** | Canonical completion-webhook body. Both sides' contract tests load this file. Any field change must land in both repos at once. The file's SHA is noted in PR descriptions for drift detection. |

## Communication contract

### `POST /audit` (TS → Python)

**Headers:**
- `Authorization: Bearer <AUDIT_PIPELINE_TOKEN>` — rotating shared secret, stored as `AUDIT_PIPELINE_TOKEN` on TS side and `pipeline_bearer_token` on Python side.
- `Content-Type: application/json`

**Body:**
```json
{
  "jobId": "5c4a1f2e-4b0c-4e1a-9c5f-0a3b7d6e8f2c",
  "intake": { "tier": "Audit", "first_name": "Sarah", ... },
  "triggeredAt": "2026-04-22T15:04:05.678Z"
}
```

**Response:** `202 Accepted`, body `{ "jobId": "...", "status": "queued" }`.

**Rejection cases:**
- Missing/invalid bearer → `401`
- Body fails pydantic validation → `422`
- Duplicate jobId already in Python's in-memory job table (running or done) → `409`. TS-side idempotency should prevent this in practice, but the guard is cheap. Note: Python's state is in-memory, so a pipeline restart resets the table — a re-POST after restart will return `202`, not `409`. TS-side KV is the durable idempotency layer.

### `GET /audit/{jobId}` (Python, operator debugging)

Bearer auth same as above. Returns `{ "jobId", "status", "startedAt", "completedAt"?, "error"? }`. Not called by the Worker in v1; exists for operator curl during debugging.

### `POST /webhooks/audit-complete` (Python → TS)

**Headers:**
- `X-Audit-Signature: sha256=<hex>` — `HMAC_SHA256(AUDIT_WEBHOOK_SECRET, raw_request_body)`. Mirrors Stripe's scheme, reuses the timing-safe compare helper already in `src/stripe.ts`.
- `Content-Type: application/json`

**Body (`AuditCompletionBody`):**
```json
{
  "jobId": "5c4a1f2e-...",
  "completedAt": "2026-04-22T16:47:12.345Z",
  "durationSeconds": 5827,
  "deliverable": {
    "pdfUrl": "https://artifacts.web-cited.com/5c4a1f2e-.../audit-report.pdf",
    "playbookUrl": "https://artifacts.web-cited.com/5c4a1f2e-.../playbook/index.html",
    "schemaPackZipUrl": "https://artifacts.web-cited.com/5c4a1f2e-.../schema-pack.zip",
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

`playbookUrl` is **omitted from the JSON body** (not `null`) for Pulse tier and until the Playbook ships — matches the existing TS `AuditDeliverable` shape where `playbookUrl?: string` is optional. Same for `leader` inside `citationShare` when the intake had zero competitors. Pydantic serializes absent optional fields via `model_dump(exclude_none=True)`; the TS runtime validator treats absent and `null` equivalently.

**Response:**
- `200` on success (idempotent — second call with same `jobId` also returns 200, no side effects)
- `401` on signature mismatch
- `422` on body validation failure
- `500` on any internal failure after validation — causes Python to retry

### Idempotency keys

- TS `audit-started-{invoiceId}` in KV (30-day TTL) — guarantees one trigger per paid invoice, even if Stripe re-sends the webhook.
- TS `audit-complete-{jobId}` in KV (30-day TTL) — guarantees one delivery email per audit, even if the Python webhook is retried after a 500.
- Python `pending_completion_webhooks` SQLite table keyed by `jobId` — the retry scheduler never re-enqueues a job that's already present in the table.

## Infrastructure

### Cloudflare R2 bucket

- Bucket: `web-cited-audit-artifacts`, location hint `ENAM` (eastern North America) to sit close to the operator laptop + the typical North American prospect.
- Public access via a CF custom domain `artifacts.web-cited.com`, connected via R2 → Settings → Custom Domains. Objects are public-readable, not listable. Keys are UUID-prefixed, so unguessable access is the access control.
- Lifecycle rule: objects older than 180 days are deleted (via the R2 lifecycle UI or `wrangler r2 bucket lifecycle`). Artifacts are also archived to the operator's local `reports/` directory during the same render step, so the R2 copy is "hot" and the laptop copy is "cold but forever."
- No object versioning in v1.

### Cloudflared named tunnel

- Tunnel name: `audit-tunnel`, created via `cloudflared tunnel create audit-tunnel`. The one-time setup writes `~/.cloudflared/<tunnel-id>.json` (keep out of git — add to `.gitignore` if the repo touches that path).
- Routing: `cloudflared tunnel route dns audit-tunnel audit.web-cited.com` creates the CNAME; zero manual DNS edits.
- Config file `~/.cloudflared/config.yml`:
  ```yaml
  tunnel: <tunnel-id>
  credentials-file: /Users/<operator>/.cloudflared/<tunnel-id>.json
  ingress:
    - hostname: audit.web-cited.com
      service: http://localhost:8000
    - service: http_status:404
  ```

### launchd plists

Two plists under `~/Library/LaunchAgents/`:

- `com.webcited.audit-api.plist` — runs `scripts/run-api.sh`, `RunAtLoad=true`, `KeepAlive=true`, logs to `/usr/local/var/log/webcited/audit-api.{out,err}.log`.
- `com.webcited.audit-tunnel.plist` — runs `scripts/run-tunnel.sh`, same flags, logs to `.../audit-tunnel.{out,err}.log`.

Operator installs with `launchctl load ~/Library/LaunchAgents/com.webcited.audit-api.plist` (same for tunnel). Neither plist runs as root. Env vars are loaded from `~/.config/webcited/pipeline.env` (mode 600) which the shell scripts `set -a; source` before exec.

Full runbook lives in `docs/ops/launchd-setup.md` in the pipeline repo.

## Secrets

Added in Phase 0+1. All secrets are shared between TS and Python where noted.

| Name | Where set | Shared? | Purpose |
|---|---|---|---|
| `AUDIT_PIPELINE_TOKEN` | TS `wrangler secret` + Python `~/.config/webcited/pipeline.env` | **Yes** | Bearer token for TS → Python `POST /audit`. Rotate quarterly. |
| `AUDIT_WEBHOOK_SECRET` | TS `wrangler secret` + Python `~/.config/webcited/pipeline.env` | **Yes** | HMAC key for Python → TS `POST /webhooks/audit-complete`. Rotate quarterly. |
| `R2_ACCOUNT_ID` | Python only | No | Cloudflare R2 account. |
| `R2_ACCESS_KEY_ID` | Python only | No | R2 S3-compat key with write to `web-cited-audit-artifacts`. |
| `R2_SECRET_ACCESS_KEY` | Python only | No | R2 S3-compat secret. |

Existing secrets are untouched. Airtable/Stripe/HubSpot credentials on the Python side stay where they are until the Airtable decision (out of scope). Both `STRIPE_SECRET_KEY` and `HUBSPOT_TOKEN` remain on the Python side so `pipeline_commerce_enabled=true` dev mode continues to work.

## Error handling — v1

The design is intentionally sparse at the failure edges. Each degrade is explicit:

1. **Python `/audit` returns 5xx or times out** → TS writes `CAPTURE_DEAD_LETTER` entry `kind: "audit-start"`, operator-email banner surfaces the count with a `[Retry all]` link. Operator fixes the root cause (tunnel down, uvicorn crashed), clicks retry, the existing dead-letter-drain path re-POSTs.
2. **Python audit itself throws** (LLM outage, R2 upload fails, etc.) → logged via Sentry (pipeline already has `observability.init_sentry`), HubSpot deal stays at `audit_in_progress`, operator notices during weekly deal review. No `audit-failed` webhook in v1.
3. **Python completion-webhook POST fails** → retry schedule 1s / 4s / 15s / 60s / 300s; after 5 failures, enqueue in local SQLite `pending_completion_webhooks`, scheduler re-drains every 5 min forever. The Worker never knows the difference between "completed quickly" and "completed via retry"; the idempotency key makes it safe.
4. **TS completion-webhook handler fails after signature verification** → 500 back to Python, Python retries, eventually TS succeeds once the transient cause clears (Resend rate limit, KV write timeout). Phase-3 consideration: add a TS-side dead-letter for the `audit-complete` failure mode so a truly persistent failure doesn't spin forever.
5. **Operator laptop sleeps during an audit** → audit state is in-memory, so jobs in flight are lost. Python `/audit` is idempotent on re-trigger (TS sees no `audit-complete-{jobId}` ever arrived, so the operator dead-letter retry re-POSTs the same jobId; Python starts over). The R2 upload overwrites the partial artifacts.

Under 5 audits/month with an operator actively monitoring, (1) and (5) are the realistic failure modes. Both land in the existing operator-banner surface.

## Testing strategy

**Unit tests (both sides):**

- HMAC: round-trip test where Python signs a fixture body, TS verifies. Assert bit-identical signatures. Flip one byte, assert rejection.
- Bearer: TS sends token, Python accepts; TS sends wrong token, Python returns 401.
- Idempotency: second call with same `jobId` (or `invoiceId`) is a noop on both sides.
- Retry backoff: Python webhook retry uses `freezegun` to advance time; assert exactly 5 POST attempts at the scheduled intervals, then dead-letter enqueue.
- Contract: a shared `audit-completion.json` fixture is validated by both Pydantic and the TS runtime validator.

**Integration tests (Python only, `moto` + `httpx.MockTransport`):**

- `POST /audit` under bearer, observe in-memory job table transitions, observe mocked R2 upload, observe mocked completion-webhook POST to TS.
- End-to-end dry run: `pytest tests/test_end_to_end.py` runs `run_audit` against a cached intake fixture (Cepheid — molecular diagnostics, already in use per user memory) with LLM calls stubbed.

**Smoke test (manual, post-deploy):**

1. On operator laptop, verify `curl https://audit.web-cited.com/healthz` returns 200.
2. From anywhere, `curl -X POST https://audit.web-cited.com/audit -H "Authorization: Bearer $TOKEN"` with a test intake body, observe 202.
3. Let the audit run. Within ~90 min, observe delivery email in the test inbox with a real PDF URL.
4. Re-POST the same trigger; assert no second email fires and no second R2 upload happens.

## Out of scope (repeated for emphasis)

- Confidence-interval methodology (Phase 3).
- Airtable decision (ad-hoc ticket).
- Playbook web surface build (separate spec).
- PDF/Playbook redesign.
- `audit-failed` webhook.
- Fly.io / Railway / hosted migration (triggered separately).
- Replacing Python's `pipeline/mailer.py` for dev runs.

## Implementation notes

**PDF generation in v1:** the existing pipeline's `reporter_html.py` produces HTML with `@page Letter` print CSS but does not produce PDF bytes. v1 of this spec wires **WeasyPrint** (added to `pyproject.toml` alongside the FastAPI deps) to render the same HTML to PDF bytes inside `run_audit`, then uploads those bytes to R2 under `audit-report.pdf`. The Playbook HTML is uploaded separately under `playbook/index.html` (same HTML source, no print CSS override needed because browsers happily ignore `@page`). WeasyPrint handles our simple Swiss/Brutalist CSS; complex JS-rendered layouts are not a concern (the report is static). If WeasyPrint's rendering diverges from the browser print-preview in operator review, the fallback is to ship PDF as HTML-with-`.pdf`-extension and set `Content-Disposition: inline` — but the spec assumes WeasyPrint works, and the implementation plan's first task should smoke-test WeasyPrint against the existing HTML fixtures before building the rest.

**Plan ordering when this spec becomes tasks:**

1. Python side first — `api.py`, `artifacts.py`, `completion_webhook.py`, cli.py refactor. This can be tested end-to-end against a mocked Worker. Ship it to the operator laptop under the tunnel. Smoke-test `curl` against `audit.web-cited.com/audit` with a fake bearer body and observe R2 uploads. At this point nothing in prod changes — the Worker isn't calling it yet.
2. TS side second — `audit-trigger.ts`, `audit-complete-webhook.ts`, wire into the `invoice.paid` handler. Deploy to a preview environment (or stage behind a feature flag in `env.vars`). Run the smoke test from §Testing.
3. Cut over — set `PIPELINE_COMMERCE_ENABLED=false` on the Python side. From that point forward, the Python CLI no longer sends Stripe invoices, writes HubSpot/Airtable, or sends emails when invoked via the API. Dev mode with the flag on remains available for ad-hoc `--url` runs. The existing manual operator workflow is preserved.

**Idempotency hygiene:** the `jobId` must be stable from trigger through completion. TS generates it once (`crypto.randomUUID()`), passes it to Python in the trigger body, Python echoes it in the completion body. Never regenerate.

**Why not use Cloudflare Queues:** they'd be a fine choice at scale, but add a second moving part (queue bindings, a consumer Worker) for no gain at 1–2 audits/week. The dead-letter-KV + banner pattern already solves the same problem and is in production. Revisit at Fly migration time.

**Why store intake in `INTAKE_CACHE` rather than passing it through the whole round-trip:** the Python → TS completion body is signed. If we passed the intake through Python and back, the signature would have to cover a prospect-data blob that the Python side has no business modifying. Cleaner: TS stashes the intake at trigger time, Python only sees and echoes `jobId`, TS rehydrates intake by `jobId` on the way back.

**Why no `POST /audit/{jobId}/cancel`:** at 1–2/week volume, an operator can `launchctl stop` and `launchctl start` the uvicorn plist to kill a stuck audit. Not worth an endpoint.

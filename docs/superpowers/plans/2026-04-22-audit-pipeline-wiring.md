# Audit Pipeline Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the TypeScript Cloudflare Worker (`web-cited-api`) to the Python audit pipeline (`web-cited-pipeline`) over bearer-authed HTTPS so that a paid Stripe invoice triggers an audit, artifacts land in R2, and the Worker owns the final delivery email.

**Architecture:** Worker is front door (commerce + email orchestration + HubSpot logging via the existing AST-enforced `/capture` path). Python pipeline is compute (audit + WeasyPrint PDF + R2 upload + bearer-authed `/audit/complete` callback). `dealId` is the universal identifier. `/audit/complete` is a distinct endpoint from `/capture` so the capture helper stays pure; it calls `hubspotCapture` internally to preserve single-write-path discipline.

**Tech Stack:** Python 3.11 + FastAPI + uvicorn + boto3 + APScheduler + WeasyPrint + SQLite (Python side); TypeScript + Cloudflare Workers + Wrangler + KV (TS side); Cloudflare R2 for artifacts; cloudflared named tunnel for operator-laptop ingress; launchd on macOS for process supervision.

**Spec:** `docs/superpowers/specs/2026-04-22-audit-pipeline-wiring-design.md`

---

## File Structure

### Python pipeline (`/Users/craigkokesh/web-cited-pipeline`)

| Path | Action | Responsibility |
|---|---|---|
| `src/pipeline/api.py` | Create | FastAPI app; `POST /audit/start`, `GET /audit/{dealId}`, `GET /audit/healthz`. |
| `src/pipeline/artifacts.py` | Create | R2 uploader via boto3. |
| `src/pipeline/completion_client.py` | Create | POST to Worker `/audit/complete` with retry + SQLite dead-letter. |
| `src/pipeline/cli.py` | Modify | Extract `run_audit()` pure-compute function. |
| `src/pipeline/config.py` | Modify | Add bearer tokens + R2 + completion URL + commerce flag. |
| `src/pipeline/models.py` | Modify | Add `IntakePayload`, `CitationShareResult`, `AuditDeliverable`, `AuditCompletionBody`, `AuditRunResult`, `ArtifactUrls`. |
| `pyproject.toml` | Modify | Add fastapi, uvicorn, boto3, apscheduler, weasyprint; dev: freezegun, moto. |
| `tests/test_api.py` | Create | FastAPI TestClient coverage. |
| `tests/test_completion_client.py` | Create | Retry + dead-letter tests. |
| `tests/test_artifacts.py` | Create | moto-backed R2 upload tests. |
| `tests/test_contract.py` | Create | Fixture parses into `AuditCompletionBody`. |
| `tests/test_run_audit.py` | Create | `run_audit()` pure-compute coverage. |
| `tests/fixtures/audit-completion.json` | Create | Shared contract fixture. |
| `scripts/run-api.sh` | Create | launchd entry for uvicorn. |
| `scripts/run-tunnel.sh` | Create | launchd entry for cloudflared. |
| `scripts/launchd/com.webcited.audit-api.plist` | Create | launchd plist. |
| `scripts/launchd/com.webcited.audit-tunnel.plist` | Create | launchd plist. |
| `docs/ops/launchd-setup.md` | Create | Operator runbook. |

### TS Worker (`/Users/craigkokesh/web-cited-api`)

| Path | Action | Responsibility |
|---|---|---|
| `src/audit-trigger.ts` | Create | `startAudit(env, intake, dealId, invoiceId)`. |
| `src/audit-complete.ts` | Create | `handleAuditComplete(req, env)`. |
| `src/audit-retrigger.ts` | Create | `handleAuditRetrigger(req, env)`. |
| `src/types.ts` | Modify | Add `AuditCompletionBody` + extend `Env`. |
| `src/index.ts` | Modify | Register two new routes; add `startAudit` call inside `invoice.paid` case. |
| `src/audit-trigger.test.ts` | Create | Sentinel idempotency, transport failure → capture fallback. |
| `src/audit-complete.test.ts` | Create | Bearer rejection, idempotency, happy path. |
| `src/audit-retrigger.test.ts` | Create | Token rejection, re-invoke startAudit. |
| `src/contract.test.ts` | Create | Shared fixture parses into `AuditCompletionBody`. |
| `tests/fixtures/audit-completion.json` | Create | Byte-for-byte copy of Python-side fixture. |
| `wrangler.jsonc` | Modify | Add `AUDIT_PIPELINE_URL`, `AUDIT_PIPELINE_ENABLED` vars; update secret comment. |

---

# Part A — Python pipeline

Work inside `/Users/craigkokesh/web-cited-pipeline`. Each task runs on a topic branch off `main`. Tests run as `pytest -q` from the repo root after `pip install -e '.[dev]'`.

### Task A1: Add Python dependencies

**Files:**
- Modify: `/Users/craigkokesh/web-cited-pipeline/pyproject.toml`

- [ ] **Step 1: Read current deps**

Run: `grep -A 30 '^dependencies' /Users/craigkokesh/web-cited-pipeline/pyproject.toml`

- [ ] **Step 2: Add runtime dependencies**

Edit `dependencies` to append (keep existing entries):

```toml
    "fastapi>=0.111",
    "uvicorn[standard]>=0.30",
    "boto3>=1.34",
    "apscheduler>=3.10",
    "weasyprint>=61",
```

- [ ] **Step 3: Add dev dependencies**

Edit `[project.optional-dependencies].dev` to append:

```toml
    "freezegun>=1.5",
    "moto[s3]>=5",
    "fastapi[all]",
```

- [ ] **Step 4: Install + verify import**

Run:
```bash
cd /Users/craigkokesh/web-cited-pipeline && pip install -e '.[dev]' && \
  python -c "import fastapi, uvicorn, boto3, apscheduler, weasyprint, freezegun, moto; print('ok')"
```
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml
git commit -m "deps: add fastapi/uvicorn/boto3/apscheduler/weasyprint + dev moto/freezegun"
```

---

### Task A2: Extend config.py

**Files:**
- Modify: `/Users/craigkokesh/web-cited-pipeline/src/pipeline/config.py`

- [ ] **Step 1: Write failing test**

Create `/Users/craigkokesh/web-cited-pipeline/tests/test_config_audit.py`:

```python
import os

import pytest

from pipeline.config import load_settings


@pytest.fixture(autouse=True)
def _clear(monkeypatch):
    for k in (
        "PIPELINE_COMMERCE_ENABLED", "PIPELINE_BEARER_TOKEN",
        "AUDIT_COMPLETE_URL", "AUDIT_COMPLETE_SECRET",
        "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY",
        "R2_BUCKET_NAME", "R2_PUBLIC_BASE_URL",
    ):
        monkeypatch.delenv(k, raising=False)


def test_defaults():
    s = load_settings()
    assert s.pipeline_commerce_enabled is False
    assert s.pipeline_bearer_token is None
    assert s.audit_complete_url == "https://api.web-cited.com/audit/complete"
    assert s.audit_complete_secret is None
    assert s.r2_bucket_name == "web-cited-audit-artifacts"
    assert s.r2_public_base_url == "https://artifacts.web-cited.com"


def test_overrides(monkeypatch):
    monkeypatch.setenv("PIPELINE_COMMERCE_ENABLED", "true")
    monkeypatch.setenv("PIPELINE_BEARER_TOKEN", "tok-in")
    monkeypatch.setenv("AUDIT_COMPLETE_URL", "https://x.example.com/hook")
    monkeypatch.setenv("AUDIT_COMPLETE_SECRET", "tok-out")
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "ak")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sk")
    s = load_settings()
    assert s.pipeline_commerce_enabled is True
    assert s.pipeline_bearer_token == "tok-in"
    assert s.audit_complete_url == "https://x.example.com/hook"
    assert s.audit_complete_secret == "tok-out"
    assert (s.r2_account_id, s.r2_access_key_id, s.r2_secret_access_key) == ("acc", "ak", "sk")
```

- [ ] **Step 2: Run test to confirm failure**

Run: `cd /Users/craigkokesh/web-cited-pipeline && pytest tests/test_config_audit.py -q`
Expected: FAIL — attributes don't exist.

- [ ] **Step 3: Extend `Settings`**

In `src/pipeline/config.py`, inside the `Settings` class (below the existing `sentry_traces_sample_rate` field), add:

```python
    # --- Audit pipeline wiring (2026-04-22 spec) ----------------------------

    # Toggle commerce side-effects inside cli.py. Default false so the CLI
    # is pure compute under Worker-driven mode. Flip to true for ad-hoc dev
    # runs that still want to exercise the Stripe + HubSpot + Airtable +
    # mailer paths directly.
    pipeline_commerce_enabled: bool = Field(
        default=False, alias="PIPELINE_COMMERCE_ENABLED"
    )

    # Bearer the Worker presents when calling POST /audit/start. FastAPI
    # rejects the request if this is unset or the header doesn't match.
    pipeline_bearer_token: str | None = Field(
        default=None, alias="PIPELINE_BEARER_TOKEN"
    )

    # Worker endpoint + bearer we use when posting AuditCompletionBody.
    audit_complete_url: str = Field(
        default="https://api.web-cited.com/audit/complete",
        alias="AUDIT_COMPLETE_URL",
    )
    audit_complete_secret: str | None = Field(
        default=None, alias="AUDIT_COMPLETE_SECRET"
    )

    # R2 / S3-compat artifact storage.
    r2_account_id: str | None = Field(default=None, alias="R2_ACCOUNT_ID")
    r2_access_key_id: str | None = Field(default=None, alias="R2_ACCESS_KEY_ID")
    r2_secret_access_key: str | None = Field(
        default=None, alias="R2_SECRET_ACCESS_KEY"
    )
    r2_bucket_name: str = Field(
        default="web-cited-audit-artifacts", alias="R2_BUCKET_NAME"
    )
    r2_public_base_url: str = Field(
        default="https://artifacts.web-cited.com", alias="R2_PUBLIC_BASE_URL"
    )
```

Also append the new env names to `_ENV_VARS_TO_CLEAN`:

```python
    "PIPELINE_COMMERCE_ENABLED",
    "PIPELINE_BEARER_TOKEN",
    "AUDIT_COMPLETE_URL",
    "AUDIT_COMPLETE_SECRET",
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_BASE_URL",
```

- [ ] **Step 4: Run test to confirm pass**

Run: `pytest tests/test_config_audit.py -q`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/config.py tests/test_config_audit.py
git commit -m "config: add audit-wiring settings (bearer tokens, R2, completion URL)"
```

---

### Task A3: Pydantic contract models

**Files:**
- Modify: `/Users/craigkokesh/web-cited-pipeline/src/pipeline/models.py`

- [ ] **Step 1: Write failing tests**

Create `/Users/craigkokesh/web-cited-pipeline/tests/test_audit_contract_models.py`:

```python
import pytest
from pydantic import ValidationError

from pipeline.models import (
    ArtifactUrls,
    AuditCompletionBody,
    AuditDeliverable,
    CitationShareResult,
    IntakePayload,
)


def _intake_kwargs(**over):
    base = dict(
        tier="Audit",
        first_name="Sarah",
        last_name="Martinez",
        company="Acme Heating",
        email="sarah@acme.com",
        website="https://acme-heating.com",
        business_one_liner="HVAC install & service across Denver.",
        buyer_questions="How much does a furnace cost?\nBest HVAC company near me?",
        competitors="https://c1.com\nhttps://c2.com",
        geo_focus="United States",
        local_presence="storefront",
        audit_type="Own brand",
        acknowledgement="yes",
    )
    base.update(over)
    return base


def test_intake_payload_valid_and_local_presence_enum():
    p = IntakePayload(**_intake_kwargs())
    assert p.tier == "Audit"
    assert p.local_presence == "storefront"


def test_intake_payload_rejects_bad_tier():
    with pytest.raises(ValidationError):
        IntakePayload(**_intake_kwargs(tier="Free"))


def test_intake_payload_rejects_bad_local_presence():
    with pytest.raises(ValidationError):
        IntakePayload(**_intake_kwargs(local_presence="single"))  # Python-side vocab


def test_citation_share_leader_optional():
    c = CitationShareResult(
        you={"name": "Acme", "percent": 22},
        promptsTested=8, enginesTested=4, competitorsCount=0,
    )
    assert c.leader is None


def test_audit_deliverable_playbook_optional():
    d = AuditDeliverable(
        pdfUrl="https://artifacts.web-cited.com/1/audit-report.pdf",
        schemaPackZipUrl="https://artifacts.web-cited.com/1/schema-pack.zip",
        citationShare=CitationShareResult(
            you={"name": "Acme", "percent": 22},
            promptsTested=8, enginesTested=4, competitorsCount=0,
        ),
        deliveredInBusinessDays=7,
    )
    assert d.playbookUrl is None


def test_audit_deliverable_excludes_none_on_dump():
    d = AuditDeliverable(
        pdfUrl="https://x/y.pdf",
        schemaPackZipUrl="https://x/z.zip",
        citationShare=CitationShareResult(
            you={"name": "Acme", "percent": 22},
            promptsTested=8, enginesTested=4, competitorsCount=0,
        ),
        deliveredInBusinessDays=7,
    )
    dumped = d.model_dump(exclude_none=True)
    assert "playbookUrl" not in dumped
    assert "leader" not in dumped["citationShare"]


def test_audit_completion_body_roundtrip():
    body = AuditCompletionBody(
        dealId="18234567890",
        completedAt="2026-04-22T16:47:12.345Z",
        durationSeconds=5827,
        deliverable=AuditDeliverable(
            pdfUrl="https://x/y.pdf",
            schemaPackZipUrl="https://x/z.zip",
            citationShare=CitationShareResult(
                you={"name": "Acme", "percent": 22},
                leader={"name": "CompA", "percent": 67},
                promptsTested=8, enginesTested=4, competitorsCount=1,
            ),
            deliveredInBusinessDays=7,
        ),
    )
    assert body.deliverable.citationShare.leader.name == "CompA"


def test_artifact_urls_dataclass_has_playbook_optional():
    urls = ArtifactUrls(
        pdf_url="https://x/y.pdf",
        playbook_url=None,
        schema_pack_zip_url="https://x/z.zip",
    )
    assert urls.playbook_url is None
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_audit_contract_models.py -q`
Expected: FAIL (ImportError for new symbols).

- [ ] **Step 3: Implement models**

At the bottom of `src/pipeline/models.py`, append:

```python
# --- Audit-wiring contract models (2026-04-22 spec) ------------------------
# These mirror the TS types in web-cited-api/src/types.ts. Field NAMES match
# TS camelCase intentionally so the JSON wire format is identical across
# both sides. Python code using these models reads camelCase attributes.
#
# Add these imports to the top of the file if they're not already present:
#
#     from dataclasses import dataclass
#     from typing import Literal
#     from pydantic import BaseModel, ConfigDict


class IntakePayload(BaseModel):
    """Mirrors TS IntakePayload exactly. NOT the same as the looser
    dev-mode `Intake` in intake.py — that one stays for ad-hoc CLI runs.
    `extra="ignore"` lets TS bot-trap fields (_gotcha, ts_loaded) pass
    through harmlessly if they land in the JSON.
    """

    model_config = ConfigDict(extra="ignore")

    tier: Literal["Pulse", "Audit", "Enterprise"]
    first_name: str
    last_name: str
    company: str
    email: str
    website: str
    business_one_liner: str
    brand_qualifier: str | None = None
    buyer_questions: str
    competitors: str
    geo_focus: str
    local_presence: Literal["storefront", "service_area", "online_only"]
    cms: str | None = None
    sitemap: str | None = None
    audit_type: Literal[
        "Own brand", "Competitor / market intel", "Client (agency)", "Other"
    ]
    referrer: str | None = None
    acknowledgement: Literal["yes"]


class _NamePercent(BaseModel):
    name: str
    percent: int


class CitationShareResult(BaseModel):
    you: _NamePercent
    leader: _NamePercent | None = None
    promptsTested: int
    enginesTested: int
    competitorsCount: int


class AuditDeliverable(BaseModel):
    pdfUrl: str
    playbookUrl: str | None = None
    schemaPackZipUrl: str
    citationShare: CitationShareResult
    deliveredInBusinessDays: int


class AuditCompletionBody(BaseModel):
    dealId: str
    completedAt: str  # ISO8601 with millis — Worker parses as string
    durationSeconds: int
    deliverable: AuditDeliverable


@dataclass(frozen=True)
class ArtifactUrls:
    """Return value from artifacts.upload_artifacts()."""

    pdf_url: str
    playbook_url: str | None
    schema_pack_zip_url: str


@dataclass(frozen=True)
class AuditRunResult:
    """Return value from run_audit() — wraps AuditReport with the extras
    the Worker-driven flow needs (R2 URLs + citation-share summary).
    """

    report: "AuditReport"
    artifact_urls: ArtifactUrls
    citation_share: CitationShareResult
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `pytest tests/test_audit_contract_models.py -q`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/models.py tests/test_audit_contract_models.py
git commit -m "models: add IntakePayload + AuditCompletionBody + contract types"
```

---

### Task A4: Shared contract fixture + contract test

**Files:**
- Create: `/Users/craigkokesh/web-cited-pipeline/tests/fixtures/audit-completion.json`
- Create: `/Users/craigkokesh/web-cited-pipeline/tests/test_contract.py`

- [ ] **Step 1: Write the fixture**

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

- [ ] **Step 2: Write the contract test**

`tests/test_contract.py`:

```python
import json
from pathlib import Path

from pipeline.models import AuditCompletionBody

FIXTURE = Path(__file__).parent / "fixtures" / "audit-completion.json"


def test_fixture_parses():
    body = AuditCompletionBody.model_validate(json.loads(FIXTURE.read_text()))
    assert body.dealId == "18234567890"
    assert body.deliverable.citationShare.leader.percent == 67


def test_fixture_wire_roundtrip_exclude_none_preserves_known_fields():
    body = AuditCompletionBody.model_validate(json.loads(FIXTURE.read_text()))
    dumped = body.model_dump(exclude_none=True)
    assert dumped["deliverable"]["playbookUrl"].startswith("https://")
    assert "leader" in dumped["deliverable"]["citationShare"]
```

- [ ] **Step 3: Run**

Run: `pytest tests/test_contract.py -q`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add tests/fixtures/audit-completion.json tests/test_contract.py
git commit -m "tests: add shared audit-completion contract fixture"
```

---

### Task A5: R2 uploader (`artifacts.py`)

**Files:**
- Create: `/Users/craigkokesh/web-cited-pipeline/src/pipeline/artifacts.py`
- Create: `/Users/craigkokesh/web-cited-pipeline/tests/test_artifacts.py`

- [ ] **Step 1: Write failing test**

`tests/test_artifacts.py`:

```python
import boto3
import pytest
from moto import mock_aws

from pipeline.artifacts import upload_artifacts


@pytest.fixture
def r2_env(monkeypatch):
    monkeypatch.setenv("R2_ACCOUNT_ID", "acc")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "ak")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "sk")


@mock_aws
def test_uploads_three_files_with_correct_content_types(r2_env):
    # Create the bucket in the mocked backend; moto uses a single global
    # S3 so the boto3 client inside upload_artifacts sees it too.
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket="web-cited-audit-artifacts")

    urls = upload_artifacts(
        deal_id="12345",
        pdf_bytes=b"%PDF-1.7 fake",
        playbook_html="<html>playbook</html>",
        schema_zip_bytes=b"PK\x03\x04 fake zip",
    )

    assert urls.pdf_url == "https://artifacts.web-cited.com/12345/audit-report.pdf"
    assert urls.playbook_url == "https://artifacts.web-cited.com/12345/playbook/index.html"
    assert urls.schema_pack_zip_url == "https://artifacts.web-cited.com/12345/schema-pack.zip"

    pdf = s3.get_object(Bucket="web-cited-audit-artifacts", Key="12345/audit-report.pdf")
    assert pdf["ContentType"] == "application/pdf"
    pb = s3.get_object(Bucket="web-cited-audit-artifacts", Key="12345/playbook/index.html")
    assert pb["ContentType"].startswith("text/html")
    zp = s3.get_object(Bucket="web-cited-audit-artifacts", Key="12345/schema-pack.zip")
    assert zp["ContentType"] == "application/zip"


@mock_aws
def test_playbook_optional(r2_env):
    s3 = boto3.client("s3", region_name="us-east-1")
    s3.create_bucket(Bucket="web-cited-audit-artifacts")

    urls = upload_artifacts(
        deal_id="12345",
        pdf_bytes=b"%PDF-1.7",
        playbook_html=None,
        schema_zip_bytes=b"PK",
    )

    assert urls.playbook_url is None
    # Playbook key must NOT exist.
    listed = s3.list_objects_v2(Bucket="web-cited-audit-artifacts", Prefix="12345/playbook/")
    assert listed.get("KeyCount", 0) == 0
```

- [ ] **Step 2: Run test to confirm failure**

Run: `pytest tests/test_artifacts.py -q`
Expected: FAIL — import error.

- [ ] **Step 3: Implement `artifacts.py`**

```python
"""R2 uploader for audit artifacts.

Writes three files per audit to a single dealId-prefixed key space:

    {dealId}/audit-report.pdf          (application/pdf)
    {dealId}/playbook/index.html       (text/html)                [optional]
    {dealId}/schema-pack.zip           (application/zip)

R2 exposes an S3-compatible API at
https://{r2_account_id}.r2.cloudflarestorage.com. We use boto3 with the
account-scoped endpoint URL. Custom domain at artifacts.web-cited.com
serves the same bucket publicly (configured in the Cloudflare dashboard).
"""

from __future__ import annotations

import boto3
from botocore.config import Config

from .config import load_settings
from .models import ArtifactUrls


def _client():
    s = load_settings()
    if not (s.r2_account_id and s.r2_access_key_id and s.r2_secret_access_key):
        raise RuntimeError(
            "R2 credentials missing — set R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / "
            "R2_SECRET_ACCESS_KEY in ~/.config/webcited/pipeline.env"
        )
    return boto3.client(
        "s3",
        endpoint_url=f"https://{s.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=s.r2_access_key_id,
        aws_secret_access_key=s.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def upload_artifacts(
    deal_id: str,
    pdf_bytes: bytes,
    playbook_html: str | None,
    schema_zip_bytes: bytes,
) -> ArtifactUrls:
    """Upload the three artifact files to R2 and return public URLs."""
    s = load_settings()
    client = _client()
    bucket = s.r2_bucket_name
    base = s.r2_public_base_url.rstrip("/")

    client.put_object(
        Bucket=bucket,
        Key=f"{deal_id}/audit-report.pdf",
        Body=pdf_bytes,
        ContentType="application/pdf",
    )

    playbook_url: str | None = None
    if playbook_html is not None:
        client.put_object(
            Bucket=bucket,
            Key=f"{deal_id}/playbook/index.html",
            Body=playbook_html.encode("utf-8"),
            ContentType="text/html; charset=utf-8",
        )
        playbook_url = f"{base}/{deal_id}/playbook/index.html"

    client.put_object(
        Bucket=bucket,
        Key=f"{deal_id}/schema-pack.zip",
        Body=schema_zip_bytes,
        ContentType="application/zip",
    )

    return ArtifactUrls(
        pdf_url=f"{base}/{deal_id}/audit-report.pdf",
        playbook_url=playbook_url,
        schema_pack_zip_url=f"{base}/{deal_id}/schema-pack.zip",
    )
```

**Note for implementer:** `moto` mocks the generic AWS S3 API, not R2's endpoint URL. For the test to pass, the boto3 client's endpoint URL must be overridable by the mock. Since moto patches `boto3.client("s3", ...)` at the botocore level, the custom `endpoint_url` is ignored during test and the mock intercepts as if it were regular S3. Smoke-test this by running the test; if moto rejects the custom endpoint URL, inject the client via a module-level hook that tests can monkeypatch instead.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_artifacts.py -q`
Expected: 2 passed. If moto complains about `endpoint_url`, refactor `_client()` to read `AWS_ENDPOINT_URL` env var first (moto respects this) and set that instead of passing `endpoint_url=` explicitly during tests.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/artifacts.py tests/test_artifacts.py
git commit -m "artifacts: R2 uploader with dealId-keyed PDF + Playbook + schema zip"
```

---

### Task A6: Completion client with retry + SQLite dead-letter

**Files:**
- Create: `/Users/craigkokesh/web-cited-pipeline/src/pipeline/completion_client.py`
- Create: `/Users/craigkokesh/web-cited-pipeline/tests/test_completion_client.py`

- [ ] **Step 1: Write failing tests**

`tests/test_completion_client.py`:

```python
import asyncio
import sqlite3
from pathlib import Path

import httpx
import pytest
from freezegun import freeze_time

from pipeline.completion_client import (
    RETRY_DELAYS_S,
    drain_pending_callbacks,
    post_completion,
    _open_db,
)
from pipeline.models import (
    AuditCompletionBody,
    AuditDeliverable,
    CitationShareResult,
)


def _body() -> AuditCompletionBody:
    return AuditCompletionBody(
        dealId="123",
        completedAt="2026-04-22T00:00:00.000Z",
        durationSeconds=60,
        deliverable=AuditDeliverable(
            pdfUrl="https://x/y.pdf",
            schemaPackZipUrl="https://x/z.zip",
            citationShare=CitationShareResult(
                you={"name": "A", "percent": 10},
                promptsTested=1, enginesTested=4, competitorsCount=0,
            ),
            deliveredInBusinessDays=7,
        ),
    )


@pytest.fixture
def tmp_db(monkeypatch, tmp_path):
    p = tmp_path / "pipeline.db"
    monkeypatch.setenv("PIPELINE_DB_PATH", str(p))
    yield p


@pytest.fixture
def completion_env(monkeypatch):
    monkeypatch.setenv("AUDIT_COMPLETE_URL", "https://worker.test/audit/complete")
    monkeypatch.setenv("AUDIT_COMPLETE_SECRET", "tok-out")


def test_happy_path_no_retry(tmp_db, completion_env):
    calls = []

    def _handler(request: httpx.Request) -> httpx.Response:
        calls.append(dict(request.headers))
        return httpx.Response(200, json={"ok": True})

    transport = httpx.MockTransport(_handler)
    asyncio.run(post_completion(_body(), transport=transport))

    assert len(calls) == 1
    assert calls[0]["authorization"] == "Bearer tok-out"

    # No dead-letter row.
    db = _open_db()
    assert db.execute("SELECT COUNT(*) FROM pending_completion_callbacks").fetchone()[0] == 0


def test_retries_then_succeeds(tmp_db, completion_env):
    n = {"count": 0}

    def _handler(request: httpx.Request) -> httpx.Response:
        n["count"] += 1
        if n["count"] < 3:
            return httpx.Response(503)
        return httpx.Response(200)

    transport = httpx.MockTransport(_handler)
    with freeze_time("2026-04-22T00:00:00Z") as frozen:
        async def _go():
            # Patch asyncio.sleep to advance frozen time + yield.
            import asyncio as _a
            orig_sleep = _a.sleep

            async def fake_sleep(s):
                frozen.tick(delta=s)
                await orig_sleep(0)

            _a.sleep = fake_sleep
            try:
                await post_completion(_body(), transport=transport)
            finally:
                _a.sleep = orig_sleep

        asyncio.run(_go())

    assert n["count"] == 3


def test_dead_letter_after_all_retries(tmp_db, completion_env):
    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500)

    transport = httpx.MockTransport(_handler)

    async def _go():
        import asyncio as _a
        orig_sleep = _a.sleep

        async def fake_sleep(s):
            await orig_sleep(0)

        _a.sleep = fake_sleep
        try:
            await post_completion(_body(), transport=transport)
        finally:
            _a.sleep = orig_sleep

    asyncio.run(_go())

    db = _open_db()
    rows = db.execute(
        "SELECT deal_id, attempt_count FROM pending_completion_callbacks"
    ).fetchall()
    assert len(rows) == 1
    assert rows[0][0] == "123"
    assert rows[0][1] == len(RETRY_DELAYS_S)


def test_drain_removes_row_on_success(tmp_db, completion_env):
    # Seed a row manually as if a previous run dead-lettered.
    db = _open_db()
    import json as _json
    db.execute(
        "INSERT INTO pending_completion_callbacks "
        "(deal_id, payload_json, next_retry_at, attempt_count) "
        "VALUES (?, ?, ?, ?)",
        ("123", _body().model_dump_json(exclude_none=True), "2026-04-22T00:00:00Z", 0),
    )
    db.commit()

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200)

    transport = httpx.MockTransport(_handler)
    asyncio.run(drain_pending_callbacks(transport=transport))

    assert db.execute("SELECT COUNT(*) FROM pending_completion_callbacks").fetchone()[0] == 0
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_completion_client.py -q`
Expected: FAIL — ImportError.

- [ ] **Step 3: Implement**

Create `src/pipeline/completion_client.py`:

```python
"""Python → Worker completion callback with retry + SQLite dead-letter.

Happy path: POST AuditCompletionBody as JSON with Bearer auth. 2xx → done.

Failure path:
    1. Retry 5 times at the intervals in RETRY_DELAYS_S.
    2. Still failing → write to SQLite `pending_completion_callbacks`.
    3. APScheduler job (started from api.py at app boot) calls
       drain_pending_callbacks() every 5 minutes forever. Worker-side
       idempotency sentinel makes the forever-loop safe.
"""

from __future__ import annotations

import asyncio
import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import httpx

from .config import load_settings
from .models import AuditCompletionBody

RETRY_DELAYS_S: tuple[float, ...] = (1.0, 4.0, 15.0, 60.0, 300.0)


def _db_path() -> Path:
    override = os.environ.get("PIPELINE_DB_PATH")
    if override:
        return Path(override)
    base = Path.home() / ".local" / "share" / "webcited"
    base.mkdir(parents=True, exist_ok=True)
    return base / "pipeline.db"


def _open_db() -> sqlite3.Connection:
    db = sqlite3.connect(_db_path())
    db.execute(
        """
        CREATE TABLE IF NOT EXISTS pending_completion_callbacks (
            deal_id       TEXT PRIMARY KEY,
            payload_json  TEXT NOT NULL,
            next_retry_at TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    db.commit()
    return db


async def _send(
    body: AuditCompletionBody,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> httpx.Response:
    s = load_settings()
    if not s.audit_complete_secret:
        raise RuntimeError("AUDIT_COMPLETE_SECRET is unset — cannot post completion")
    async with httpx.AsyncClient(transport=transport, timeout=30.0) as client:
        return await client.post(
            s.audit_complete_url,
            headers={
                "Authorization": f"Bearer {s.audit_complete_secret}",
                "Content-Type": "application/json",
            },
            content=body.model_dump_json(exclude_none=True),
        )


async def post_completion(
    body: AuditCompletionBody,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    """Send completion; dead-letter on persistent failure."""
    for delay in (0.0, *RETRY_DELAYS_S):
        if delay:
            await asyncio.sleep(delay)
        try:
            resp = await _send(body, transport=transport)
            if 200 <= resp.status_code < 300:
                return
        except Exception:
            # Swallow and retry; the final failure path is the dead letter.
            pass

    # All retries exhausted → dead-letter.
    db = _open_db()
    db.execute(
        "INSERT OR REPLACE INTO pending_completion_callbacks "
        "(deal_id, payload_json, next_retry_at, attempt_count) "
        "VALUES (?, ?, ?, ?)",
        (
            body.dealId,
            body.model_dump_json(exclude_none=True),
            datetime.now(timezone.utc).isoformat(),
            len(RETRY_DELAYS_S),
        ),
    )
    db.commit()
    db.close()


async def drain_pending_callbacks(
    *, transport: httpx.AsyncBaseTransport | None = None,
) -> None:
    """Re-try every row in pending_completion_callbacks. Remove on 2xx."""
    db = _open_db()
    rows = db.execute(
        "SELECT deal_id, payload_json FROM pending_completion_callbacks"
    ).fetchall()
    for deal_id, payload_json in rows:
        body = AuditCompletionBody.model_validate(json.loads(payload_json))
        try:
            resp = await _send(body, transport=transport)
            if 200 <= resp.status_code < 300:
                db.execute(
                    "DELETE FROM pending_completion_callbacks WHERE deal_id = ?",
                    (deal_id,),
                )
                db.commit()
        except Exception:
            # Leave row in place; next drain will retry.
            pass
    db.close()
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_completion_client.py -q`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/completion_client.py tests/test_completion_client.py
git commit -m "completion-client: bearer POST with retry + SQLite dead-letter drain"
```

---

### Task A7: Refactor `cli.py` — extract `run_audit` + gate commerce

**Files:**
- Modify: `/Users/craigkokesh/web-cited-pipeline/src/pipeline/cli.py`
- Create: `/Users/craigkokesh/web-cited-pipeline/tests/test_run_audit.py`

- [ ] **Step 1: Write failing test**

`tests/test_run_audit.py`:

```python
import asyncio
from unittest.mock import patch

import pytest

from pipeline.cli import _local_presence_to_pipeline, run_audit
from pipeline.models import AuditReport, IntakePayload


def _intake() -> IntakePayload:
    return IntakePayload(
        tier="Audit", first_name="S", last_name="M", company="Acme",
        email="s@a.com", website="https://acme.com",
        business_one_liner="HVAC", buyer_questions="q1\nq2",
        competitors="https://c1.com", geo_focus="US",
        local_presence="storefront", audit_type="Own brand",
        acknowledgement="yes",
    )


def test_local_presence_mapping():
    assert _local_presence_to_pipeline("storefront") == "single"
    assert _local_presence_to_pipeline("service_area") == "single"
    assert _local_presence_to_pipeline("online_only") == "none"


def test_run_audit_returns_report_and_artifact_urls():
    intake = _intake()

    async def fake_audit(url, ctx, checks):
        return []  # empty results

    fake_report = AuditReport(
        domain="acme.com", target_url="https://acme.com",
        results=[], citation_divergence=None,
    )

    with patch("pipeline.cli._audit_core", return_value=asyncio.Future()) as mock_core, \
         patch("pipeline.cli.upload_artifacts") as mock_up:
        mock_core.return_value.set_result(fake_report)
        mock_up.return_value.pdf_url = "https://artifacts.web-cited.com/1/audit-report.pdf"
        mock_up.return_value.playbook_url = None
        mock_up.return_value.schema_pack_zip_url = "https://artifacts.web-cited.com/1/schema-pack.zip"

        result = asyncio.run(run_audit(intake, deal_id="1"))

    assert result.report.domain == "acme.com"
    assert result.artifact_urls.pdf_url.endswith("audit-report.pdf")
```

- [ ] **Step 2: Run to confirm failure**

Run: `pytest tests/test_run_audit.py -q`
Expected: FAIL.

- [ ] **Step 3: Refactor `cli.py`**

Rename the existing private `_audit` to `_audit_core` (keeps the old signature). Then add, near the top of the file (below imports):

```python
from .artifacts import upload_artifacts
from .models import (
    ArtifactUrls,
    AuditRunResult,
    CitationShareResult,
    IntakePayload,
)


def _local_presence_to_pipeline(v: str) -> str:
    """Map TS IntakePayload.local_presence → Python pipeline vocab.

    TS vocab is *kind of business*; pipeline vocab is *how many locations*.
    'storefront' and 'service_area' both have one GBP entity to look up
    → 'single'. 'online_only' skips GBP entirely → 'none'. The pipeline's
    'multiple' value has no corresponding TS form field in v1.
    """
    return {"storefront": "single", "service_area": "single", "online_only": "none"}[v]


def _queries_from_intake(intake: IntakePayload) -> list[str]:
    out = [q.strip() for q in intake.buyer_questions.splitlines() if q.strip()]
    return out[:20]  # matches MAX_QUERIES in intake.py


async def run_audit(intake: IntakePayload, deal_id: str) -> AuditRunResult:
    """Pure-compute audit: run checks, render HTML, upload to R2, return
    a self-contained AuditRunResult. No Stripe / HubSpot / Airtable /
    mailer side-effects. Called by the FastAPI api.py and (when
    `pipeline_commerce_enabled` is false) by the Typer `audit` command.
    """
    queries = _queries_from_intake(intake)
    url = intake.website
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    report = await _audit_core(
        url,
        queries,
        company_name=intake.company,
        local_presence=_local_presence_to_pipeline(intake.local_presence),
        geo_focus=intake.geo_focus,
        brand_qualifier=intake.brand_qualifier,
    )

    # Render HTML, convert to PDF bytes via WeasyPrint (Task A8 wires this).
    from weasyprint import HTML  # lazy import: WeasyPrint has a heavy native init
    from .reporter_html import render_html_string

    html = render_html_string(report)
    pdf_bytes = HTML(string=html).write_pdf()

    # v1 does not ship a Playbook artifact (Playbook spec is separate).
    # Schema pack is not yet auto-built either; ship an empty zip so the
    # contract is satisfied and the delivery email's link doesn't 404.
    import io, zipfile

    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w") as zf:
        zf.writestr("README.txt", "Schema pack placeholder — see Task A11.")

    urls = upload_artifacts(
        deal_id=deal_id,
        pdf_bytes=pdf_bytes,
        playbook_html=None,
        schema_zip_bytes=zbuf.getvalue(),
    )

    citation_share = _summarize_citation_share(report, intake)

    return AuditRunResult(
        report=report, artifact_urls=urls, citation_share=citation_share,
    )


def _summarize_citation_share(report, intake: IntakePayload) -> CitationShareResult:
    """Summarize the LLM citation checks into a headline stat.

    v1 lifts the number directly from the existing citation_divergence
    stats: `you.percent` is (cited_by_count / prompts * 100) summed across
    engines. Leader is the top competitor by the same measure, or None
    when the intake had zero competitors.
    """
    cd = report.citation_divergence
    prompts = cd.stats.total_queries if cd else 0
    # TODO-in-future: compute per-brand. v1 ships a simplified summary.
    you_pct = 0
    if cd and prompts:
        evaluated = cd.stats.all_cite + cd.stats.disagree
        you_pct = round(100 * evaluated / prompts) if prompts else 0

    comp_urls = [u.strip() for u in (intake.competitors or "").splitlines() if u.strip()]
    return CitationShareResult(
        you={"name": intake.company, "percent": you_pct},
        leader=None,  # v1 — pipeline doesn't yet compute per-competitor shares
        promptsTested=prompts,
        enginesTested=4,
        competitorsCount=len(comp_urls),
    )
```

Then inside the existing `audit` Typer command body, wrap the side-effects (Stripe invoice, HubSpot sync, Airtable sync, Resend delivery) with:

```python
    if settings.pipeline_commerce_enabled:
        # ... existing side-effect calls unchanged ...
    else:
        console.print(
            "[dim]pipeline_commerce_enabled=false — skipping Stripe/HubSpot/Airtable/Resend[/dim]"
        )
```

For the test to pass, `_audit_core` must be importable with the renamed symbol and `run_audit` must accept `(intake: IntakePayload, deal_id: str)`.

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_run_audit.py tests/test_audit_contract_models.py -q`
Expected: 3 + 7 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/cli.py tests/test_run_audit.py
git commit -m "cli: extract run_audit() + gate commerce behind pipeline_commerce_enabled"
```

---

### Task A8: Verify WeasyPrint renders the existing HTML report

**Files:**
- Modify: `/Users/craigkokesh/web-cited-pipeline/src/pipeline/reporter_html.py`
- Create: `/Users/craigkokesh/web-cited-pipeline/tests/test_weasyprint_smoke.py`

- [ ] **Step 1: Expose `render_html_string`**

The existing `reporter_html.py` has `save_html(report, reports_dir) -> Path`. Extract the string-building logic into a new function so `run_audit` can call it without touching disk.

Read `src/pipeline/reporter_html.py` to find the existing `save_html` + internal render logic. Refactor so `save_html` delegates to a new `render_html_string(report) -> str` public helper.

Concrete edit: rename the private template-render block to `render_html_string` and make `save_html` call it, then write bytes:

```python
def render_html_string(report: AuditReport) -> str:
    """Render the AuditReport into a standalone HTML document string."""
    # ... existing Jinja2 render body lifted out of save_html ...
    template = _env.get_template("report.html")
    return template.render(report=report, ...)


def save_html(report: AuditReport, reports_dir: Path) -> Path:
    slug = _report_slug(report)
    out_dir = reports_dir / slug
    out_dir.mkdir(parents=True, exist_ok=True)
    html_path = out_dir / "index.html"
    html_path.write_text(render_html_string(report), encoding="utf-8")
    return html_path
```

(Implementer reads the existing file and adapts; the contract is only that `render_html_string(report) -> str` exists and produces the same HTML `save_html` would write.)

- [ ] **Step 2: Write WeasyPrint smoke test**

`tests/test_weasyprint_smoke.py`:

```python
from datetime import datetime, timezone

from weasyprint import HTML

from pipeline.models import AuditReport
from pipeline.reporter_html import render_html_string


def test_weasyprint_produces_pdf_bytes():
    report = AuditReport(
        domain="acme.com", target_url="https://acme.com",
        started_at=datetime.now(timezone.utc),
        finished_at=datetime.now(timezone.utc),
        results=[], citation_divergence=None,
    )
    html = render_html_string(report)
    assert len(html) > 200
    pdf_bytes = HTML(string=html).write_pdf()
    assert pdf_bytes[:4] == b"%PDF"
    assert len(pdf_bytes) > 1000
```

- [ ] **Step 3: Run test**

Run: `pytest tests/test_weasyprint_smoke.py -q`
Expected: PASS. If WeasyPrint errors on native-lib init, install system deps: `brew install pango cairo gdk-pixbuf libffi` (macOS) and retry.

- [ ] **Step 4: Commit**

```bash
git add src/pipeline/reporter_html.py tests/test_weasyprint_smoke.py
git commit -m "reporter_html: extract render_html_string + WeasyPrint PDF smoke test"
```

---

### Task A9: FastAPI app (`api.py`)

**Files:**
- Create: `/Users/craigkokesh/web-cited-pipeline/src/pipeline/api.py`
- Create: `/Users/craigkokesh/web-cited-pipeline/tests/test_api.py`

- [ ] **Step 1: Write failing tests**

`tests/test_api.py`:

```python
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("PIPELINE_BEARER_TOKEN", "tok-in")
    monkeypatch.setenv("AUDIT_COMPLETE_SECRET", "tok-out")
    monkeypatch.setenv("AUDIT_COMPLETE_URL", "https://worker.test/audit/complete")
    # Avoid APScheduler trying to touch the real DB during test import.
    monkeypatch.setenv("PIPELINE_DISABLE_SCHEDULER", "1")
    from pipeline.api import app
    return TestClient(app)


def _intake_body(deal="123"):
    return {
        "dealId": deal,
        "intake": {
            "tier": "Audit", "first_name": "S", "last_name": "M",
            "company": "Acme", "email": "s@a.com",
            "website": "https://acme.com",
            "business_one_liner": "HVAC",
            "buyer_questions": "q1\nq2",
            "competitors": "https://c1.com",
            "geo_focus": "US",
            "local_presence": "storefront",
            "audit_type": "Own brand",
            "acknowledgement": "yes",
        },
        "triggeredAt": "2026-04-22T00:00:00.000Z",
    }


def test_healthz(client):
    assert client.get("/audit/healthz").json() == {"ok": True}


def test_start_requires_bearer(client):
    r = client.post("/audit/start", json=_intake_body())
    assert r.status_code == 401


def test_start_accepts_and_queues(client, monkeypatch):
    # Swap the background task for a no-op so the test doesn't run a real audit.
    called = {}

    async def fake_worker(deal_id, intake):
        called["deal"] = deal_id

    monkeypatch.setattr("pipeline.api._run_audit_and_post", fake_worker)

    r = client.post(
        "/audit/start",
        json=_intake_body(),
        headers={"Authorization": "Bearer tok-in"},
    )
    assert r.status_code == 202
    assert r.json() == {"dealId": "123", "status": "queued"}


def test_duplicate_start_returns_409(client, monkeypatch):
    async def never(deal_id, intake):
        import asyncio
        await asyncio.sleep(10)  # leave job "running"

    monkeypatch.setattr("pipeline.api._run_audit_and_post", never)

    h = {"Authorization": "Bearer tok-in"}
    r1 = client.post("/audit/start", json=_intake_body("999"), headers=h)
    assert r1.status_code == 202
    r2 = client.post("/audit/start", json=_intake_body("999"), headers=h)
    assert r2.status_code == 409


def test_status_endpoint(client, monkeypatch):
    async def never(deal_id, intake):
        import asyncio
        await asyncio.sleep(10)

    monkeypatch.setattr("pipeline.api._run_audit_and_post", never)

    h = {"Authorization": "Bearer tok-in"}
    client.post("/audit/start", json=_intake_body("555"), headers=h)

    r = client.get("/audit/555", headers=h)
    assert r.status_code == 200
    assert r.json()["dealId"] == "555"
    assert r.json()["status"] in {"queued", "running"}
```

- [ ] **Step 2: Run tests to confirm failure**

Run: `pytest tests/test_api.py -q`
Expected: FAIL (ImportError for `pipeline.api`).

- [ ] **Step 3: Implement `api.py`**

```python
"""FastAPI surface for the audit pipeline.

Routes:
    GET  /audit/healthz       — liveness for cloudflared + operator
    POST /audit/start         — bearer-authed, body AuditStartBody; 202 + bg task
    GET  /audit/{dealId}      — bearer-authed, job status for operator debugging

Job state lives in the in-memory JOB_TABLE keyed by dealId. Pipeline
restart loses the table — operator re-triggers via the Worker's
/audit/retrigger. The Worker-side KV sentinel is the durable truth.
"""

from __future__ import annotations

import asyncio
import os
import traceback
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from .completion_client import drain_pending_callbacks, post_completion
from .config import load_settings
from .models import (
    AuditCompletionBody,
    AuditDeliverable,
    IntakePayload,
)
from .observability import init_sentry

JobStatus = Literal["queued", "running", "done", "failed"]


class AuditStartBody(BaseModel):
    dealId: str
    intake: IntakePayload
    triggeredAt: str


class JobState(BaseModel):
    dealId: str
    status: JobStatus
    startedAt: str
    completedAt: str | None = None
    error: str | None = None


JOB_TABLE: dict[str, JobState] = {}


def _require_bearer(authorization: str | None = Header(default=None)) -> None:
    s = load_settings()
    expected = s.pipeline_bearer_token
    if not expected:
        raise HTTPException(status_code=500, detail="bearer not configured")
    if authorization != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="invalid bearer")


async def _run_audit_and_post(deal_id: str, intake: IntakePayload) -> None:
    """Run the audit, upload artifacts, POST completion. Updates JOB_TABLE."""
    JOB_TABLE[deal_id].status = "running"
    started = datetime.now(timezone.utc)
    try:
        # Lazy import — keeps api.py import-light for tests that only want
        # bearer + routing coverage.
        from .cli import run_audit  # noqa: WPS433
        result = await run_audit(intake, deal_id=deal_id)

        deliverable = AuditDeliverable(
            pdfUrl=result.artifact_urls.pdf_url,
            playbookUrl=result.artifact_urls.playbook_url,
            schemaPackZipUrl=result.artifact_urls.schema_pack_zip_url,
            citationShare=result.citation_share,
            deliveredInBusinessDays=_business_days_since(started),
        )
        body = AuditCompletionBody(
            dealId=deal_id,
            completedAt=datetime.now(timezone.utc).isoformat()
            .replace("+00:00", "Z"),
            durationSeconds=int(
                (datetime.now(timezone.utc) - started).total_seconds()
            ),
            deliverable=deliverable,
        )
        await post_completion(body)

        JOB_TABLE[deal_id].status = "done"
        JOB_TABLE[deal_id].completedAt = body.completedAt
    except Exception as exc:  # noqa: BLE001
        JOB_TABLE[deal_id].status = "failed"
        JOB_TABLE[deal_id].error = f"{type(exc).__name__}: {exc}\n{traceback.format_exc()}"
        # Sentry surface — init_sentry is a no-op when SENTRY_DSN is unset.
        try:
            import sentry_sdk
            sentry_sdk.capture_exception(exc)
        except Exception:
            pass


def _business_days_since(started: datetime) -> int:
    """Rough business-day count (weekends skipped). Good enough for v1."""
    end = datetime.now(timezone.utc)
    days = 0
    cur = started.replace(hour=0, minute=0, second=0, microsecond=0)
    while cur.date() < end.date():
        cur = cur + timedelta(days=1)
        if cur.weekday() < 5:
            days += 1
    return days


app = FastAPI(title="web-cited-audit-pipeline", version="1.0.0")


@app.on_event("startup")
async def _boot() -> None:
    init_sentry(load_settings())
    if os.environ.get("PIPELINE_DISABLE_SCHEDULER") == "1":
        return
    # Kick off the retry-drain scheduler.
    from apscheduler.schedulers.asyncio import AsyncIOScheduler  # noqa: WPS433

    sched = AsyncIOScheduler()
    sched.add_job(drain_pending_callbacks, "interval", minutes=5)
    sched.start()
    app.state.scheduler = sched


@app.get("/audit/healthz")
async def healthz() -> dict:
    return {"ok": True}


@app.post("/audit/start", status_code=202, dependencies=[Depends(_require_bearer)])
async def audit_start(body: AuditStartBody, tasks: BackgroundTasks) -> dict:
    existing = JOB_TABLE.get(body.dealId)
    if existing and existing.status in {"queued", "running", "done"}:
        raise HTTPException(
            status_code=409,
            detail=f"job for dealId={body.dealId} already in state {existing.status}",
        )
    JOB_TABLE[body.dealId] = JobState(
        dealId=body.dealId,
        status="queued",
        startedAt=datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    )
    tasks.add_task(_run_audit_and_post, body.dealId, body.intake)
    return {"dealId": body.dealId, "status": "queued"}


@app.get("/audit/{deal_id}", dependencies=[Depends(_require_bearer)])
async def audit_status(deal_id: str) -> JobState:
    state = JOB_TABLE.get(deal_id)
    if not state:
        raise HTTPException(status_code=404, detail="not found")
    return state
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/test_api.py -q`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/api.py tests/test_api.py
git commit -m "api: FastAPI with /audit/start + /audit/{dealId} + /audit/healthz"
```

---

### Task A10: launchd scripts + plists + runbook

**Files:**
- Create: `/Users/craigkokesh/web-cited-pipeline/scripts/run-api.sh`
- Create: `/Users/craigkokesh/web-cited-pipeline/scripts/run-tunnel.sh`
- Create: `/Users/craigkokesh/web-cited-pipeline/scripts/launchd/com.webcited.audit-api.plist`
- Create: `/Users/craigkokesh/web-cited-pipeline/scripts/launchd/com.webcited.audit-tunnel.plist`
- Create: `/Users/craigkokesh/web-cited-pipeline/docs/ops/launchd-setup.md`

- [ ] **Step 1: Write `scripts/run-api.sh`**

```bash
#!/usr/bin/env bash
# Invoked by com.webcited.audit-api.plist at user login.
# Loads pipeline env, exec's uvicorn on localhost only (cloudflared fronts it).
set -euo pipefail

ENV_FILE="${HOME}/.config/webcited/pipeline.env"
if [[ ! -r "$ENV_FILE" ]]; then
  echo "missing $ENV_FILE — see docs/ops/launchd-setup.md" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

cd "${HOME}/web-cited-pipeline"
exec uvicorn pipeline.api:app --host 127.0.0.1 --port 8000 --log-level info
```

Make it executable: `chmod +x scripts/run-api.sh`.

- [ ] **Step 2: Write `scripts/run-tunnel.sh`**

```bash
#!/usr/bin/env bash
# Invoked by com.webcited.audit-tunnel.plist at user login.
# Runs the named tunnel; cloudflared reads ~/.cloudflared/config.yml.
set -euo pipefail
exec /opt/homebrew/bin/cloudflared tunnel run audit-tunnel
```

Make it executable: `chmod +x scripts/run-tunnel.sh`.

- [ ] **Step 3: Write `com.webcited.audit-api.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.webcited.audit-api</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>exec "$HOME/web-cited-pipeline/scripts/run-api.sh"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key>
  <string>/usr/local/var/log/webcited/audit-api.out.log</string>
  <key>StandardErrorPath</key>
  <string>/usr/local/var/log/webcited/audit-api.err.log</string>
</dict>
</plist>
```

- [ ] **Step 4: Write `com.webcited.audit-tunnel.plist`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.webcited.audit-tunnel</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>exec "$HOME/web-cited-pipeline/scripts/run-tunnel.sh"</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key>
  <string>/usr/local/var/log/webcited/audit-tunnel.out.log</string>
  <key>StandardErrorPath</key>
  <string>/usr/local/var/log/webcited/audit-tunnel.err.log</string>
</dict>
</plist>
```

- [ ] **Step 5: Write runbook `docs/ops/launchd-setup.md`**

```markdown
# Operator-laptop audit-pipeline setup

One-time setup for the laptop that hosts the Python audit pipeline
behind a Cloudflare named tunnel.

## Prerequisites
- macOS with Homebrew.
- `brew install cloudflared pango cairo gdk-pixbuf libffi`.
- `cloudflared login` → authorizes this machine to your CF account.

## 1. Create the named tunnel
```
cloudflared tunnel create audit-tunnel
cloudflared tunnel route dns audit-tunnel audit.web-cited.com
```
Note the tunnel-id printed; it goes into `~/.cloudflared/config.yml`:
```yaml
tunnel: <tunnel-id>
credentials-file: /Users/<you>/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: audit.web-cited.com
    service: http://localhost:8000
  - service: http_status:404
```

## 2. Create the env file
`~/.config/webcited/pipeline.env` (mode 600):
```
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GEMINI_API_KEY=...
PERPLEXITY_API_KEY=...
DATAFORSEO_LOGIN=...
DATAFORSEO_PASSWORD=...
HUBSPOT_TOKEN=...
STRIPE_API_KEY=...   # only used when PIPELINE_COMMERCE_ENABLED=true
SENTRY_DSN=...

PIPELINE_COMMERCE_ENABLED=false
PIPELINE_BEARER_TOKEN=<shared secret with Worker AUDIT_PIPELINE_TOKEN>
AUDIT_COMPLETE_URL=https://api.web-cited.com/audit/complete
AUDIT_COMPLETE_SECRET=<shared secret with Worker AUDIT_COMPLETE_SECRET>

R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
```

`chmod 600 ~/.config/webcited/pipeline.env`.

## 3. Install the launchd plists
```
mkdir -p ~/Library/LaunchAgents /usr/local/var/log/webcited
cp scripts/launchd/com.webcited.audit-api.plist ~/Library/LaunchAgents/
cp scripts/launchd/com.webcited.audit-tunnel.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.webcited.audit-api.plist
launchctl load ~/Library/LaunchAgents/com.webcited.audit-tunnel.plist
```

## 4. Smoke test
```
curl https://audit.web-cited.com/audit/healthz
# => {"ok":true}
```

## Troubleshooting
- `tail -F /usr/local/var/log/webcited/audit-api.err.log`
- `launchctl kickstart -k gui/$(id -u)/com.webcited.audit-api`
- `cloudflared tunnel info audit-tunnel`
```

- [ ] **Step 6: Commit**

```bash
git add scripts/run-api.sh scripts/run-tunnel.sh scripts/launchd/ docs/ops/launchd-setup.md
git commit -m "ops: launchd plists + run scripts + operator runbook"
```

---

### Task A11: Pipeline-side smoke test under the tunnel

**Files:** (no new files — runbook only)

- [ ] **Step 1: Create R2 bucket**

In the Cloudflare dashboard: R2 → Create bucket → name `web-cited-audit-artifacts`, location `ENAM`. Then Settings → Custom Domains → add `artifacts.web-cited.com`. Verify with `curl -I https://artifacts.web-cited.com/` (expect 404 Unknown Key — means DNS + TLS are wired).

- [ ] **Step 2: Load launchd agents + tunnel**

Follow `docs/ops/launchd-setup.md` steps 1–3.

- [ ] **Step 3: Healthz smoke**

Run: `curl -sS https://audit.web-cited.com/audit/healthz`
Expected: `{"ok":true}`.

- [ ] **Step 4: Start-audit smoke with bearer**

Run:
```bash
curl -sS -X POST https://audit.web-cited.com/audit/start \
  -H "Authorization: Bearer $PIPELINE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  --data @tests/fixtures/smoke-intake.json
```

First time, `tests/fixtures/smoke-intake.json` doesn't exist. Create it with a small Cepheid body:

```json
{
  "dealId": "smoke-1",
  "intake": {
    "tier": "Pulse", "first_name": "Smoke", "last_name": "Test",
    "company": "Cepheid", "email": "craig@web-cited.com",
    "website": "https://www.cepheid.com",
    "business_one_liner": "Molecular diagnostics platform.",
    "buyer_questions": "What is a GeneXpert?\nWho makes the fastest PCR?",
    "competitors": "https://www.roche.com",
    "geo_focus": "United States",
    "local_presence": "online_only",
    "audit_type": "Competitor / market intel",
    "acknowledgement": "yes"
  },
  "triggeredAt": "2026-04-22T00:00:00.000Z"
}
```

Expected 202 + `{"dealId":"smoke-1","status":"queued"}`.

- [ ] **Step 5: Observe job progress + R2 upload**

Run: `curl -sS https://audit.web-cited.com/audit/smoke-1 -H "Authorization: Bearer $PIPELINE_BEARER_TOKEN"` every minute until status is `done` or `failed`.

Then verify R2: `curl -I https://artifacts.web-cited.com/smoke-1/audit-report.pdf` → 200 with `content-type: application/pdf`.

- [ ] **Step 6: Verify completion POST landed**

Since the Worker side isn't wired yet (Part B), `post_completion` will fail all 5 retries and dead-letter. Check: `sqlite3 ~/.local/share/webcited/pipeline.db "SELECT deal_id, attempt_count FROM pending_completion_callbacks;"` → expect `smoke-1|5`.

This is expected. After Part B deploys with `AUDIT_PIPELINE_ENABLED=false`, the next scheduler tick will re-drain successfully and the row will disappear.

- [ ] **Step 7: Commit smoke fixture**

```bash
git add tests/fixtures/smoke-intake.json
git commit -m "tests: add smoke-intake fixture for tunnel smoke test"
```

---

# Part B — TypeScript Worker

Work inside `/Users/craigkokesh/web-cited-api`. Each task runs on the `audit-wiring` branch (create with `git checkout -b audit-wiring` at task start). Tests: `npm test -- --run`.

### Task B1: `AuditCompletionBody` type + contract fixture + contract test

**Files:**
- Modify: `/Users/craigkokesh/web-cited-api/src/types.ts`
- Create: `/Users/craigkokesh/web-cited-api/tests/fixtures/audit-completion.json`
- Create: `/Users/craigkokesh/web-cited-api/src/contract.test.ts`

- [ ] **Step 1: Add `AuditCompletionBody` to `src/types.ts`**

After the existing `AuditDeliverable` interface, append:

```typescript
/**
 * Wire body from Python pipeline → TS `/audit/complete`. Mirrors
 * `pipeline/models.py::AuditCompletionBody`.
 */
export interface AuditCompletionBody {
  dealId: string;
  completedAt: string;      // ISO8601 with millis
  durationSeconds: number;
  deliverable: AuditDeliverable;
}
```

Also extend the `Env` interface with the new bindings:

```typescript
  AUDIT_PIPELINE_TOKEN: string;   // bearer we send to Python
  AUDIT_COMPLETE_SECRET: string;  // bearer Python sends to us
  AUDIT_PIPELINE_URL: string;     // https://audit.web-cited.com
  AUDIT_PIPELINE_ENABLED: string; // "true" or "false" (string — wrangler vars are strings)
```

- [ ] **Step 2: Copy the fixture**

Create `tests/fixtures/audit-completion.json` as a byte-for-byte copy of `/Users/craigkokesh/web-cited-pipeline/tests/fixtures/audit-completion.json`:

```bash
cp /Users/craigkokesh/web-cited-pipeline/tests/fixtures/audit-completion.json \
   /Users/craigkokesh/web-cited-api/tests/fixtures/audit-completion.json
```

- [ ] **Step 3: Write contract test**

`src/contract.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditCompletionBody } from "./types";

// Lightweight runtime validator — no external dep. Mirrors the Python
// Pydantic constraints on the fixture fields the Worker actually reads.
function validateAuditCompletionBody(v: unknown): asserts v is AuditCompletionBody {
  if (!v || typeof v !== "object") throw new Error("not an object");
  const b = v as Record<string, unknown>;
  if (typeof b.dealId !== "string") throw new Error("dealId");
  if (typeof b.completedAt !== "string") throw new Error("completedAt");
  if (typeof b.durationSeconds !== "number") throw new Error("durationSeconds");
  if (!b.deliverable || typeof b.deliverable !== "object") throw new Error("deliverable");
  const d = b.deliverable as Record<string, unknown>;
  if (typeof d.pdfUrl !== "string") throw new Error("deliverable.pdfUrl");
  if (typeof d.schemaPackZipUrl !== "string") throw new Error("deliverable.schemaPackZipUrl");
  if (typeof d.deliveredInBusinessDays !== "number") throw new Error("deliverable.deliveredInBusinessDays");
  if (!d.citationShare || typeof d.citationShare !== "object") throw new Error("citationShare");
}

describe("audit-completion contract fixture", () => {
  it("parses into AuditCompletionBody", () => {
    const raw = JSON.parse(
      readFileSync(join(__dirname, "..", "tests", "fixtures", "audit-completion.json"), "utf8"),
    );
    validateAuditCompletionBody(raw);
    expect(raw.dealId).toBe("18234567890");
    expect(raw.deliverable.citationShare.leader.percent).toBe(67);
  });

  it("byte-for-byte matches the Python-side copy", () => {
    // Parity check — ensures the fixture in this repo hasn't drifted from
    // the pipeline repo. Only enforced locally when both checkouts exist.
    const tsPath = join(__dirname, "..", "tests", "fixtures", "audit-completion.json");
    const pyPath = "/Users/craigkokesh/web-cited-pipeline/tests/fixtures/audit-completion.json";
    try {
      const a = readFileSync(tsPath, "utf8");
      const b = readFileSync(pyPath, "utf8");
      expect(a).toBe(b);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
      // Pipeline repo not checked out locally — skip the parity check.
    }
  });
});
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/craigkokesh/web-cited-api && npm test -- --run contract`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git checkout -b audit-wiring
git add src/types.ts src/contract.test.ts tests/fixtures/audit-completion.json
git commit -m "types: add AuditCompletionBody + Env bindings + shared contract fixture"
```

---

### Task B2: `audit-trigger.ts` (`startAudit`)

**Files:**
- Create: `/Users/craigkokesh/web-cited-api/src/audit-trigger.ts`
- Create: `/Users/craigkokesh/web-cited-api/src/audit-trigger.test.ts`

- [ ] **Step 1: Write failing tests**

`src/audit-trigger.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { startAudit } from "./audit-trigger";
import type { Env, IntakePayload } from "./types";

function mkIntake(over: Partial<IntakePayload> = {}): IntakePayload {
  return {
    tier: "Audit", first_name: "S", last_name: "M",
    company: "Acme", email: "s@a.com",
    website: "https://acme.com",
    business_one_liner: "HVAC",
    buyer_questions: "q1\nq2",
    competitors: "https://c1.com",
    geo_focus: "United States",
    local_presence: "storefront",
    audit_type: "Own brand",
    acknowledgement: "yes",
    ...over,
  };
}

function mkEnv(): Env & { __kv: Map<string, string> } {
  const kv = new Map<string, string>();
  const put = async (k: string, v: string) => { kv.set(k, v); };
  const get = async (k: string) => kv.get(k) ?? null;
  return {
    HUBSPOT_TOKEN: "hs", RESEND_TOKEN: "rs",
    DATAFORSEO_LOGIN: "", DATAFORSEO_PASSWORD: "",
    CAPTURE_SECRET: "cap", STRIPE_SECRET_KEY: "sk",
    STRIPE_WEBHOOK_SECRET: "sw", SCOPE_APPROVE_SECRET: "sa",
    AUDIT_PIPELINE_TOKEN: "tok-in", AUDIT_COMPLETE_SECRET: "tok-out",
    AUDIT_PIPELINE_URL: "https://audit.test",
    AUDIT_PIPELINE_ENABLED: "true",
    NOTIFY_EMAIL: "n@x", THANKS_URL: "", ALLOWED_ORIGINS: "",
    HUBSPOT_PORTAL_ID: "1", SCOPE_EMAIL_THRESHOLD: "0.5",
    CAPTURE_DEAD_LETTER: { get, put } as any,
    INTAKE_CACHE: { get, put } as any,
    __kv: kv,
  };
}

describe("startAudit", () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => { globalThis.fetch = vi.fn(); });
  afterEach(() => { globalThis.fetch = origFetch; });

  it("happy path POSTs to pipeline with bearer + writes sentinel", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("", { status: 202 }));
    const env = mkEnv();
    await startAudit(env, mkIntake(), "dealA", "inv_123");

    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
    const [url, init] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://audit.test/audit/start");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok-in");
    expect(env.__kv.get("audit-started-inv_123")).toBe("1");
  });

  it("sentinel short-circuits a second call", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("", { status: 202 }));
    const env = mkEnv();
    await startAudit(env, mkIntake(), "dealA", "inv_dup");
    await startAudit(env, mkIntake(), "dealA", "inv_dup");
    expect((globalThis.fetch as any).mock.calls.length).toBe(1);
  });

  it("non-2xx response logs a capture with start_failed dealPropertyPatch", async () => {
    (globalThis.fetch as any).mockResolvedValue(new Response("oops", { status: 500 }));
    const env = mkEnv();
    const capSpy = vi.fn().mockResolvedValue(undefined);
    await startAudit(env, mkIntake(), "dealX", "inv_err", { hubspotCapture: capSpy });

    expect(capSpy).toHaveBeenCalledTimes(1);
    const arg = capSpy.mock.calls[0][2];
    expect(arg.kind).toBe("audit_started");
    expect(arg.dealPropertyPatch.audit_status).toBe("start_failed");
  });

  it("transport error path also logs capture", async () => {
    (globalThis.fetch as any).mockRejectedValue(new Error("ECONNREFUSED"));
    const env = mkEnv();
    const capSpy = vi.fn().mockResolvedValue(undefined);
    await startAudit(env, mkIntake(), "dealY", "inv_net", { hubspotCapture: capSpy });
    expect(capSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- --run audit-trigger`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

`src/audit-trigger.ts`:

```typescript
/**
 * Trigger the audit pipeline for a paid invoice.
 *
 * Called from `handleStripeWebhook` → `case "invoice.paid":` immediately
 * after the kickoff-email try-block. Guarded by the AUDIT_PIPELINE_ENABLED
 * feature flag at the call site.
 *
 * Idempotency sentinel `audit-started-${invoiceId}` mirrors the
 * `kickoff-sent-${invoiceId}` pattern — we write the sentinel BEFORE the
 * POST fires so a retry after Worker restart never re-triggers a second
 * audit. Failure mode preference: rather-stuck-than-duplicated.
 */

import type { Env, IntakePayload } from "./types";
import { hubspotCapture as defaultHubspotCapture } from "./hubspot-capture";

const SENTINEL_TTL_S = 60 * 60 * 24 * 90; // 90 days

export async function startAudit(
  env: Env,
  intake: IntakePayload,
  dealId: string,
  invoiceId: string,
  deps: {
    hubspotCapture?: typeof defaultHubspotCapture;
    fetch?: typeof fetch;
  } = {},
): Promise<void> {
  const capture = deps.hubspotCapture ?? defaultHubspotCapture;
  const f = deps.fetch ?? fetch;

  const key = `audit-started-${invoiceId}`;
  const already = await env.INTAKE_CACHE.get(key);
  if (already) {
    console.log(`startAudit: sentinel present for ${invoiceId}, skipping`);
    return;
  }

  // Write sentinel BEFORE the POST — we'd rather have a stuck audit than
  // a duplicate one. See the kickoff-email comment in index.ts for the
  // precedent.
  try {
    await env.INTAKE_CACHE.put(key, "1", { expirationTtl: SENTINEL_TTL_S });
  } catch (err) {
    console.error("startAudit: sentinel KV put failed; aborting", err);
    return;
  }

  const body = JSON.stringify({
    dealId,
    intake,
    triggeredAt: new Date().toISOString(),
  });

  let resp: Response | null = null;
  let transportErr: unknown = null;
  try {
    resp = await f(`${env.AUDIT_PIPELINE_URL}/audit/start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AUDIT_PIPELINE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body,
    });
  } catch (err) {
    transportErr = err;
  }

  if (transportErr || !resp || !resp.ok) {
    const detail = transportErr
      ? `transport error: ${String(transportErr)}`
      : `HTTP ${resp!.status}: ${await resp!.text().catch(() => "")}`;
    console.error(`startAudit failed for ${dealId}/${invoiceId}: ${detail}`);
    await capture(env.HUBSPOT_TOKEN, env.CAPTURE_DEAD_LETTER, {
      kind: "audit_started",
      source: "webhook",
      dealId,
      summary: `Audit start FAILED — operator must retrigger (${detail.slice(0, 120)})`,
      payload: { invoiceId, error: detail },
      dealPropertyPatch: { audit_status: "start_failed" },
    });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run audit-trigger`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/audit-trigger.ts src/audit-trigger.test.ts
git commit -m "audit-trigger: startAudit() with sentinel + capture fallback"
```

---

### Task B3: `audit-complete.ts` (`handleAuditComplete`)

**Files:**
- Create: `/Users/craigkokesh/web-cited-api/src/audit-complete.ts`
- Create: `/Users/craigkokesh/web-cited-api/src/audit-complete.test.ts`

- [ ] **Step 1: Write failing tests**

`src/audit-complete.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleAuditComplete } from "./audit-complete";
import type { Env } from "./types";

function mkEnv() {
  const kv = new Map<string, string>();
  const mk = () => ({
    get: async (k: string) => kv.get(k) ?? null,
    put: async (k: string, v: string) => { kv.set(k, v); },
  });
  return {
    env: {
      HUBSPOT_TOKEN: "hs", RESEND_TOKEN: "rs",
      DATAFORSEO_LOGIN: "", DATAFORSEO_PASSWORD: "",
      CAPTURE_SECRET: "cap", STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "", SCOPE_APPROVE_SECRET: "",
      AUDIT_PIPELINE_TOKEN: "tok-in", AUDIT_COMPLETE_SECRET: "tok-out",
      AUDIT_PIPELINE_URL: "https://audit.test",
      AUDIT_PIPELINE_ENABLED: "true",
      NOTIFY_EMAIL: "n@x", THANKS_URL: "", ALLOWED_ORIGINS: "",
      HUBSPOT_PORTAL_ID: "1", SCOPE_EMAIL_THRESHOLD: "0.5",
      CAPTURE_DEAD_LETTER: mk() as any,
      INTAKE_CACHE: mk() as any,
    } as Env,
    kv,
  };
}

const FIXTURE = {
  dealId: "1", completedAt: "2026-04-22T00:00:00.000Z", durationSeconds: 60,
  deliverable: {
    pdfUrl: "https://x/y.pdf", schemaPackZipUrl: "https://x/z.zip",
    citationShare: {
      you: { name: "Acme", percent: 22 },
      leader: { name: "C1", percent: 67 },
      promptsTested: 8, enginesTested: 4, competitorsCount: 1,
    },
    deliveredInBusinessDays: 7,
  },
};

const INTAKE = {
  tier: "Audit", first_name: "S", last_name: "M",
  company: "Acme", email: "s@a.com", website: "https://acme.com",
  business_one_liner: "x", buyer_questions: "q1",
  competitors: "", geo_focus: "US", local_presence: "storefront",
  audit_type: "Own brand", acknowledgement: "yes",
} as any;

describe("handleAuditComplete", () => {
  it("401 on missing bearer", async () => {
    const { env } = mkEnv();
    const req = new Request("https://x/audit/complete", {
      method: "POST", body: JSON.stringify(FIXTURE),
    });
    const res = await handleAuditComplete(req, env);
    expect(res.status).toBe(401);
  });

  it("401 on wrong bearer", async () => {
    const { env } = mkEnv();
    const req = new Request("https://x/audit/complete", {
      method: "POST",
      headers: { Authorization: "Bearer nope" },
      body: JSON.stringify(FIXTURE),
    });
    const res = await handleAuditComplete(req, env);
    expect(res.status).toBe(401);
  });

  it("500 when INTAKE_CACHE miss", async () => {
    const { env } = mkEnv();
    const req = new Request("https://x/audit/complete", {
      method: "POST",
      headers: { Authorization: "Bearer tok-out" },
      body: JSON.stringify(FIXTURE),
    });
    const res = await handleAuditComplete(req, env);
    expect(res.status).toBe(500);
  });

  it("happy path sends email + captures report_delivered + sets sentinel", async () => {
    const { env, kv } = mkEnv();
    await env.INTAKE_CACHE.put(
      "intake-cache-1",
      JSON.stringify({ intake: INTAKE, score: 0.8, contactId: "c1" }),
    );
    const sendSpy = vi.fn().mockResolvedValue(undefined);
    const capSpy = vi.fn().mockResolvedValue(undefined);

    const req = new Request("https://x/audit/complete", {
      method: "POST",
      headers: { Authorization: "Bearer tok-out" },
      body: JSON.stringify(FIXTURE),
    });
    const res = await handleAuditComplete(req, env, { sendDeliveryEmail: sendSpy, hubspotCapture: capSpy });
    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(capSpy).toHaveBeenCalledTimes(1);
    expect(capSpy.mock.calls[0][2].kind).toBe("report_delivered");
    expect(capSpy.mock.calls[0][2].dealPropertyPatch.audit_status).toBe("delivered");
    expect(kv.get("audit-complete-1")).toBe("1");
  });

  it("idempotency: sentinel present → 200 without sending email", async () => {
    const { env } = mkEnv();
    await env.INTAKE_CACHE.put(
      "intake-cache-1",
      JSON.stringify({ intake: INTAKE, score: 0.8, contactId: "c1" }),
    );
    await env.INTAKE_CACHE.put("audit-complete-1", "1");

    const sendSpy = vi.fn();
    const capSpy = vi.fn();
    const req = new Request("https://x/audit/complete", {
      method: "POST",
      headers: { Authorization: "Bearer tok-out" },
      body: JSON.stringify(FIXTURE),
    });
    const res = await handleAuditComplete(req, env, { sendDeliveryEmail: sendSpy, hubspotCapture: capSpy });
    expect(res.status).toBe(200);
    expect(sendSpy).not.toHaveBeenCalled();
    expect(capSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- --run audit-complete`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/audit-complete.ts`:

```typescript
/**
 * Completion handler for the Python → TS callback.
 *
 * Separate from /capture because /capture is AST-enforced as pure HubSpot
 * logging. This endpoint is the completion *orchestrator* — it sends the
 * delivery email, THEN calls hubspotCapture internally to preserve the
 * single-write-path invariant.
 */

import type { AuditCompletionBody, Env, IntakePayload } from "./types";
import { sendDeliveryEmail as defaultSendDeliveryEmail } from "./delivery-email";
import { hubspotCapture as defaultHubspotCapture } from "./hubspot-capture";
import { fetchCachedIntake } from "./intake-cache";

const SENTINEL_TTL_S = 60 * 60 * 24 * 90; // 90 days

export async function handleAuditComplete(
  req: Request,
  env: Env,
  deps: {
    sendDeliveryEmail?: typeof defaultSendDeliveryEmail;
    hubspotCapture?: typeof defaultHubspotCapture;
  } = {},
): Promise<Response> {
  const send = deps.sendDeliveryEmail ?? defaultSendDeliveryEmail;
  const capture = deps.hubspotCapture ?? defaultHubspotCapture;

  // 1. Bearer check.
  const auth = req.headers.get("authorization") ?? "";
  if (!env.AUDIT_COMPLETE_SECRET || auth !== `Bearer ${env.AUDIT_COMPLETE_SECRET}`) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 2. Parse body.
  let body: AuditCompletionBody;
  try {
    body = (await req.json()) as AuditCompletionBody;
    if (!body.dealId || !body.deliverable?.pdfUrl) {
      throw new Error("missing required fields");
    }
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 422,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 3. Idempotency short-circuit.
  const sentinelKey = `audit-complete-${body.dealId}`;
  const already = await env.INTAKE_CACHE.get(sentinelKey);
  if (already) {
    console.log(`audit-complete: sentinel present for deal ${body.dealId}, noop`);
    return new Response(JSON.stringify({ ok: true, idempotent: true }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  }

  // 4. Load intake.
  const cached = await fetchCachedIntake(env.INTAKE_CACHE, body.dealId);
  if (!cached) {
    console.error(`audit-complete: INTAKE_CACHE miss for deal ${body.dealId}`);
    return new Response(JSON.stringify({ ok: false, error: "intake not cached" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // 5. Send delivery email.
  try {
    await send(env.RESEND_TOKEN, cached.intake as IntakePayload, body.deliverable);
  } catch (err) {
    console.error("audit-complete: sendDeliveryEmail failed", err);
    return new Response(JSON.stringify({ ok: false, error: "email failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // 6. Capture report_delivered.
  try {
    await capture(env.HUBSPOT_TOKEN, env.CAPTURE_DEAD_LETTER, {
      kind: "report_delivered",
      source: "pipeline",
      dealId: body.dealId,
      contactId: cached.contactId,
      summary: `Audit report delivered to ${cached.intake.email}`,
      payload: {
        pdfUrl: body.deliverable.pdfUrl,
        durationSeconds: body.durationSeconds,
        deliveredInBusinessDays: body.deliverable.deliveredInBusinessDays,
      },
      dealPropertyPatch: {
        audit_status: "delivered",
        audit_completed_at: body.completedAt,
      },
    });
  } catch (err) {
    // hubspotCapture already handles its own dead-letter; a throw here is
    // unexpected. Return 500 so Python re-drives — the sentinel isn't set
    // yet, so the next attempt gets another shot.
    console.error("audit-complete: hubspotCapture threw", err);
    return new Response(JSON.stringify({ ok: false, error: "capture failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // 7. Set sentinel.
  await env.INTAKE_CACHE.put(sentinelKey, "1", { expirationTtl: SENTINEL_TTL_S });

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run audit-complete`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/audit-complete.ts src/audit-complete.test.ts
git commit -m "audit-complete: POST handler — bearer + idempotency + email + capture"
```

---

### Task B4: `audit-retrigger.ts`

**Files:**
- Create: `/Users/craigkokesh/web-cited-api/src/audit-retrigger.ts`
- Create: `/Users/craigkokesh/web-cited-api/src/audit-retrigger.test.ts`

- [ ] **Step 1: Write failing tests**

`src/audit-retrigger.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
import { handleAuditRetrigger } from "./audit-retrigger";
import type { Env } from "./types";

function mkEnv() {
  const kv = new Map<string, string>();
  const mk = () => ({
    get: async (k: string) => kv.get(k) ?? null,
    put: async (k: string, v: string) => { kv.set(k, v); },
  });
  return {
    env: {
      HUBSPOT_TOKEN: "", RESEND_TOKEN: "",
      DATAFORSEO_LOGIN: "", DATAFORSEO_PASSWORD: "",
      CAPTURE_SECRET: "cap", STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "", SCOPE_APPROVE_SECRET: "",
      AUDIT_PIPELINE_TOKEN: "tok-in", AUDIT_COMPLETE_SECRET: "tok-out",
      AUDIT_PIPELINE_URL: "https://audit.test",
      AUDIT_PIPELINE_ENABLED: "true",
      NOTIFY_EMAIL: "", THANKS_URL: "", ALLOWED_ORIGINS: "",
      HUBSPOT_PORTAL_ID: "1", SCOPE_EMAIL_THRESHOLD: "0.5",
      CAPTURE_DEAD_LETTER: mk() as any,
      INTAKE_CACHE: mk() as any,
    } as Env,
    kv,
  };
}

const INTAKE = {
  tier: "Audit", first_name: "S", last_name: "M",
  company: "Acme", email: "s@a.com", website: "https://acme.com",
  business_one_liner: "x", buyer_questions: "q",
  competitors: "", geo_focus: "US", local_presence: "storefront",
  audit_type: "Own brand", acknowledgement: "yes",
} as any;

describe("handleAuditRetrigger", () => {
  it("401 on wrong token", async () => {
    const { env } = mkEnv();
    const req = new Request("https://x/audit/retrigger?deal=1&token=nope", { method: "POST" });
    const res = await handleAuditRetrigger(req, env);
    expect(res.status).toBe(401);
  });

  it("400 on missing deal param", async () => {
    const { env } = mkEnv();
    const req = new Request("https://x/audit/retrigger?token=cap", { method: "POST" });
    const res = await handleAuditRetrigger(req, env);
    expect(res.status).toBe(400);
  });

  it("404 when deal has no cached intake", async () => {
    const { env } = mkEnv();
    const req = new Request("https://x/audit/retrigger?deal=missing&token=cap", { method: "POST" });
    const res = await handleAuditRetrigger(req, env);
    expect(res.status).toBe(404);
  });

  it("happy path re-invokes startAudit with fresh invoice sentinel key", async () => {
    const { env } = mkEnv();
    await env.INTAKE_CACHE.put(
      "intake-cache-D",
      JSON.stringify({ intake: INTAKE, score: 0.8, contactId: "c1" }),
    );
    const startSpy = vi.fn().mockResolvedValue(undefined);
    const req = new Request("https://x/audit/retrigger?deal=D&token=cap", { method: "POST" });
    const res = await handleAuditRetrigger(req, env, { startAudit: startSpy });
    expect(res.status).toBe(200);
    expect(startSpy).toHaveBeenCalledTimes(1);
    const invoiceArg = startSpy.mock.calls[0][3] as string;
    expect(invoiceArg).toMatch(/^retrigger-\d+$/);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `npm test -- --run audit-retrigger`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/audit-retrigger.ts`:

```typescript
/**
 * Operator re-trigger. Linked from the ops email when a deal shows
 * audit_status=start_failed. Uses query-param token auth to match the
 * existing /capture/retry pattern (operator clicks a link).
 */

import type { Env, IntakePayload } from "./types";
import { startAudit as defaultStartAudit } from "./audit-trigger";
import { fetchCachedIntake } from "./intake-cache";

function htmlResponse(title: string, body: string, status = 200): Response {
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;padding:40px;max-width:620px;margin:0 auto;">
<h1 style="font-family:'Helvetica Neue','Arial Black',sans-serif;">${title}</h1>
<p>${body}</p>
</body></html>`;
  return new Response(html, {
    status, headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function handleAuditRetrigger(
  req: Request,
  env: Env,
  deps: { startAudit?: typeof defaultStartAudit } = {},
): Promise<Response> {
  const startAudit = deps.startAudit ?? defaultStartAudit;

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const dealId = url.searchParams.get("deal");

  if (!token || token !== env.CAPTURE_SECRET) {
    return htmlResponse("Unauthorized", "Invalid token.", 401);
  }
  if (!dealId) {
    return htmlResponse("Bad request", "Missing <code>deal</code> parameter.", 400);
  }

  const cached = await fetchCachedIntake(env.INTAKE_CACHE, dealId);
  if (!cached) {
    return htmlResponse(
      "Not found",
      `No cached intake for deal <code>${dealId}</code> (INTAKE_CACHE TTL may have expired).`,
      404,
    );
  }

  // Fresh sentinel key so the original `audit-started-${invoiceId}` gate
  // doesn't block the retry. Using a timestamped synthetic invoiceId.
  const syntheticInvoiceId = `retrigger-${Date.now()}`;
  await startAudit(env, cached.intake as IntakePayload, dealId, syntheticInvoiceId);

  return htmlResponse(
    "Audit re-triggered",
    `Deal <code>${dealId}</code> re-sent to the audit pipeline. Check HubSpot for status.`,
  );
}
```

- [ ] **Step 4: Run tests**

Run: `npm test -- --run audit-retrigger`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/audit-retrigger.ts src/audit-retrigger.test.ts
git commit -m "audit-retrigger: query-param-token operator re-trigger endpoint"
```

---

### Task B5: Route registration + invoice.paid wiring in `index.ts`

**Files:**
- Modify: `/Users/craigkokesh/web-cited-api/src/index.ts`
- Create: `/Users/craigkokesh/web-cited-api/src/stripe-webhook-audit.test.ts`

- [ ] **Step 1: Export `handleStripeWebhook`**

The `handleStripeWebhook` function in `src/index.ts` is not currently exported — adding `export` to its declaration lets the integration test drive it directly:

```typescript
export async function handleStripeWebhook(
  req: Request,
  env: Env,
): Promise<Response> {
```

- [ ] **Step 2: Register new routes**

In `src/index.ts`, below the existing `if (url.pathname === "/stripe/webhook" ...)` block (around line 858), add:

```typescript
    if (url.pathname === "/audit/complete" && req.method === "POST") {
      const { handleAuditComplete } = await import("./audit-complete");
      return handleAuditComplete(req, env);
    }

    if (url.pathname === "/audit/retrigger" && req.method === "POST") {
      const { handleAuditRetrigger } = await import("./audit-retrigger");
      return handleAuditRetrigger(req, env);
    }
```

- [ ] **Step 3: Wire `startAudit` into invoice.paid handler**

Inside `handleStripeWebhook` → `case "invoice.paid":`, immediately after the outer `if (dealId) { ... }` block that handles the kickoff email (right before `break;`), add:

```typescript
      // Phase 0+1 audit trigger. Gated by feature flag so TS can deploy
      // before the operator laptop is cut over. See
      // docs/superpowers/specs/2026-04-22-audit-pipeline-wiring-design.md.
      if (env.AUDIT_PIPELINE_ENABLED === "true" && dealId) {
        const cached = await fetchCachedIntake(env.INTAKE_CACHE, dealId);
        if (cached) {
          try {
            const { startAudit } = await import("./audit-trigger");
            await startAudit(env, cached.intake, dealId, invoiceId);
          } catch (err) {
            console.error("startAudit failed in invoice.paid handler", err);
          }
        } else {
          console.warn(
            `invoice.paid: AUDIT_PIPELINE_ENABLED=true but no cached intake for deal ${dealId}`,
          );
        }
      }
```

(`fetchCachedIntake` is already imported for the kickoff-email code earlier in the file; reuse that import.)

- [ ] **Step 4: Write integration test for invoice.paid → startAudit**

Create `src/stripe-webhook-audit.test.ts`. Mock `parseWebhookEvent` to return an `invoice.paid` event with dealId metadata, seed `INTAKE_CACHE`, and assert `startAudit` fires (or not, under the flag-off case):

```typescript
import { describe, it, expect, vi } from "vitest";

const startSpy = vi.fn().mockResolvedValue(undefined);
vi.mock("./audit-trigger", () => ({ startAudit: startSpy }));
vi.mock("./stripe", () => ({
  parseWebhookEvent: () => ({
    id: "evt_1", type: "invoice.paid",
    data: { object: { id: "inv_1", metadata: { dealId: "D", contactId: "c", tier: "Audit" } } },
  }),
  verifyWebhookSignature: async () => true,
}));
vi.mock("./hubspot-capture", () => ({
  hubspotCapture: vi.fn().mockResolvedValue(undefined),
  canonicalJson: (v: unknown) => JSON.stringify(v),
}));
vi.mock("./kickoff-email", () => ({
  sendKickoffEmail: vi.fn().mockResolvedValue(undefined),
}));

import { handleStripeWebhook } from "./index";

function mkEnv(enabled: string) {
  const kv = new Map<string, string>();
  const mk = () => ({
    get: async (k: string) => kv.get(k) ?? null,
    put: async (k: string, v: string) => { kv.set(k, v); },
  });
  return {
    RESEND_TOKEN: "", HUBSPOT_TOKEN: "",
    CAPTURE_SECRET: "cap", STRIPE_WEBHOOK_SECRET: "whsec",
    AUDIT_PIPELINE_ENABLED: enabled, AUDIT_PIPELINE_URL: "https://a",
    AUDIT_PIPELINE_TOKEN: "t", AUDIT_COMPLETE_SECRET: "t2",
    CAPTURE_DEAD_LETTER: mk() as any, INTAKE_CACHE: mk() as any,
  } as any;
}

describe("invoice.paid → startAudit wiring", () => {
  it("fires startAudit when flag=true and intake cached", async () => {
    startSpy.mockClear();
    const env = mkEnv("true");
    await env.INTAKE_CACHE.put(
      "intake-cache-D",
      JSON.stringify({ intake: { email: "s@a.com", tier: "Audit", first_name: "S", company: "Acme" }, score: 0.8, contactId: "c" }),
    );
    const req = new Request("https://x/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    });
    const res = await handleStripeWebhook(req, env);
    expect(res.status).toBe(200);
    expect(startSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when flag=false", async () => {
    startSpy.mockClear();
    const env = mkEnv("false");
    await env.INTAKE_CACHE.put(
      "intake-cache-D",
      JSON.stringify({ intake: { email: "s@a.com", tier: "Audit", first_name: "S", company: "Acme" }, score: 0.8, contactId: "c" }),
    );
    const req = new Request("https://x/stripe/webhook", {
      method: "POST",
      headers: { "stripe-signature": "sig" },
      body: "{}",
    });
    await handleStripeWebhook(req, env);
    expect(startSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run tests**

Run: `npm test -- --run`
Expected: all pass, including new audit-* tests.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts src/stripe-webhook-audit.test.ts
git commit -m "index: register /audit/complete + /audit/retrigger; wire startAudit into invoice.paid"
```

---

### Task B6: wrangler.jsonc + secret setup

**Files:**
- Modify: `/Users/craigkokesh/web-cited-api/wrangler.jsonc`

- [ ] **Step 1: Extend `vars`**

In `wrangler.jsonc`, add to the `vars` block:

```jsonc
    "AUDIT_PIPELINE_URL": "https://audit.web-cited.com",
    // Feature flag. Flip to "true" at cut-over (see spec §Migration / cut-over).
    // Until then, invoice.paid does not trigger the pipeline.
    "AUDIT_PIPELINE_ENABLED": "false",
```

- [ ] **Step 2: Extend the secrets comment block**

Update the secrets comment block near the top to list the two new secrets:

```jsonc
  // Secrets (set via `wrangler secret put <NAME>`, never committed):
  //   HUBSPOT_TOKEN, RESEND_TOKEN, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD,
  //   CAPTURE_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
  //   SCOPE_APPROVE_SECRET,
  //   AUDIT_PIPELINE_TOKEN   — bearer we send to Python's /audit/start
  //   AUDIT_COMPLETE_SECRET  — bearer Python sends to our /audit/complete
```

- [ ] **Step 3: Generate + set both secrets**

From operator laptop:

```bash
# Generate two strong tokens. Store both in ~/.config/webcited/pipeline.env
# on the laptop AND via wrangler secret put on the Worker.
openssl rand -base64 32  # → copy to AUDIT_PIPELINE_TOKEN entries
openssl rand -base64 32  # → copy to AUDIT_COMPLETE_SECRET entries

cd /Users/craigkokesh/web-cited-api
wrangler secret put AUDIT_PIPELINE_TOKEN
wrangler secret put AUDIT_COMPLETE_SECRET
```

Paste the respective values when prompted. Record the same two values in `~/.config/webcited/pipeline.env` on the laptop as `PIPELINE_BEARER_TOKEN` (= first secret) and `AUDIT_COMPLETE_SECRET` (= second secret).

- [ ] **Step 4: Commit wrangler changes (NOT secrets)**

```bash
git add wrangler.jsonc
git commit -m "wrangler: add AUDIT_PIPELINE_URL + AUDIT_PIPELINE_ENABLED vars + secret docs"
```

---

# Part C — Cut-over + end-to-end smoke

### Task C1: Deploy TS with flag off

- [ ] **Step 1: Deploy**

From `/Users/craigkokesh/web-cited-api` on the `audit-wiring` branch:

```bash
npm run check-capture-coverage
npm test -- --run
npm run deploy  # or `wrangler deploy`
```

Expected: no regressions; existing flows (intake, scope email, kickoff email, capture retry, Stripe webhooks other than audit trigger) all still green.

- [ ] **Step 2: Verify routes exist**

```bash
curl -i -X POST https://api.web-cited.com/audit/complete -H "Authorization: Bearer wrong"
# => HTTP 401

curl -i -X POST "https://api.web-cited.com/audit/retrigger?deal=none&token=wrong"
# => HTTP 401
```

- [ ] **Step 3: Verify flag is "false"**

```bash
curl -i https://api.web-cited.com/health
# => 200. Flag visibility is not exposed — confirmed by absence of trigger
# in invoice.paid tail logs (see `wrangler tail`).
```

- [ ] **Step 4: Merge `audit-wiring` → `main`**

```bash
gh pr create --title "Audit pipeline wiring (Phase 0+1)" \
  --body "$(cat <<'EOF'
## Summary
- New routes POST /audit/complete and POST /audit/retrigger
- New trigger inline in invoice.paid (behind AUDIT_PIPELINE_ENABLED feature flag — default false)
- Shared audit-completion.json contract fixture, contract test on both sides
- AST-enforced single-write-path invariant preserved (/audit/complete calls hubspotCapture internally)

## Test plan
- [x] Unit tests: audit-trigger, audit-complete, audit-retrigger, contract, stripe-webhook-audit
- [x] `npm run check-capture-coverage` clean
- [ ] Post-merge smoke: curl the two new routes at api.web-cited.com, confirm 401 on bad bearer
- [ ] Cutover (Task C3): flip AUDIT_PIPELINE_ENABLED to "true" + PIPELINE_COMMERCE_ENABLED to "false"

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Merge after CI green.

---

### Task C2: Pre-cutover handshake smoke

With the Python side already deployed (Task A11) and the dead-letter containing the `smoke-1` retry row, the scheduler will now attempt to drain against the live Worker. Wait for the next drain tick (≤5 min from deploy).

- [ ] **Step 1: Observe drain succeed**

Run on operator laptop:

```bash
sqlite3 ~/.local/share/webcited/pipeline.db "SELECT * FROM pending_completion_callbacks;"
```

Expected: empty within 10 minutes of Task C1 deploy.

- [ ] **Step 2: Observe the Worker received the completion**

In Cloudflare dashboard → Workers → web-cited-intake-api → Logs, tail for `audit-complete`. Expect one `report_delivered` capture for `dealId=smoke-1` and one delivery email send to the test address.

- [ ] **Step 3: Check HubSpot**

HubSpot → deals → search for the `smoke-1` deal. Expect a note from `hubspotCapture` with kind `report_delivered` and `audit_status: delivered` property patch.

If any of these fail, debug before proceeding to C3. Most likely cause: a mismatch between `AUDIT_COMPLETE_SECRET` on Worker and operator laptop.

---

### Task C3: Flip the feature flag + turn off Python commerce

- [ ] **Step 1: Flip the Worker flag**

```bash
cd /Users/craigkokesh/web-cited-api
# Edit wrangler.jsonc: "AUDIT_PIPELINE_ENABLED": "true"
# OR, faster, ship as a secret override without a deploy:
wrangler deploy  # after editing jsonc
```

- [ ] **Step 2: Turn off Python commerce**

On operator laptop, in `~/.config/webcited/pipeline.env`:

```bash
# Ensure this line exists:
PIPELINE_COMMERCE_ENABLED=false
```

Restart the api agent:

```bash
launchctl kickstart -k "gui/$(id -u)/com.webcited.audit-api"
```

- [ ] **Step 3: Commit flag change**

```bash
cd /Users/craigkokesh/web-cited-api
git add wrangler.jsonc
git commit -m "wrangler: flip AUDIT_PIPELINE_ENABLED to true (cut-over)"
git push
```

---

### Task C4: End-to-end real-traffic smoke

- [ ] **Step 1: Submit a test intake from the form**

Open `https://web-cited.com/start.html`, submit a Cepheid intake using your own email. Receive the scope email. Click the pay button.

- [ ] **Step 2: Pay the test Stripe invoice**

Use a Stripe test-mode Visa (4242 4242 4242 4242) if Stripe is in test mode, otherwise pay the real invoice with a small tier (Pulse / $1,500) and refund after.

- [ ] **Step 3: Observe kickoff email**

Within seconds of payment, kickoff email arrives.

- [ ] **Step 4: Observe audit run**

On operator laptop:

```bash
tail -F /usr/local/var/log/webcited/audit-api.err.log
```

Expect `_run_audit_and_post` lifecycle logs. Duration ~60–120 minutes.

- [ ] **Step 5: Observe delivery email**

Upon completion, delivery email arrives at the test address with links to `artifacts.web-cited.com/<dealId>/audit-report.pdf` and the schema-pack zip. Verify both links 200 and serve the expected content-types.

- [ ] **Step 6: Observe HubSpot**

Deal shows notes for each lifecycle event: `invoice_paid`, `kickoff_email_sent`, `audit_started` (success path has no note from startAudit — only failure writes one; successful start is visible via the subsequent `report_delivered`), `report_delivered`. `audit_status` = `delivered`.

- [ ] **Step 7: Refund (if real payment used)**

In Stripe dashboard, refund the test invoice. No change needed to the Worker; Stripe's `invoice.refunded` isn't handled (we don't subscribe).

- [ ] **Step 8: Post-cutover tag**

```bash
cd /Users/craigkokesh/web-cited-api && git tag -a audit-wiring-live -m "Phase 0+1 cutover complete" && git push --tags
cd /Users/craigkokesh/web-cited-pipeline && git tag -a audit-wiring-live -m "Phase 0+1 cutover complete" && git push --tags
```

---

# Post-implementation follow-ups

These are explicitly **out of scope** per the spec but noted so the reviewer who lands this can file them as separate issues:

- [ ] **Phase 2 decision ticket — Airtable writes in the Worker.** Currently Python still writes Airtable directly during audit via `pipeline/airtable.py`. Evaluate whether to migrate into a `/capture` `source: "pipeline"` flow.
- [ ] **Phase 2 decision ticket — `/audit/failed` endpoint.** v1 has no auto-failure webhook; pipeline errors sit at `audit_status: in_progress` until operator review.
- [ ] **Phase 2 feature — Playbook auto-build.** `AuditDeliverable.playbookUrl` is omitted in v1. Hook the Playbook generator into `run_audit()` once the Playbook content spec ships.
- [ ] **Phase 2 feature — schema-pack auto-build.** v1 uploads a placeholder zip. The real schema-pack generator hooks into `run_audit()` later.
- [ ] **Observability — completion-client dead-letter visibility.** SQLite rows are currently only visible via manual query. Surface them in the ops email alongside the HubSpot-side dead letter.
- [ ] **Cleanup ticket — delete the abandoned `pipeline/` stub in `/Users/craigkokesh/web-cited`** (unrelated to this spec, noted during codebase audit).

---

**End of plan.**

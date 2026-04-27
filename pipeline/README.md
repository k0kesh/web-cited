# Web Cited: audit pipeline (stub)

This directory is the operational backbone for delivering an SXO audit report.
Right now it's a **stub**: fixtures in place of a real crawl, deterministic
placeholder prose in place of Claude-generated narrative. The template,
rollups, and output format are production-shape.

## Layout

```
pipeline/
├── fixtures/          sample inputs for a single job (Claimzilla, WC-2026-0042)
│   ├── intake.json        form submission
│   ├── crawl.jsonl        8 crawled pages with SXO signals
│   ├── llm_tests.jsonl    20 engine runs (4 engines × 5 prompts)
│   └── findings.jsonl     10 graded findings with evidence + lift estimates
├── templates/
│   └── report.md.j2       Jinja2 report template
├── render.py          loads fixtures → computes rollups → renders md + html
├── requirements.txt
└── out/               rendered reports land here, one dir per job_id
```

## Run locally

```bash
cd pipeline
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python render.py
open out/WC-2026-0042/report.html
```

## What's stubbed

- **Fixtures, not a crawl.** `fixtures/crawl.jsonl` is handwritten to exercise
  the schemas. Production replaces this with a Scrapy output.
- **Fixtures, not real LLM calls.** `fixtures/llm_tests.jsonl` is handwritten.
  Production replaces this with `orchestrate_llm_tests.py` calling OpenAI +
  Perplexity + Gemini + Anthropic.
- **Deterministic narrative.** `stub_narratives()` in `render.py` assembles
  §1, §2, and §5 prose from the rollup numbers. Production swaps each string
  for a Claude call that sees the rollups + findings + raw crawl.

## What's production-shape

- Rollups (engine table, prompt table, brand share, severity counts,
  recommendation ranking) are computed, not fixture-supplied.
- Template is parametric on `intake`, so a different job with different
  prompts / competitors renders without changes.
- Output is `.md` + `.html`; Pandoc can add a PDF step.

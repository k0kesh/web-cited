#!/usr/bin/env python3
"""
Web Cited audit-report renderer (stub).

Reads the three fixture files, computes rollups, substitutes placeholder
narrative text (production will call Claude here), renders the Jinja2
template, and writes markdown + HTML to pipeline/out/<job_id>/.

Usage:
    python3 render.py
"""

from __future__ import annotations

import json
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined
import markdown as md_lib

ROOT = Path(__file__).parent
FIXTURES = ROOT / "fixtures"
TEMPLATES = ROOT / "templates"
OUT = ROOT / "out"


def read_json(path: Path):
    with path.open() as f:
        return json.load(f)


def read_jsonl(path: Path):
    with path.open() as f:
        return [json.loads(line) for line in f if line.strip()]


def compute_rollups(intake: dict, crawl: list[dict], llm: list[dict]) -> dict:
    target_domain = intake["target"]["domain"]

    engine_runs: Counter[str] = Counter()
    engine_target_hits: Counter[str] = Counter()
    for row in llm:
        engine_runs[row["engine"]] += 1
        if row["sources_from_target_domain"] > 0:
            engine_target_hits[row["engine"]] += 1

    engine_table = [
        {
            "engine": engine,
            "runs": engine_runs[engine],
            "target_citations": engine_target_hits[engine],
            "target_share_pct": round(100 * engine_target_hits[engine] / engine_runs[engine], 1),
        }
        for engine in sorted(engine_runs)
    ]

    prompts: dict[str, dict] = {}
    for row in llm:
        pid = row["prompt_id"]
        prompts.setdefault(pid, {"prompt": row["prompt"], "engines_citing_target": 0, "brand_ranks": []})
        if row["sources_from_target_domain"] > 0:
            prompts[pid]["engines_citing_target"] += 1
        for b in row["brands_mentioned"]:
            if b["rank"] is not None:
                prompts[pid]["brand_ranks"].append((b["brand"], b["rank"]))

    prompt_table = []
    for pid in sorted(prompts):
        ranks = prompts[pid]["brand_ranks"]
        rank1_counts = Counter(b for b, r in ranks if r == 1)
        top_brand = rank1_counts.most_common(1)[0][0] if rank1_counts else "—"
        prompt_table.append(
            {
                "prompt_id": pid,
                "prompt": prompts[pid]["prompt"],
                "engines_citing_target": prompts[pid]["engines_citing_target"],
                "top_brand": top_brand,
            }
        )

    brand_runs: Counter[str] = Counter()
    for row in llm:
        seen_in_row = {b["brand"] for b in row["brands_mentioned"] if b["rank"] is not None}
        for brand in seen_in_row:
            brand_runs[brand] += 1

    total_runs = len(llm)
    brand_table = [
        {"brand": b, "runs": c, "share_pct": round(100 * c / total_runs, 1)}
        for b, c in brand_runs.most_common()
    ]

    target_citations = sum(1 for row in llm if row["sources_from_target_domain"] > 0)
    top_competitor_brand, top_competitor_runs = next(
        ((b, c) for b, c in brand_runs.most_common() if b.lower() != intake["contact"]["company"].lower()),
        ("—", 0),
    )

    run_dates = sorted(row["run_at"] for row in llm)
    run_window = f"{run_dates[0][:10]} → {run_dates[-1][:10]}" if run_dates else "—"

    return {
        "pages_crawled": len(crawl),
        "priority_pages": sum(1 for p in crawl if p.get("priority")),
        "prompt_count": len(prompts),
        "llm_runs": total_runs,
        "target_citations": target_citations,
        "target_citation_pct": round(100 * target_citations / total_runs, 1) if total_runs else 0,
        "top_competitor": {"brand": top_competitor_brand, "runs": top_competitor_runs},
        "engine_table": engine_table,
        "prompt_table": prompt_table,
        "brand_table": brand_table,
        "run_window": run_window,
        "severity_counts": {"high": 0, "med": 0, "low": 0},  # filled in later
    }


def severity_counts(findings: list[dict]) -> dict:
    c = Counter(f["severity"] for f in findings)
    return {"high": c.get("high", 0), "med": c.get("med", 0), "low": c.get("low", 0)}


def rank_recommendations(findings: list[dict]) -> list[dict]:
    sev_order = {"high": 0, "med": 1, "low": 2}
    effort_order = {"S": 0, "M": 1, "L": 2}
    return sorted(
        findings,
        key=lambda f: (sev_order.get(f["severity"], 9), effort_order.get(f["effort"], 9)),
    )


def stub_narratives(intake: dict, rollups: dict, findings: list[dict]) -> dict:
    """Placeholder narrative generation.

    Production replaces each string with a Claude call that sees the rollups
    + findings + raw crawl data. For the stub we assemble deterministic
    summary prose from the computed numbers so the template renders cleanly
    end-to-end.
    """
    brand = intake["contact"]["company"]
    high_ct = rollups["severity_counts"]["high"]
    target_pct = rollups["target_citation_pct"]
    top_comp = rollups["top_competitor"]

    executive_summary = (
        f"{brand} is cited in {rollups['target_citations']} of {rollups['llm_runs']} AI-engine runs "
        f"({target_pct}%) across {rollups['prompt_count']} buyer-intent prompts. "
        f"{top_comp['brand']} leads the landscape at {top_comp['runs']} runs. "
        f"We found {high_ct} high-severity issues that, if shipped in the next 30 days, should "
        f"move the citation number into mid-single-digits per 20 runs. The three highest-lift "
        f"interventions are (1) answer-first extraction blocks on priority pages, "
        f"(2) Product + FAQPage + BreadcrumbList schema, and (3) a fix for homepage LCP."
    )

    citation_narrative = (
        f"Citations concentrate on a single blog post, not on product or compliance pages. "
        f"That tells us extraction-readiness — not topical authority — is the current bottleneck. "
        f"Perplexity and Claude already surface {brand}; ChatGPT and Gemini do not. Closing the gap "
        f"means giving ChatGPT's browsing tool and Gemini's grounding pipeline something "
        f"self-contained to lift from the pages that answer the buyer's actual question."
    )

    recommendations_narrative = (
        "Ranked by severity then effort. The top three are the same three called out in §1 — "
        "they account for roughly 70% of the expected 90-day lift."
    )

    return {
        "executive_summary": executive_summary,
        "citation_narrative": citation_narrative,
        "recommendations_narrative": recommendations_narrative,
    }


def main() -> int:
    intake = read_json(FIXTURES / "intake.json")
    crawl = read_jsonl(FIXTURES / "crawl.jsonl")
    llm = read_jsonl(FIXTURES / "llm_tests.jsonl")
    findings = read_jsonl(FIXTURES / "findings.jsonl")

    rollups = compute_rollups(intake, crawl, llm)
    rollups["severity_counts"] = severity_counts(findings)

    narratives = stub_narratives(intake, rollups, findings)
    recommendations_ranked = rank_recommendations(findings)

    env = Environment(
        loader=FileSystemLoader(str(TEMPLATES)),
        undefined=StrictUndefined,
        trim_blocks=False,
        lstrip_blocks=False,
    )
    template = env.get_template("report.md.j2")
    rendered_md = template.render(
        intake=intake,
        rollups=rollups,
        findings=findings,
        recommendations_ranked=recommendations_ranked,
        narratives=narratives,
        rendered_on=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    )

    job_dir = OUT / intake["job_id"]
    job_dir.mkdir(parents=True, exist_ok=True)

    md_path = job_dir / "report.md"
    md_path.write_text(rendered_md)

    html_body = md_lib.markdown(rendered_md, extensions=["tables"])
    html_doc = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<title>{intake['target']['domain']} — SXO Audit · {intake['job_id']}</title>
<style>
  body {{ font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1.25rem; color: #111; }}
  h1, h2, h3 {{ line-height: 1.2; }}
  h1 {{ font-size: 2rem; border-bottom: 2px solid #000; padding-bottom: .4rem; }}
  h2 {{ font-size: 1.35rem; margin-top: 2.4rem; border-bottom: 1.5px solid #000; padding-bottom: .3rem; }}
  h3 {{ font-size: 1.05rem; margin-top: 1.8rem; }}
  table {{ border-collapse: collapse; width: 100%; margin: 1rem 0; }}
  th, td {{ border: 1px solid #000; padding: .4rem .6rem; text-align: left; font-size: .92rem; }}
  th {{ background: #f4f3ef; }}
  code {{ background: #f4f3ef; padding: 0 .25rem; font-size: .88em; }}
  hr {{ border: none; border-top: 1.5px solid #000; margin: 2rem 0; }}
</style>
</head><body>
{html_body}
</body></html>
"""
    html_path = job_dir / "report.html"
    html_path.write_text(html_doc)

    print(f"Wrote {md_path.relative_to(ROOT.parent)} ({len(rendered_md)} chars)")
    print(f"Wrote {html_path.relative_to(ROOT.parent)} ({len(html_doc)} chars)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

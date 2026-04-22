# Audit Deliverable — Design Spec

**Date:** 2026-04-21
**Author:** Craig Kokesh (via brainstorming with Claude)
**Status:** Design approved; implementation plan pending
**Related mockups:** `.superpowers/brainstorm/65252-1776827790/content/`
- `brutalist-pdf-exec.html` — PDF §1 executive summary cover
- `brutalist-sample-check.html` — per-check unit in The Playbook (reusable across all ~40 checks)
- `brutalist-real-emails.html` — three-email lifecycle (scope + kickoff + delivery) with real production copy
- `brutalist-schema-pack.html` — The Playbook's Schema Pack landing page

---

## Purpose

Define the design and content architecture of Web Cited's paid audit **deliverable** — the package the client receives after the kickoff-email-starts-the-clock moment. This is what the rest of the funnel has been selling. It must feel premium, be immediately readable by two very different audiences, sit visually alongside `web-cited.com` as one system, and push every technical detail into a living, acting-able form.

**Scope of this spec:** all three customer-facing artifacts that ship with a completed audit engagement — the PDF report, The Playbook (web surface), and the delivery email that hands them off. Plus cross-artifact naming and the three-email lifecycle anatomy (scope → kickoff → delivery) that wraps the deliverable.

## Audiences

The deliverable serves two distinct readers, and the format split below serves both without compromising either:

- **The executive / decision-maker.** Wants the shape of the problem in one sitting. Reads at the level of "are we winning or losing, why, and what do I fund?" Tolerates zero technical jargon.
- **The practitioner** (in-house SEO lead, front-end developer, or agency contractor). Wants to actually fix things. Needs exact file paths, commands, free-tool links, per-check severity, and an export into their ticketing system.

Trying to serve both audiences in one document produces the consultant-deck problem: too technical for the CEO, too glossy for the engineer. The format split resolves this.

## Format decision — three artifacts, one system

1. **PDF — Audit Report.** Email attachment. ~24 pages for Audit tier (3–5 for Pulse, ~50 for Enterprise). Self-contained. Reads as a Swiss/Brutalist dossier: Helvetica 900 UPPERCASE display, hard rules, one red accent, narrative-first. Contains no code blocks, no long file paths, no step-by-step instructions. Any action lives in The Playbook.

2. **The Playbook — web deliverable.** (Proper noun. Was "HTML companion" in earlier drafts.) Hosted at `playbook.web-cited.com/<engagement-token>` (subdomain vs path TBD at implementation). No length limit. Contains everything the practitioner needs to execute: all 40+ technical checks with click-to-copy remediation, the Schema Pack for their priority pages, citation raw data, competitor deep-dive, remediation guides. Interactive where interactivity adds value.

3. **Delivery email.** Triggered when the pipeline finishes rendering the PDF + Playbook. Announces the deliverable, shows the headline finding, points at both artifacts. Part of a three-email lifecycle — see §Three-email lifecycle below.

The PDF is designed to survive forwarding — the executive prints it, screenshots it for their board deck, or emails it to their CFO. The Playbook is designed to be shared laterally with the team that will do the work. The PDF links into The Playbook via the handoff section on every relevant page.

**Pulse tier exception:** Pulse clients receive the PDF + a standalone `.zip` of `.jsonld` schema files, no Playbook. See §Schema Pack delivery mechanics.

## The Playbook — naming

The HTML web deliverable is named **The Playbook** — capitalized, consistently, as a proper noun. This is a product-naming decision, not just an email label. It propagates to:

- **Site copy** (`web-cited.com` deliverables section, pricing-tier descriptions)
- **Scope email** (`scope-email.ts` TIER_META deliverable lists — rename any existing "companion" references to "The Playbook")
- **Kickoff email** (no current reference; fine as-is)
- **Delivery email** (`delivery-email.ts`, new — uses "The Playbook" consistently)
- **PDF** (executive summary page points at "your Playbook at `playbook.web-cited.com/<token>`"; per-check sections reference "click-to-copy commands in The Playbook")
- **The Playbook itself** — masthead lockup: `WC · Web Cited / The Playbook for <company>`
- **URL** — `playbook.web-cited.com/<engagement-token>` preferred (subdomain parallels the future `reports.` or any other artifact-hosting subdomain); alternative `web-cited.com/playbook/<token>` acceptable. Final decision at implementation.

**Tier matrix for the Playbook:**

| Tier | Gets the Playbook? |
|---|---|
| Pulse | No — PDF + schema `.zip` only |
| Audit | Yes |
| Enterprise | Yes |

## Content architecture

### PDF (Audit Report) — §-level structure

| § | Section | Pages (Audit tier) |
|---|---|---|
| 1 | Executive summary + headline finding | 1 |
| 2 | The state of AI citation for your category | 2–3 |
| 3 | Competitive position | 2–3 |
| 4 | Findings & recommendations — narrative by theme | 5–8 |
| 5 | Priority roadmap — 30 / 60 / 90-day plan | 1 |
| 6 | Schema Pack summary | 1 |
| 7 | Implementation handoff — link to The Playbook | 1 |

§4 is organized narratively by theme, not as a check-by-check dump. Check-by-check detail is what The Playbook is for. §6 is the coverage summary only — the canonical `.zip` of `.jsonld` files is where the actual code lives.

**Pulse PDF variant:** §1 + §4 (abbreviated, top 5 findings only) + §6 (3 schema pages summarized in one page) + §7. No §2, §3, §5. Target length: 5 pages.

**Enterprise PDF variant:** all sections, expanded §3 (deeper competitor deep-dive) and §6 (schema coverage scales to 75 pages — table paginated across 2–3 pages). Target length: 50 pages.

### The Playbook — top-level nav

Seven top-level sections, surfaced as primary nav in the Playbook masthead. Order is fixed:

| Section | Content |
|---|---|
| 1. Executive Summary | Narrative summary — mirrors PDF §1, links into the rest of the Playbook. |
| 2. Scorecard | Dimensional scoring view — how you score on each of the 12 themes. Visual, scannable. |
| 3. All Checks | ~40 individual checks organized by the 12 themes from PDF §4. Each check uses the per-check template below. |
| 4. Priority 1 Fixes | Filtered view of All Checks — only severity-high items, sorted by impact/effort. |
| 5. Schema Pack | Per-page JSON-LD coverage surface. Summary + table + per-page drill-ins. See §Schema Pack surface below. |
| 6. Prompt Grid | Citation raw data — every buyer question × every engine. Who was cited, what was said, source URL. Sortable / filterable. |
| 7. Resources | Remediation guides, glossary, links to primary docs, Priority Matrix visualization. |

### §4 (PDF) and "All Checks" (Playbook) — 12 themed sub-groups

Each theme has its own accent color used *only* for the theme's eyebrow and its Priority Matrix dot color — never for backgrounds, never competing with the red primary. The 12 themes:

1. **Crawl & indexability** — robots.txt (LLM bot access: GPTBot, ClaudeBot, PerplexityBot, Google-Extended, Amazonbot, Applebot-Extended), llms.txt, sitemap.xml, accidental noindex / X-Robots-Tag, redirect chains & loops, canonicals, hreflang.
2. **Structured data** — FAQ schema, Organization + Person with sameAs (Wikidata, LinkedIn, Crunchbase), @graph with @id cross-refs, Article / BlogPosting / HowTo / Product / Service / Review, BreadcrumbList, JSON-LD validation.
3. **Content structure** — single H1, logical H2/H3/H4 hierarchy, semantic HTML5, answer-first extraction blocks, FAQ sections, internal linking, descriptive URL slugs.
4. **E-E-A-T & authority** — author bylines with Person schema, visible publish + last-updated dates, content freshness signaling, citation / footnote usage, outbound links to primary sources.
5. **Rendering & crawl visibility** — SSR / SSG / prerendering check (does `curl` return content or a React shell?).
6. **Media** — video transcripts (embedded or native, HTML-accessible), image alt text, descriptive filenames, `<figure>` / `<figcaption>`, modern formats (WebP / AVIF).
7. **Performance (Core Web Vitals)** — LCP, INP, CLS, font loading (`font-display: swap`), lazy loading, render-blocking resources, compression.
8. **Mobile & page experience** — viewport meta, no horizontal scroll, intrusive interstitials, touch target sizing.
9. **Accessibility (WCAG AA)** — color contrast, visible focus indicators, form labels, keyboard navigability.
10. **Security & trust** — HTTPS, valid SSL cert (with expiration date flagged), HSTS, privacy/terms, NAP consistency.
11. **Presentation & data formats** — HTML/CSS/JS data viz (not image-flattened), large datasets with Markdown / CSV export, real `<table>` with `<th scope>`, code blocks as `<pre><code>`.
12. **Meta & social** — meta title, meta description, OpenGraph tags, Twitter/X card tags, canonical URL, favicon set.

### Per-check template (used in both PDF §4 and Playbook "All Checks")

Every technical check follows this eight-part structure. The PDF uses a condensed print-optimized version; the Playbook uses the full interactive version with click-to-copy.

1. **Theme eyebrow + check name.** Initialism spelled out on first use with an `<abbr>` tooltip for every subsequent use.
2. **One-line description** — what's being checked.
3. **The finding.** Status (Pass / Warn / Fail) and affected URLs, in a bordered callout color-coded by severity.
4. **Plain-English explanation** — why this matters for AEO / GEO / SXO, roughly 2–4 sentences, no jargon.
5. **Self-test steps.** "Open your Terminal app (Terminal on Mac, Windows Terminal or PowerShell on Windows)" when both platforms run the same command; split to platform-specific only when commands diverge.
6. **Free tools.** 2–4 curated external tools with one-line descriptions.
7. **Severity / Effort / Impact tags.** Consistent scoring across all checks, shown as a typographic row (not colored pill badges).
8. **Link into remediation guide** (Playbook only — deep link to Resources §7).

### Priority Matrix

Lives in Playbook §7 Resources (not its own top-level nav). A 2×2 grid plotting every finding:

- **X axis:** Effort (low → high).
- **Y axis:** Impact (low → high).
- **Dot color:** Severity (red / amber / green).
- **Dot size:** High severity = larger dot.

Quadrants labeled in Helvetica 900 UPPERCASE: **QUICK WINS** (top-left) · **MAJOR INITIATIVES** (top-right) · **FILL-INS** (bottom-left) · **RECONSIDER** (bottom-right). No emoji. Each dot is clickable — clicking jumps the reader to the corresponding check in "All Checks," where a *Read the remediation guide →* link jumps them further into Resources.

The PDF includes a static render of the matrix as part of §5 Priority roadmap.

## Schema Pack delivery mechanics

The "Per-page JSON-LD schema pack" promised in `scope-email.ts` gets delivered three different ways depending on tier.

### Canonical artifact — all tiers

A `.zip` of per-page `.jsonld` files, consistently named:

- Filename: `{company-slug}-schema-pack-{YYYY-MM-DD}.zip`
- Contents: one `.jsonld` file per priority page. Filenames are URL-slug-derived (`homepage.jsonld`, `platform-claims-automation.jsonld`, `pricing.jsonld`, etc.)
- Each file is a valid JSON-LD document ready to paste into `<script type="application/ld+json">`. No wrapping, no comments, no surrounding markup — just the JSON-LD.

### Per-tier delivery

| Tier | Pages | Where JSON-LD lives | Where coverage is shown | Delivery email surfaces |
|---|---|---|---|---|
| Pulse | 3 | `.zip` only | PDF §6 summary | Deliverable 02: `Download schema pack .zip` |
| Audit | 25 | `.zip` + Playbook Schema Pack section (per-page drill-in) | PDF §6 summary + Playbook Schema Pack landing | Inside Playbook; `.zip` link on Schema Pack landing |
| Enterprise | 75 | `.zip` + Playbook Schema Pack section (paginated, filterable) | PDF §6 summary + Playbook Schema Pack landing | Inside Playbook; `.zip` link on Schema Pack landing |

**PDF never contains raw JSON-LD.** PDF §6 is a one-page (Audit) or multi-page (Enterprise) coverage summary showing the big percentage stat, the breakdown bar, and an abbreviated table of pages with their state. Full code lives only in the `.zip` and in The Playbook.

### Playbook Schema Pack surface

A dedicated top-level section (#5 in Playbook nav). Landing page anatomy:

1. **Big coverage stat** — Helvetica 900 percentage in red showing what fraction of priority pages need schema work. Framing is problem-first: *"72% of your priority pages need schema work"* (vs. *"28% have valid schema"*).
2. **Coverage breakdown bar** — single horizontal bar, segments proportional to Missing / Broken / Partial / Present counts, with a legend below that repeats the counts.
3. **Download strip** — black bar with the `.zip` filename in monospace and a primary download CTA. Visually the loudest control on the page.
4. **Filter chips** — All / Missing / Broken / Partial / Present with live counts.
5. **Table of all priority pages** — columns: index, URL (with page title), proposed schema types (monospace), current-state badge, *View & copy* action. Default sort: worst-first (Missing → Broken → Partial → Present).
6. **Operator-voice "Where to start" footer** — dynamic copy per engagement, e.g. *"Attack the 8 Missing pages first. Then the 5 Broken. Partial and Present can wait two weeks."* Counts in the copy are auto-generated from the actual findings.

**Per-page drill-in** (one row of the table → its own page):

- URL + page title + canonical
- Current state (rendered JSON-LD if present; validation errors called out if Broken)
- Proposed JSON-LD in a click-to-copy code block — same component as the per-check remediation block
- One-line rationale for each schema type chosen
- Pre-filled testing links: `https://validator.schema.org/#url=...` and Google Rich Results test
- Breadcrumb back to Schema Pack

**State semantics:**

- **Missing** — no JSON-LD on the page at all. Red.
- **Broken** — JSON-LD present but fails validation. Burgundy (darker red).
- **Partial** — JSON-LD present but missing recommended properties or types. Amber.
- **Present** — valid JSON-LD with expected types. Green.

## Three-email lifecycle

One deliverable is wrapped by three transactional emails across the engagement. All three share the same visual anatomy so they read as one voice.

| # | Email | Trigger | Source | Sender |
|---|---|---|---|---|
| 1 | Scope confirmation | Intake form submission | `scope-email.ts` (exists) | `intake@send.web-cited.com` |
| 2 | Kickoff | Stripe `invoice.paid` webhook | `kickoff-email.ts` (exists) | `intake@send.web-cited.com` |
| 3 | Delivery | Pipeline finish (PDF + Playbook rendered) | `delivery-email.ts` (**new — this spec**) | `delivery@send.web-cited.com` (**new sub-address**) |

All three reply-to: `hello@web-cited.com`.

**Sender rationale:** kickoff stays on `intake@` because it's transactional confirmation of the intake→payment commitment. Delivery moves to a new `delivery@` sub-address so the lifecycle event is visibly distinct and deliverability can be monitored separately. The `delivery@` mailbox uses the same DKIM/SPF setup as `intake@` on `send.web-cited.com`.

### Delivery email — spec

**Subject:** `Your ${tierLabel} for ${company} is ready`

(matches the pattern from scope's `ready to confirm` and kickoff's `starts now`)

**From:** `Web Cited <delivery@send.web-cited.com>`
**Reply-to:** `hello@web-cited.com`

**Anatomy:**

1. Masthead — `WC` ink-square mark + `Web Cited` wordmark (same as scope + kickoff)
2. Eyebrow: `Audit Delivered / ${company}` with red `/` separator
3. H1: `Hi ${first_name} — your ${company} audit is ready.` (sentence-case, Helvetica 800)
4. Lede: one-sentence confirmation
5. **Big stat block** — two-column Brutalist treatment of the headline finding (customer citation share % vs category leader %), bounded top + bottom by 3px thick rules. Numbers in 56px Helvetica 900, customer number in red, leader number in black. Same visual language as the PDF §1 cover. Caption line: `${prompt_count} prompts · ${engine_count} engines · ${competitor_count} competitors benchmarked` — all counts pulled from the rendered report JSON, not hard-coded (engine list is configurable via the audit pipeline).
6. Stat closer: `The gap is closable. Your Playbook is below.` (doubles as hand-off to deliverable #2)
7. **Deliverables list** — numbered `01 / 02`, red leading-zero numerals, hairline-ruled rows:
    - **Audit Report** — PDF, ~24 pages. Primary CTA (solid ink `.btn`): *Download the PDF*
    - **The Playbook** — live, shareable, linkable. Includes your Schema Pack. Secondary CTA (inverted `.btn`): *Open the Playbook*
8. **What happens next** — four-step red-numbered list, same Brutalist treatment as kickoff's "What happens next" (creates visual bookending between day 0 and day 10):
    1. Read the Executive Summary first — 5 minutes.
    2. Start on the Priority 1 fixes this week.
    3. Work the rest of the backlog at your pace. You have 30 days of async follow-up on anything in the Playbook.
    4. Reply to this email with questions, blockers, or wins.
9. Contact line: reply-to prompt
10. Footer — Web Cited wordmark + three-virtues tagline + turnaround-delivered one-liner (`Delivered in N business days · 10-day turnaround guarantee met`)

**Data sources:** headline stat numbers, competitor names, page counts, and turnaround-delivered counter are all pulled from the rendered report JSON, not invented. The delivery email is data-driven from pipeline output.

**Edge cases:**

- **Customer leads category** (customer % > leader %): labels flip, red moves to the competitor's losing number, closer becomes `Defend the lead. Your Playbook is below.`
- **No competitor benchmark** (intake had zero competitors): right column shows industry median instead, or collapses to single-stat mode.
- **Turnaround missed** (>10 business days): footer one-liner flips to apology — `Delivered in 12 business days — 2 days past guarantee. $500 credited.` Same slot, same visibility.
- **Pulse tier:** stat block unchanged. Deliverables list is 2 items: (01) Audit Report PDF, (02) Schema Pack `.zip` with primary download CTA. No Playbook. Stat closer: `The gap is closable. The plan is inside the PDF.` Footer turnaround: `Delivered in N business days · 5-day guarantee met`.
- **Enterprise tier:** same as Audit, deliverables list stays 2 items (PDF + Playbook). Schema Pack inside the Playbook scales to 75 pages.

**Production constraints** (same as scope + kickoff):

- No remote images or fonts. All styling via inline CSS. No `<style>` block — some corporate filters strip `<style>`.
- Table-safe markup for Gmail/Outlook rendering.

## Design system — Swiss/Brutalist

The deliverable adopts `web-cited.com`'s existing Swiss/Brutalist design system. Tokens are pulled directly from the site's `css/styles.css` so propagation is mechanical.

### Typography

- **Display** (H1, big stats, masthead wordmark, section headlines): `"Helvetica Neue", "Arial Black", sans-serif`. Font-weight 900. Letter-spacing `-0.02em` to `-0.04em` on the largest sizes. Mixed UPPERCASE / sentence-case depending on surface:
    - UPPERCASE: PDF headlines, Playbook section headlines, Priority Matrix quadrant labels, masthead wordmark, `.btn` labels.
    - Sentence-case: email H1s (feels personal: *"Hi Jane"* doesn't work in all-caps), per-check names, deliverable item titles.
- **Body & UI:** `-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif`. Font-weight 400/500 for body, 700/800 for emphasis.
- **Monospace** (code, URLs, paths, schema-pack filenames): `ui-monospace, "SF Mono", Menlo, Consolas, monospace`.
- **Eyebrows** (small-caps labels above headings): sans-serif, 10px, font-weight 700, text-transform uppercase, letter-spacing `0.22em`, color `#3d3d3d` (slate-700). Red `/` separator `#CC0000` when the eyebrow has two parts (e.g. `Audit Delivered / Claimzilla`).

### Color palette (tokens from `styles.css`)

| Token | Hex | Usage |
|---|---|---|
| `--ink` | `#000000` | Body text, rules, H1, `.btn` background |
| `--slate-700` | `#3d3d3d` | Eyebrows, secondary ink, muted metadata |
| `--paper` | `#f4f3ef` | Primary background — every surface |
| `--paper-white` | `#ffffff` | `.btn` foreground only |
| `--paper-alt` | `#ededea` | Playbook nav bar, filter chip hover, table row hover, subtle pull-outs |
| `--accent` | `#CC0000` | Signal red — eyebrow separators, personalized values in code blocks, `Missing` state, primary headline numbers, `.btn` hover |
| `--accent-ink` | `#8b0000` (aka `#7a1515` in mockups — align at implementation) | `Broken` state |
| `--rule` | `1.5px solid #000` | Section dividers, table borders, eyebrow top rules |
| `--rule-thick` | `3px solid #000` | Top + bottom bounds of big stat blocks |
| `--hairline` | `1px solid #dcdcda` | Table row separators, numbered-list row rules inside a stat-bounded block |

**Severity palette** (shared across Pass/Warn/Fail, schema states, Priority Matrix dots):

- **High severity / Missing / Fail:** `#CC0000` (red)
- **Medium severity / Broken:** `#7a1515` (burgundy — darker red, signals "present but wrong")
- **Low severity / Partial / Warn:** `#c07d00` (amber)
- **No issue / Present / Pass:** `#1a5a2e` (forest green)

No other colors compete. No gradients. No soft pastels. No warm off-white.

### Layout conventions

- **Hard rules, square corners.** 1.5px black for section dividers, 3px black for bounding big stat blocks, 1px `#dcdcda` hairlines for sub-lists inside stat blocks. Zero border-radius anywhere. No rounded corners on buttons, cards, or callouts.
- **Paper-on-paper, not card-on-paper.** The old editorial design nested white rounded cards inside a paper background. The Swiss/Brutalist treatment is paper with a 1.5px black outer border — flatter, more editorial, less "Stripe-invoice cosplay."
- **Generous leading.** Body text 1.5–1.6 line-height.
- **Constrained measure.** Plain-English paragraphs capped at ~640px for readability.
- **Three-column finding rows** (PDF): number · body · severity. Deliberately echoes the site's homepage findings list.
- **Big stat blocks** are the signature move. 3px thick rules top + bottom, 56–92px Helvetica 900 numbers, red for the losing/critical value, black for the winning/neutral value. Appear on: PDF §1 cover, delivery email, Playbook Schema Pack landing, any per-section KPI readouts.

### Cross-surface reusable components

These are the components that recur across all surfaces (PDF + Playbook + delivery email). Each appears in at least two mockups.

| Component | Where it appears | Shape |
|---|---|---|
| **Masthead lockup** | Every Playbook page, every email | `WC` ink-square mark (30–32px) + `Web Cited` wordmark (Helvetica 900, -0.02em, UPPERCASE). Playbook adds sub-line: `The Playbook for ${company}`. |
| **Eyebrow with red `/` separator** | Emails, Playbook pages, PDF section heads | 10px, 0.22em tracking, slate-700. Red `/` separates the two parts (`Audit Delivered / Claimzilla`). One red motif that recurs across surfaces. |
| **Big stat block** | PDF §1, delivery email, Schema Pack landing | 3px rules top + bottom, Helvetica 900 numbers 56–92px, red for one value, black for the other, 0.22em-tracked labels below. |
| **State badges** | Per-check finding, Schema Pack table rows | Square-cornered, 1.5px bordered, 9px font, 0.18em tracking, UPPERCASE, 4-color severity palette. |
| **Numbered list (red leading zeros)** | Kickoff email's "What happens next", delivery email's "What happens next", Schema Pack landing page table index column, PDF §4 finding list | `01 / 02 / 03` in Helvetica 900 red, hairline-ruled rows. |
| **Click-to-copy code block** | Per-check remediation (all 40+ checks), Schema Pack per-page drill-ins | Dark code background `#1a1612`, mono foreground, personalized values in red `#CC0000`. Entire block clickable; hover reveals *Copy* indicator; click flashes *Copied ✓* in forest green for 1.5s. Uses `navigator.clipboard.writeText()` with `document.execCommand('copy')` fallback. |
| **`.btn` CTA** | All emails, Playbook CTAs | Solid ink background, paper-white foreground, 2px black border, square corners, Helvetica 800 UPPERCASE 13px label with 0.06em tracking. Hover: red background, black foreground. Inverted variant (secondary): paper background + black foreground, hovers to solid. |
| **Footer lockup** | All emails, Playbook pages, PDF | `Web Cited · Search Experience Optimization` wordmark + three-virtues tagline (`Fixed scope · Fixed price · No sales calls`). Delivery email adds turnaround-delivered one-liner. |

### Dated header & footer (both artifacts, every page)

- **Header left:** client name · client domain · tier · delivery date (e.g. *Acme Corp · acme.com · Audit · Delivered 2026-05-05*).
- **Header right:** engagement ID or `Audit Report` eyebrow + *Generated YYYY-MM-DD · Data collected YYYY-MM-DD → YYYY-MM-DD*.
- **Footer left:** `WEB CITED` brand wordmark (same lockup as emails).
- **Footer center:** *Data collected YYYY-MM-DD · Reported YYYY-MM-DD*.
- **Footer right:** page number (PDF) or section anchor (Playbook).

The reader can always orient themselves to which time window they're looking at. Critical for a product where the value depreciates as AI answer engines evolve.

## Personalization

All client-specific values are injected from the intake form (`start.html`) and from the post-payment fulfillment record. Required fields:

| Source field | Origin | Usage |
|---|---|---|
| `company` | Intake form | Every masthead, every header, every email subject |
| `first_name` | Intake form | Email greetings |
| `website` | Intake form | Every pre-filled `curl` command, every example URL, schema-pack filenames, header domain |
| `tier` | Intake form (`Pulse` \| `Audit` \| `Enterprise`) | Scopes which sections of PDF and Playbook are generated |
| `engagement_id` | Assigned at payment completion | Engagement-token URL (`playbook.web-cited.com/<token>`), PDF header, email subject contextualization |
| `competitors[]` | Intake form | Big stat block's right column; competitor deep-dive in Playbook |
| `buyer_questions[]` | Intake form | Prompt grid; scope email's listed questions |
| `local_presence` | Intake form | GBP-related checks included or skipped |

Additional intake fields (`geo_focus`, `cms`, `sitemap`, `audit_type`, `referrer`) feed the audit run itself — they shape which queries are tested, which competitors are benchmarked, and which crawl profile is used — but are not directly rendered in the deliverable chrome.

Every code block in the Playbook (curl self-tests, schema pack JSON-LD, Lighthouse CLI commands, regex patterns, etc.) is pre-filled with the client's actual values. The personalized value is red-tinted (`#CC0000`) against the dark code block so the reader can see at a glance "this is the piece that was customized for me."

## Print dimensions

PDF is typeset to **US Letter** (8.5 × 11″, 816 × 1056px at 96dpi), 64px outer margins. A4 support is not in scope for this pass — revisit if we onboard a meaningful number of international clients.

## Cross-property consistency

The deliverable sits inside a design system that already spans three other properties. The spec commits to aligning all of them around the same Swiss/Brutalist tokens:

| Property | Current state | Post-spec state |
|---|---|---|
| `web-cited.com` (site) | Swiss/Brutalist (source of truth) | Unchanged — this is what the rest aligns to |
| Scope email (`scope-email.ts`) | Editorial: Georgia serif eyebrow, 22px sentence-case H1, rounded grey CTA, cream price card | Swiss/Brutalist: Helvetica eyebrow with red `/`, hard 1.5px rules, square `.btn`, 42px Helvetica 900 price — copy unchanged |
| Kickoff email (`kickoff-email.ts`) | Same editorial treatment as scope | Swiss/Brutalist: same as scope, plus red-numbered `01–04` "What happens next" list |
| Delivery email (**new** `delivery-email.ts`) | Does not exist | Swiss/Brutalist per §Three-email lifecycle |
| PDF Audit Report | Does not exist as rendered artifact | Swiss/Brutalist per §Content architecture and §Design system |
| The Playbook | Does not exist (`report.html` in pipeline is unstyled) | Swiss/Brutalist per §Content architecture |

**No copy changes** to the existing scope and kickoff emails — the visual treatment updates, body text is preserved verbatim.

## Out of scope for this spec

- The **generation pipeline** that turns a completed audit run into the rendered PDF + Playbook. That's the next plan, produced by `writing-plans`.
- The **data model** for findings, engagements, scoring rubric, and schema-state detection. Also in the implementation plan.
- The **signed URL / token rotation** scheme for `playbook.web-cited.com/<token>`.
- The **CSV / Jira / Linear export** format for the Fix Backlog section of the Playbook.
- The **site copy propagation** of "The Playbook" naming (pricing page, deliverables section) — captured here as a naming decision but executed in a separate site-copy pass.
- **Accessibility testing of the Playbook itself** (WCAG AA for a document about WCAG AA — table stakes, but not part of this design spec).

## Open questions

Deferred to implementation:

- **Rendering stack:** server-side PDF generation (Puppeteer, Playwright, WeasyPrint) vs. client-side (Paged.js, HTML-to-PDF). Leaning server-side for reliability; decide in the implementation plan.
- **Playbook hosting:** static per-engagement build at `playbook.web-cited.com/<token>/index.html`, or dynamic Worker that reads audit data and renders on request. Leaning static + signed CDN URL.
- **Playbook URL structure:** subdomain (`playbook.web-cited.com/<token>`) vs. path (`web-cited.com/playbook/<token>`). Leaning subdomain.
- **Versioning the Playbook:** if the audit is re-run in six months, does the old URL 410, redirect to the new run, or coexist under a version suffix?
- **Alignment of `--accent-ink` token:** `styles.css` defines it as `#8b0000`; mockups use `#7a1515` for the *Broken* state. Pick one at implementation.
- **Big stat block behavior when `competitors[] === 0`:** single-stat mode vs. industry-median fallback. Pick one at implementation.

## Next step

Run the `writing-plans` skill to produce an implementation plan covering:

1. `delivery-email.ts` — new template, fires from pipeline-finish signal
2. PDF generation pipeline — renders `.pdf` from audit JSON using the design system above
3. Playbook generation pipeline — renders per-engagement static site under `playbook.web-cited.com/<token>`
4. Schema Pack `.zip` generation — per-tier file counts
5. Scope email + kickoff email visual refresh — Swiss/Brutalist treatment, copy unchanged, inline-CSS constraint preserved
6. `TIER_META` copy updates in `scope-email.ts` — rename any "companion" references to "The Playbook"
7. Site-copy propagation plan for "The Playbook" naming (separate sub-task; may split into its own plan)

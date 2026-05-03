# Outbound SXO Audit batch 1, email 1 (cold first-touch)

**Campaign id:** `outbound_sxo_audit_2026_05`
**Sequence:** 1 of 3 (first-touch)
**Send timing:** immediate (Day 0)
**Render target:** plain-text body for operator hand-send via Gmail; HTML version optional in v1.1.
**Audience:** B2B SaaS post-Series-A through Series-C, ARR (Annual Recurring Revenue) $5 to $50M, head-of-marketing or CMO (Chief Marketing Officer) buyer.

## Placeholders

| Token | Source |
|---|---|
| `{FIRST_NAME}` | Recipient first name. |
| `{COMPANY_NAME}` | Recipient company (canonical, e.g. "Linear" not "linear.app"). |
| `{HOOK_LINE}` | One-sentence personalized opener, hand-written per recipient. References a recent ship, post, news item, or distinctive product detail. Operator-authored. |
| `{MAILING_ADDRESS}` | Aliso, LLC physical mailing address for CAN-SPAM compliance. Filled in by Section F before send. |

## Subject (operator picks one before send)

A. `Are we visible in AI search?` (Anna-York-honesty framing)
B. `How {COMPANY_NAME} shows up in ChatGPT answers` (concrete + personalized)
C. `AI search measurement, no overpromise` (honest framing)
D. `{COMPANY_NAME} in AI search: $5,000, five business days` (price + specificity)

Recommendation: A for the first send-batch (5 to 10 warm contacts), B for the cold-list batches starting week 2. The Anna-York hook works for warm contacts who already know the framing; the {COMPANY_NAME} personalization breaks through cold inboxes better.

## Body (plain-text)

```
Hi {FIRST_NAME},

{HOOK_LINE}

Most teams trying to answer "are we visible in AI search?" right now are guessing. Web Cited SXO Audit measures where {COMPANY_NAME} stands today across the four major LLM (Large Language Model) engines plus Bing organic and Google AI Overview, on 25 buyer prompts of your choice, with N=3 multi-trial sampling so you get 95% CI (Confidence Interval) ranges instead of point estimates that flip on the next run.

Five business days, $5,000 fixed, no sales calls. We don't claim to have the algorithm figured out. Nobody does, not yet. What you get is the cleanest measurement of where you actually stand, plus a click-to-copy Playbook your engineers ship from in their next sprint.

Sample Playbook (the actual deliverable, not a slide deck):
https://web-cited.com/docs/sample/playbook-claimzilla.html

Order link, if it's relevant:
https://web-cited.com/start?utm_source=outbound&utm_medium=email&utm_campaign=outbound_sxo_audit_2026_05&utm_content=email-1

Worth a look?

Craig Kokesh
Aliso, LLC dba Web Cited
hello@web-cited.com

{MAILING_ADDRESS}

If this is not relevant, reply STOP and I will remove {COMPANY_NAME} from any future outreach.
```

## Notes

- Word count, body only: ~160 words. Cold-email sweet spot is 100-150; we're slightly over because the Anna-York-honesty framing requires a couple of clauses to land. Tighten on next iteration if open + reply rates suggest length is the issue.
- No em or en dashes (H1).
- Initialisms expanded on first use (H4): LLM (Large Language Model), CI (Confidence Interval), ARR (Annual Recurring Revenue), CAN-SPAM. Universal abbreviations skipped: AI, URL.
- The deliverable framing aligns with the SXO Audit + Enterprise tier scope per `feedback_pulse_marketing_no_playbook.md`. Pulse is NOT pitched in this campaign per the customer-acquisition v1 lock.
- The unsubscribe line ("reply STOP") is a placeholder; Section F decides between mailto + Resend reply-handling vs hosted-page unsubscribe before send.

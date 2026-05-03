# Outbound SXO Audit batch 1, email 2 (4-day follow-up)

**Campaign id:** `outbound_sxo_audit_2026_05`
**Sequence:** 2 of 3 (4 business days after email 1, soft re-prompt)
**Send timing:** Day 4 (operator hand-sends as Reply on the email-1 thread).
**Audience:** Same as email-1; only sent to recipients who did NOT reply to email-1.

## Placeholders

| Token | Source |
|---|---|
| `{FIRST_NAME}` | Recipient first name. |
| `{COMPANY_NAME}` | Recipient company. |

## Subject

```
Re: {subject of email-1, verbatim}
```

(Operator hits Reply in Gmail on the email-1 thread; Gmail prepends "Re:" automatically. Keeping the thread together compounds reply rate vs starting a new thread.)

## Body (plain-text)

```
Hi {FIRST_NAME},

Following up on the AI-search audit note from earlier this week. If the timing is wrong, no problem.

One stat from the Claimzilla sample (a fictional B2B brand we built the Playbook for): 40% citation share on the buyer prompts that drive their funnel, 67% for the nearest competitor. The audit tells you which one is you, on the prompts that matter to {COMPANY_NAME}.

Sample (same link as before): https://web-cited.com/docs/sample/playbook-claimzilla.html

Order: https://web-cited.com/start?utm_source=outbound&utm_medium=email&utm_campaign=outbound_sxo_audit_2026_05&utm_content=email-2

Craig
Aliso, LLC dba Web Cited
2108 N Street, Suite N, Sacramento, CA 95816

Reply STOP to opt out.
```

## Notes

- Word count, body only: ~85 words. Tight follow-up.
- Anna-York-honesty stays implicit: not promising the algorithm, just promising the measurement.
- The 40% / 67% Claimzilla stat is a real number from the H7-locked sample Playbook; verify it still matches before send.
- Ends with a soft fork: "if timing is wrong, no problem". Reduces hostile-perception of follow-up cadence.

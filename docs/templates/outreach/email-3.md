# Outbound SXO Audit batch 1, email 3 (final touch)

**Campaign id:** `outbound_sxo_audit_2026_05`
**Sequence:** 3 of 3 (7 business days after email 2, last touch)
**Send timing:** Day 11 (operator hand-sends as Reply on the email-1 / email-2 thread). After this, NO further outbound to this contact.
**Audience:** Same as email-1; only sent to recipients who did NOT reply to email-1 or email-2.

## Placeholders

| Token | Source |
|---|---|
| `{FIRST_NAME}` | Recipient first name. |
| `{COMPANY_NAME}` | Recipient company (used in the goodbye line; optional but improves warmth). |
| `{UNSUBSCRIBE_URL}` | Per-recipient HMAC-signed unsubscribe link, same value as in email-1 and email-2. |

## Subject (operator picks one)

A. `Re: {subject of email-1, verbatim}` (keeps thread continuity; mail client auto-prepends Re:)
B. `Re: {subject of email-1}, last note` (signals finality without breaking thread)
C. `Last note on AI-search measurement` (fresh subject; risk of triggering the recipient's "wait, who?" reflex)

Recommendation: A. Three messages on the same thread reads as a complete sequence; a fresh subject on the last touch can re-trigger spam filters that flag rapid-cadence cold outreach.

## Body (plain-text)

```
Hi {FIRST_NAME},

Last note from me on this. After this I will stop and assume the timing is not right.

If you would like the measurement, the order link is below. Five business days, $5,000 fixed, no sales call. Sample Playbook in the same place: https://web-cited.com/docs/sample/playbook-claimzilla.html

Order: https://web-cited.com/start?utm_source=outbound&utm_medium=email&utm_campaign=outbound_sxo_audit_2026_05&utm_content=email-3

Either way, good luck with the rest of the quarter.

Craig
Aliso, LLC dba Web Cited
2108 N Street, Suite N, Sacramento, CA 95816

Unsubscribe: {UNSUBSCRIBE_URL}
```

## Notes

- Word count, body only: ~75 words. Tight close.
- "I will stop" (not contracted) is intentional: more formal in writing than the contracted "I'll stop", reads as a deliberate sign-off.
- "Either way, good luck with the rest of the quarter" is the warm goodbye that softens the close. Calibrates to B2B SaaS quarterly cadence (the ICP, Ideal Customer Profile).
- After this email, the recipient is moved to the do-not-contact-via-this-campaign list in HubSpot (operator updates `outbound_campaign_id` to flag the close).
- Unsubscribe path: same hosted-page click as email-1 and email-2; see the email-1 Notes section for full architecture detail.

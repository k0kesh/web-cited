# Cloudflare Turnstile setup, operator-action required

**Status as of 2026-05-15:** Turnstile is referenced in `start.html` at line 250 with a placeholder sitekey `YOUR_TURNSTILE_SITEKEY`. The marketing form currently relies on the honeypot (`_gotcha`) + time-on-page (`ts_loaded`) bot defense for active protection. Turnstile is a nice-to-have second layer that has never been enabled.

**Why this is operator-only:** the wrangler OAuth token does not include the `turnstile:write` scope, so the agent cannot create a Turnstile widget via API. Cloudflare requires either:
- A scoped API token with Turnstile write permissions, OR
- Dashboard-driven widget creation.

The dashboard path takes about 2 minutes. The API-token path requires creating a new token at https://dash.cloudflare.com/profile/api-tokens with the `Turnstile:Edit` permission. Either is fine.

## Dashboard path (recommended)

1. Open https://dash.cloudflare.com → select "Craig@web-cited.com's Account" (account ID `0fb62bfa0c482f168d44d5d9fed66ab8`).
2. Left sidebar → "Turnstile".
3. "Add site" button:
   - **Site name:** `web-cited.com - intake form`
   - **Domains:** `web-cited.com`, `www.web-cited.com`. If localhost dev is desired, also add `localhost`.
   - **Widget mode:** Managed (recommended; lets Cloudflare auto-decide between invisible / managed / non-interactive based on threat signal).
   - **Pre-clearance:** off.
4. Save. Cloudflare returns:
   - **Site key** (starts with `0x4`): public, ships in HTML.
   - **Secret key**: secret, never in HTML; goes to the Worker.

## Wire-up after widget exists

### 1. Marketing site

Edit `web-cited/start.html` (and any other form that needs Turnstile), replace the placeholder:

```diff
- <div class="cf-turnstile" data-sitekey="YOUR_TURNSTILE_SITEKEY" data-size="flexible"></div>
+ <div class="cf-turnstile" data-sitekey="0x4AAA...your-sitekey-here..." data-size="flexible"></div>
```

Bump the cache-bust on any JS file that reads the Turnstile response (the file that pulls `cf-turnstile-response` out of the form) and redeploy via `git push`.

### 2. Worker

```
cd web-cited-api
echo "0x4AAA...your-secret-here..." | npx wrangler secret put TURNSTILE_SECRET_KEY
```

Then add server-side verification at the top of `handleIntake` in `src/index.ts`:

```ts
// Optional: verify Turnstile if a token is present. Falls back gracefully
// for any form that doesn't include Turnstile yet.
if (env.TURNSTILE_SECRET_KEY && body.cf_turnstile_response) {
  const tsResp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: env.TURNSTILE_SECRET_KEY,
      response: body.cf_turnstile_response,
      remoteip: req.headers.get("CF-Connecting-IP") ?? "",
    }),
  });
  const tsData = await tsResp.json() as { success?: boolean };
  if (!tsData.success) {
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }
}
```

Returning `{ ok: true }` on failure (instead of 4xx) preserves the no-signal-to-attackers pattern the existing honeypot + timestamp defense uses.

### 3. Form payload

The frontend already loads `https://challenges.cloudflare.com/turnstile/v0/api.js`. Modify the form-submit JS to include the response token in the POST body:

```js
const turnstileToken = form.querySelector('[name="cf-turnstile-response"]')?.value;
body.cf_turnstile_response = turnstileToken;
```

## CSP impact

`_headers` already permits `challenges.cloudflare.com` in script-src, frame-src, and connect-src directives (added under item W on 2026-04-28). No CSP change needed.

## Current defenses without Turnstile

The honeypot `_gotcha` field + `ts_loaded` time-on-page check at `web-cited-api/src/index.ts` are operational and have prevented bot submissions to date. Turnstile would add: distributed-bot detection, residential-proxy detection, CAPTCHA fallback for high-suspicion sessions. Not urgent; nice to have.

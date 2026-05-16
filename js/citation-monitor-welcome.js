// Citation Monitor post-checkout welcome page personalization.
// Reads ?session_id=... (set by Stripe Checkout's success_url template),
// fetches the monitored domain from /api/citation-monitor/session-info,
// updates the headline + eyebrow.
//
// Failure modes are silent: the static "You're in" headline is the
// fallback so a Stripe outage doesn't break the page.

(function () {
  "use strict";

  var SESSION_INFO_URL = "https://api.web-cited.com/api/citation-monitor/session-info";

  function $(id) { return document.getElementById(id); }

  function getQueryParam(name) {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get(name);
    } catch (e) {
      return null;
    }
  }

  function escapeHtml(s) {
    var div = document.createElement("div");
    div.textContent = String(s);
    return div.innerHTML;
  }

  function applyDomain(domain) {
    if (!domain) return;
    var safe = escapeHtml(domain);
    var eyebrow = $("cm-welcome-eyebrow");
    var headline = $("cm-welcome-headline");
    var lead = $("cm-welcome-lead");
    if (eyebrow) eyebrow.innerHTML = "CITATION MONITOR &middot; " + safe + " &middot; ACTIVE";
    if (headline) headline.textContent = "You're in. We are now tracking " + domain + " for AI citations.";
    if (lead) {
      lead.innerHTML = "Thanks for subscribing. Stripe has charged your card and your subscription for <strong>" + safe +
        "</strong> is active. We've sent a welcome email to the address you used at checkout - check your inbox in the next few minutes.";
    }
  }

  function init() {
    var sessionId = (getQueryParam("session_id") || "").trim();
    if (!sessionId) {
      // No session_id (e.g. someone bookmarked /welcome). Keep the static copy.
      return;
    }
    fetch(SESSION_INFO_URL + "?session_id=" + encodeURIComponent(sessionId), {
      method: "GET",
      headers: { "Accept": "application/json" }
    })
      .then(function (resp) {
        if (!resp.ok) return null;
        return resp.json();
      })
      .then(function (data) {
        if (data && data.ok && data.domain) applyDomain(data.domain);
      })
      .catch(function (err) {
        console.warn("citation-monitor welcome personalize failed (non-fatal)", err);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

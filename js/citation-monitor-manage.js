// Citation Monitor subscription management page.
// Reads ?token=... from URL, POSTs to /api/citation-monitor/portal,
// redirects to Stripe-hosted customer portal on success.
// CSP-compliant: no inline scripts, no inline event handlers.

(function () {
  "use strict";

  var API_URL = "https://api.web-cited.com/api/citation-monitor/portal";

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  function showError(title, detail) {
    hide($("cm-manage-loading"));
    var t = $("cm-manage-error-title");
    var d = $("cm-manage-error-detail");
    if (t && title) t.textContent = title;
    if (d && detail) d.textContent = detail;
    show($("cm-manage-error"));
  }

  function getQueryParam(name) {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get(name);
    } catch (e) {
      return null;
    }
  }

  function init() {
    var token = (getQueryParam("token") || "").trim();
    if (!token) {
      showError(
        "Missing link token",
        "This subscription management link is incomplete. Open the link from your monthly Citation Monitor email."
      );
      return;
    }

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token })
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { status: resp.status, data: data };
        });
      })
      .then(function (out) {
        if (out.status >= 200 && out.status < 300 && out.data && out.data.portal_url) {
          // Redirect to Stripe-hosted portal.
          window.location.href = out.data.portal_url;
          return;
        }
        var detail = (out.data && out.data.error)
          ? out.data.error
          : "This subscription management link is not valid. It may have expired (links last 7 days).";
        var title = out.status === 401 ? "Link expired or invalid" :
                    out.status === 404 ? "No subscription found" :
                    out.status === 503 ? "Service temporarily unavailable" :
                    "Could not open portal";
        showError(title, detail);
      })
      .catch(function (err) {
        console.error("citation-monitor manage failed", err);
        showError(
          "Network error",
          "We could not reach the billing service. Check your connection and reload this page, or email hello@web-cited.com."
        );
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

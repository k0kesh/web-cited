// Citation Monitor subscription management page.
// Two flows:
//   1. With ?token=... in URL: POST to /api/citation-monitor/portal,
//      redirect to Stripe-hosted customer portal on success.
//   2. Without ?token=... (or after a 401 from flow 1): show a form that
//      lets the subscriber request a fresh manage link emailed to them.
// CSP-compliant: no inline scripts, no inline event handlers.

(function () {
  "use strict";

  var PORTAL_URL = "https://api.web-cited.com/api/citation-monitor/portal";
  var REQUEST_URL = "https://api.web-cited.com/api/citation-monitor/request-manage-link";

  function $(id) { return document.getElementById(id); }
  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  function hideAllStates() {
    hide($("cm-manage-loading"));
    hide($("cm-manage-error"));
    hide($("cm-manage-request"));
    hide($("cm-manage-sent"));
  }

  function showError(title, detail) {
    hideAllStates();
    var t = $("cm-manage-error-title");
    var d = $("cm-manage-error-detail");
    if (t && title) t.textContent = title;
    if (d && detail) d.textContent = detail;
    show($("cm-manage-error"));
  }

  function showRequestForm() {
    hideAllStates();
    show($("cm-manage-request"));
  }

  function showSent() {
    hideAllStates();
    show($("cm-manage-sent"));
  }

  function showLoading() {
    hideAllStates();
    show($("cm-manage-loading"));
  }

  function getQueryParam(name) {
    try {
      var url = new URL(window.location.href);
      return url.searchParams.get(name);
    } catch (e) {
      return null;
    }
  }

  function exchangeToken(token) {
    showLoading();
    fetch(PORTAL_URL, {
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
        console.error("citation-monitor manage token exchange failed", err);
        showError(
          "Network error",
          "We could not reach the billing service. Check your connection and reload this page, or email hello@web-cited.com."
        );
      });
  }

  function setSubmitLoading(loading) {
    var btn = $("cm-manage-request-submit");
    if (!btn) return;
    if (loading) {
      btn.setAttribute("data-loading", "true");
      btn.disabled = true;
    } else {
      btn.removeAttribute("data-loading");
      btn.disabled = false;
    }
  }

  function onRequestSubmit(e) {
    e.preventDefault();
    var emailInput = $("cm-manage-email");
    var email = (emailInput && emailInput.value || "").trim();
    if (!email) {
      emailInput && emailInput.focus();
      return;
    }
    setSubmitLoading(true);
    fetch(REQUEST_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email })
    })
      .then(function () {
        // Anti-enumeration: always show the same confirmation regardless of
        // whether the email matched. Worker returns 200 either way.
        setSubmitLoading(false);
        showSent();
      })
      .catch(function (err) {
        console.error("citation-monitor manage request failed", err);
        setSubmitLoading(false);
        // Still show "sent" - we don't want to leak whether the API is reachable
        // either, and the worst case is that the user retries and the request
        // succeeds the second time.
        showSent();
      });
  }

  function onErrorRequestFresh(e) {
    e.preventDefault();
    showRequestForm();
  }

  function init() {
    var token = (getQueryParam("token") || "").trim();
    var form = $("cm-manage-request-form");
    if (form) form.addEventListener("submit", onRequestSubmit);

    var freshLink = $("cm-manage-error-request-fresh");
    if (freshLink) freshLink.addEventListener("click", onErrorRequestFresh);

    if (token) {
      exchangeToken(token);
    } else {
      showRequestForm();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

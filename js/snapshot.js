// Snapshot tool form handler.
// Posts to /api/snapshot on api.web-cited.com, renders the result inline.
// CSP-compliant: no inline scripts, no inline event handlers.

(function () {
  "use strict";

  var API_URL = "https://api.web-cited.com/api/snapshot";

  function $(id) { return document.getElementById(id); }

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }

  function setLoading(submitBtn, loading) {
    if (!submitBtn) return;
    if (loading) {
      submitBtn.setAttribute("data-loading", "true");
      submitBtn.disabled = true;
    } else {
      submitBtn.removeAttribute("data-loading");
      submitBtn.disabled = false;
    }
  }

  function renderError(message) {
    var err = $("snapshot-error");
    if (!err) return;
    err.textContent = message;
    show(err);
  }

  function renderResult(data) {
    var verdict = $("snapshot-verdict");
    var verdictBlock = $("snapshot-result");
    var engine = $("snapshot-engine");
    var matchBasis = $("snapshot-match-basis");
    var domainDisplay = $("snapshot-domain-display");
    var preview = $("snapshot-response-preview");
    if (!verdict || !verdictBlock) return;

    if (data.cited) {
      verdict.textContent = "Cited. Your brand exists to AI for this category.";
      verdict.className = "snapshot-result__verdict snapshot-result__verdict--cited";
    } else {
      verdict.textContent = "Invisible. AI did not surface your brand for this prompt.";
      verdict.className = "snapshot-result__verdict snapshot-result__verdict--invisible";
    }
    if (engine) engine.textContent = (data.engine || "Anthropic Claude") + " (" + (data.model || "claude-haiku-4-5") + ")";
    if (matchBasis) {
      var basis = data.match_basis === "domain" ? "domain substring match"
        : data.match_basis === "brand_name" ? "brand-name substring match"
        : "neither (no citation)";
      matchBasis.textContent = basis;
    }
    if (domainDisplay) domainDisplay.textContent = data.domain || "";
    if (preview) preview.textContent = data.response_preview || "(no response preview)";
    show(verdictBlock);
    verdictBlock.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function onSubmit(e) {
    e.preventDefault();
    hide($("snapshot-error"));
    hide($("snapshot-result"));

    var form = e.target;
    var submitBtn = $("snapshot-submit");
    var domain = (form.elements.namedItem("domain") || {}).value || "";
    var email = (form.elements.namedItem("email") || {}).value || "";
    var gotcha = (form.elements.namedItem("_gotcha") || {}).value || "";
    var tsLoaded = parseInt(($("snapshot-ts-loaded") || {}).value || "0", 10);

    domain = domain.trim();
    email = email.trim();

    if (!domain || !email) {
      renderError("Please enter both your domain and your email.");
      return;
    }

    setLoading(submitBtn, true);

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        domain: domain,
        email: email,
        _gotcha: gotcha,
        ts_loaded: tsLoaded,
      }),
    })
      .then(function (resp) {
        return resp.json().then(function (body) {
          return { status: resp.status, body: body };
        });
      })
      .then(function (res) {
        setLoading(submitBtn, false);
        if (!res.body || res.body.ok === false) {
          renderError(res.body && res.body.error ? res.body.error : "Something went wrong. Please try again.");
          return;
        }
        // Bot-trap response: ok:true with no data fields. Show a friendly message.
        if (!("cited" in res.body)) {
          renderError("Please wait a moment and try again.");
          return;
        }
        renderResult(res.body);
      })
      .catch(function (err) {
        setLoading(submitBtn, false);
        renderError("Could not reach the snapshot service. Please try again.");
        console.error("Snapshot fetch failed:", err);
      });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var tsLoaded = $("snapshot-ts-loaded");
    if (tsLoaded) tsLoaded.value = String(Date.now());
    var form = $("snapshot-form");
    if (form) form.addEventListener("submit", onSubmit);
  });
})();

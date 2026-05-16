// Citation Monitor signup form handler.
// Posts to /api/citation-monitor/start on api.web-cited.com, redirects to Stripe checkout.
// CSP-compliant: no inline scripts, no inline event handlers.

(function () {
  "use strict";

  var API_URL = "https://api.web-cited.com/api/citation-monitor/start";
  var TS_INPUT_ID = "cm-ts-loaded";
  var FORM_ID = "cm-form";
  var SUBMIT_ID = "cm-submit";
  var ERROR_ID = "cm-error";

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
    var err = $(ERROR_ID);
    if (!err) return;
    err.textContent = message;
    show(err);
    err.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function parseCompetitors(raw) {
    if (!raw) return [];
    return raw
      .split(",")
      .map(function (c) { return c.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, ""); })
      .filter(function (c) { return c.length > 0; })
      .slice(0, 3);
  }

  function onSubmit(e) {
    e.preventDefault();
    hide($(ERROR_ID));

    var form = e.target;
    var submitBtn = $(SUBMIT_ID);

    var domain = ((form.elements.namedItem("domain") || {}).value || "").trim();
    var email = ((form.elements.namedItem("email") || {}).value || "").trim();
    var prompt = ((form.elements.namedItem("prompt") || {}).value || "").trim();
    var competitorsRaw = ((form.elements.namedItem("competitors") || {}).value || "").trim();
    var gotcha = ((form.elements.namedItem("_gotcha") || {}).value || "");
    var tsLoaded = parseInt(($(TS_INPUT_ID) || {}).value || "0", 10);

    if (!domain) { renderError("Please enter your domain."); return; }
    if (!email) { renderError("Please enter your email."); return; }
    if (!prompt) { renderError("Please enter a buyer prompt to track."); return; }
    if (prompt.length < 10) { renderError("Your prompt is too short. Aim for a complete buyer-research question (10 characters or more)."); return; }
    if (prompt.length > 300) { renderError("Your prompt is too long. Keep it under 300 characters."); return; }

    var competitors = parseCompetitors(competitorsRaw);

    setLoading(submitBtn, true);

    var body = {
      domain: domain,
      email: email,
      prompt: prompt,
      competitors: competitors,
      _gotcha: gotcha,
      ts_loaded: tsLoaded || Date.now()
    };

    fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
      .then(function (resp) {
        return resp.json().then(function (data) {
          return { status: resp.status, data: data };
        });
      })
      .then(function (out) {
        setLoading(submitBtn, false);
        if (out.status >= 200 && out.status < 300 && out.data && out.data.checkout_url) {
          window.location.href = out.data.checkout_url;
          return;
        }
        // 200-OK with no checkout_url means honeypot tripped silently. Show a generic confirmation.
        if (out.status >= 200 && out.status < 300) {
          renderError("Submission accepted. If you do not see Stripe checkout open, please reload the page and try again.");
          return;
        }
        var msg = (out.data && out.data.error) ? out.data.error : "We could not start your subscription. Please try again or contact hello@web-cited.com.";
        renderError(msg);
      })
      .catch(function (err) {
        setLoading(submitBtn, false);
        console.error("citation-monitor start failed", err);
        renderError("Network error. Please check your connection and try again.");
      });
  }

  function init() {
    var tsInput = $(TS_INPUT_ID);
    if (tsInput) tsInput.value = String(Date.now());

    var form = $(FORM_ID);
    if (form) form.addEventListener("submit", onSubmit);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

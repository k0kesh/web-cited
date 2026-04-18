/* Web Cited — minimal progressive enhancement
   No frameworks. Pure DOM. Works with or without JS.
*/
(function () {
  "use strict";

  // --- Mobile nav toggle ------------------------------------------------
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.getElementById("primary-nav");

  if (toggle && menu) {
    toggle.addEventListener("click", function () {
      var isOpen = menu.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      toggle.textContent = isOpen ? "Close" : "Menu";
    });

    // Close on link click (mobile only)
    menu.addEventListener("click", function (e) {
      if (e.target.tagName === "A" && window.matchMedia("(max-width: 899px)").matches) {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Menu";
      }
    });

    // Close on escape
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && menu.classList.contains("is-open")) {
        menu.classList.remove("is-open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.textContent = "Menu";
        toggle.focus();
      }
    });
  }

  // --- Mark current year in footer -------------------------------------
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // --- Cookie / privacy notice -----------------------------------------
  // Web Cited uses no cookies, no analytics, and no third-party tracking.
  // We show a one-time notice so visitors know that explicitly. The
  // "dismissed" state is stored in localStorage (first-party, never sent
  // anywhere) so the notice doesn't reappear on every page load.
  var STORAGE_KEY = "wc-notice-dismissed-v1";
  var alreadyDismissed = false;
  try { alreadyDismissed = window.localStorage.getItem(STORAGE_KEY) === "1"; } catch (e) {}

  if (!alreadyDismissed) {
    var notice = document.createElement("aside");
    notice.className = "cookie-notice";
    notice.setAttribute("role", "region");
    notice.setAttribute("aria-label", "Privacy notice");

    var inner = document.createElement("div");
    inner.className = "cookie-notice__inner";

    var msg = document.createElement("p");
    msg.innerHTML =
      "This site uses <strong>no cookies, no analytics, and no third-party tracking</strong>. " +
      'Read our <a href="privacy.html">privacy policy</a>.';

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cookie-notice__btn";
    btn.textContent = "Got it";
    btn.addEventListener("click", function () {
      try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch (e) {}
      notice.classList.remove("is-visible");
      window.setTimeout(function () { notice.remove(); }, 260);
    });

    inner.appendChild(msg);
    inner.appendChild(btn);
    notice.appendChild(inner);
    document.body.appendChild(notice);

    // Reveal on next frame so the slide-up transition runs.
    window.requestAnimationFrame(function () {
      notice.classList.add("is-visible");
    });
  }
})();

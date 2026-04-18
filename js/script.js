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
})();

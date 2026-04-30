// Extracted from services.html 2026-04-29 EOD (item W follow-up: strict CSP).
// Item W (commit ade116c, 2026-04-28) extracted intake-form + contact-form
// inline JS to start.js + contact.js but missed this gallery script. The
// strict CSP `script-src 'self' https://challenges.cloudflare.com` blocks
// inline scripts, so the gallery click handlers never registered until this
// file shipped. Behavior unchanged from the inline original. Loaded by
//   <script src="js/services-gallery.js" defer></script>
//
(function () {
  var thumbs = Array.prototype.slice.call(document.querySelectorAll('#galThumbs .gal-thumb'));
  var hero = document.getElementById('galHero');
  var title = document.getElementById('galTitle');
  var detail = document.getElementById('galDetail');
  var counter = document.getElementById('galCounter');
  var prevBtn = document.getElementById('galPrev');
  var nextBtn = document.getElementById('galNext');
  var idx = 0;

  // Arm the hero for View Transitions only after first paint,
  // so the view-transition-name doesn't invalidate the LCP
  // candidate during initial render. This keeps Chrome's LCP
  // measurement stable while preserving the flip animation
  // for thumbnail clicks (which happen post-load).
  if ('requestIdleCallback' in window) {
    requestIdleCallback(function () { hero.classList.add('vt-armed'); });
  } else {
    setTimeout(function () { hero.classList.add('vt-armed'); }, 200);
  }

  function setActive(i) {
    for (var j = 0; j < thumbs.length; j++) {
      var on = (j === i);
      thumbs[j].classList.toggle('is-active', on);
      if (on) thumbs[j].setAttribute('aria-current', 'true');
      else thumbs[j].removeAttribute('aria-current');
    }
  }

  function apply(i) {
    idx = (i + thumbs.length) % thumbs.length;
    var btn = thumbs[idx];
    hero.src = btn.getAttribute('data-hero');
    hero.alt = btn.getAttribute('data-alt');
    hero.width = +btn.getAttribute('data-w');
    hero.height = +btn.getAttribute('data-h');
    title.innerHTML = btn.getAttribute('data-title');
    detail.textContent = btn.getAttribute('data-detail');
    counter.textContent = (idx + 1) + ' / ' + thumbs.length;
    setActive(idx);
    // Scroll the strip horizontally so the active thumb is visible.
    btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  }

  // Swap the hero image with a CSS-only flip-style transition.
  // View Transitions API gets a smooth crossfade in Chrome /
  // Edge / Safari TP; everywhere else falls back to the same
  // load() path without the morphed transition.
  function flip(i) {
    if (document.startViewTransition) {
      document.startViewTransition(function () { apply(i); });
    } else {
      hero.classList.add('is-flipping');
      apply(i);
      setTimeout(function () { hero.classList.remove('is-flipping'); }, 220);
    }
  }

  for (var k = 0; k < thumbs.length; k++) {
    (function (j) {
      thumbs[j].addEventListener('click', function () { flip(j); });
    })(k);
  }
  prevBtn.addEventListener('click', function () { flip(idx - 1); });
  nextBtn.addEventListener('click', function () { flip(idx + 1); });

  // Keyboard arrows when focus is anywhere inside the gallery.
  document.getElementById('sampleGallery').addEventListener('keydown', function (e) {
    if (e.key === 'ArrowLeft') { e.preventDefault(); flip(idx - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); flip(idx + 1); }
  });

  // Touch swipe on the hero only (so vertical scroll inside the
  // thumb strip stays normal).
  var touchX = null;
  var heroBox = hero.parentNode;
  heroBox.addEventListener('touchstart', function (e) {
    touchX = e.touches[0].clientX;
  }, { passive: true });
  heroBox.addEventListener('touchend', function (e) {
    if (touchX === null) return;
    var dx = e.changedTouches[0].clientX - touchX;
    if (dx > 40) flip(idx - 1);
    else if (dx < -40) flip(idx + 1);
    touchX = null;
  }, { passive: true });
})();

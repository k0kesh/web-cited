// Extracted from start.html 2026-04-28 (item W: strict CSP).
// Behavior unchanged. Loaded by
//   <script src="js/start.js" defer></script>
//
    // Tier limits, mirror of web-cited-api/src/types.ts and
    // web-cited-pipeline/src/pipeline/tier_limits.py. Keep in sync.
    var TIER_MAX_URLS_PER_BRAND = { Pulse: 10, Audit: 25, Enterprise: 25 };
    var TIER_MAX_PROMPTS_PER_BRAND = { Pulse: 10, Audit: 25, Enterprise: 25 };
    var TIER_MAX_COMPETITORS = { Pulse: 2, Audit: 4, Enterprise: 4 };
    var TIER_MAX_BRANDS = { Pulse: 1, Audit: 1, Enterprise: 3 };

    // Pre-select tier from ?tier=pulse|audit|enterprise
    (function () {
      var params = new URLSearchParams(window.location.search);
      var tier = (params.get('tier') || '').toLowerCase();
      var map = { pulse: 'Pulse', audit: 'Audit', enterprise: 'Enterprise' };
      if (map[tier]) {
        var input = document.querySelector('input[name="tier"][value="' + map[tier] + '"]');
        if (input) input.checked = true;
      }
    }());

    // Stamp the time the form rendered. Submissions faster than ~3s are almost always bots.
    (function () {
      var ts = document.getElementById('ts_loaded');
      if (ts) ts.value = String(Date.now());
    }());

    // ----- Brand-repeater + submission handling -----
    //
    // Refactor for Phase 2: nine per-brand fields (company, website, urls,
    // business_one_liner, brand_qualifier, buyer_questions, competitors,
    // geo_focus, local_presence) live inside a brand block cloned from
    // <template id="brand-block-template">. Pulse and SXO Audit cap at 1
    // brand; Enterprise allows up to 3. Add/Remove buttons reindex blocks
    // and re-run validation. Submit serializes to payload.brands[].
    //
    // Wire format aligns with the Phase 1 v2 backend foundation merged
    // 2026-04-26 (api commit 476495f, pipeline commit 3a443e0). The api
    // validateIntake accepts both the new brands[] shape and the legacy
    // flat shape; we always emit the new shape.
    (function () {
      var form = document.getElementById('intake-form');
      var success = document.getElementById('intake-success');
      var retryPanel = document.getElementById('intake-retry');
      var retryButton = document.getElementById('intake-retry-button');
      var summary = document.getElementById('intake-error-summary');
      var summaryList = document.getElementById('intake-error-summary-list');
      var live = document.getElementById('intake-live');
      var brandsContainer = document.getElementById('brands-container');
      var addBrandBtn = document.getElementById('add-brand-btn');
      var template = document.getElementById('brand-block-template');
      if (!form || !success || !retryPanel || !retryButton || !summary || !summaryList || !live || !brandsContainer || !addBrandBtn || !template) return;

      // Engagement-level fields (those outside the brand block).
      var ENGAGEMENT_FIELD_LABELS = {
        tier: 'Audit tier',
        first_name: 'First name',
        last_name: 'Last name',
        email: 'Work email',
        audit_type: 'What are you auditing',
        acknowledgement: 'Acknowledgement'
      };

      // Per-brand fields (those inside each brand block).
      var BRAND_FIELD_LABELS = {
        company: 'Company',
        website: 'Website',
        urls: 'URLs',
        business_one_liner: 'Business one-liner',
        brand_qualifier: 'Brand qualifier',
        buyer_questions: 'Buyer questions',
        competitors: 'Competitors',
        geo_focus: 'Geographic focus',
        local_presence: 'Local presence'
      };

      // ---- helpers ----
      function brandBlocks() {
        return Array.prototype.slice.call(brandsContainer.querySelectorAll('.brand-block'));
      }
      function currentTier() {
        var checked = form.querySelector('input[name="tier"]:checked');
        return checked ? checked.value : null;
      }
      function tierDisplay(tier) {
        return tier === 'Audit' ? 'SXO Audit' : tier;
      }
      function countLines(el) {
        if (!el) return 0;
        return el.value
          .split('\n')
          .map(function (s) { return s.trim(); })
          .filter(Boolean)
          .length;
      }

      // ---- reindex brand blocks ----
      // Walks live blocks in DOM order, sets data-brand-idx on each, and
      // updates the visible "Brand N" label. Hides the Remove button on
      // Brand 1, shows on the rest.
      function reindexBrands() {
        var blocks = brandBlocks();
        blocks.forEach(function (block, i) {
          block.setAttribute('data-brand-idx', String(i));
          var label = block.querySelector('.brand-label');
          if (label) label.textContent = 'Brand ' + (i + 1);
          var remove = block.querySelector('.remove-brand');
          if (remove) remove.hidden = (i === 0);
        });
      }

      function updateAddBrandVisibility() {
        var tier = currentTier();
        var max = (tier && TIER_MAX_BRANDS[tier]) || 1;
        addBrandBtn.hidden = !(tier === 'Enterprise' && brandBlocks().length < max);
      }

      // ---- counters ----
      function attachCounters(block) {
        var counterDefs = [
          { field: 'urls', cap: TIER_MAX_URLS_PER_BRAND, label: 'URLs entered' },
          { field: 'buyer_questions', cap: TIER_MAX_PROMPTS_PER_BRAND, label: 'buyer questions entered' },
          { field: 'competitors', cap: TIER_MAX_COMPETITORS, label: 'competitors entered' }
        ];
        counterDefs.forEach(function (def) {
          var ta = block.querySelector('[data-field="' + def.field + '"]');
          var counterP = block.querySelector('.field-counter[data-counter="' + def.field + '"]');
          if (!ta || !counterP) return;
          var counterText = counterP.querySelector('[data-counter-text]');
          if (!counterText) return;
          function render() {
            var tier = currentTier();
            var capVal = tier ? def.cap[tier] : def.cap.Pulse;
            var n = countLines(ta);
            counterText.textContent = n + ' / ' + capVal;
            counterP.classList.toggle('field-counter--over', n > capVal);
          }
          ta.addEventListener('input', function () {
            render();
          });
          // Store the render function on the element so tier change can
          // re-trigger it for every counter without a full DOM re-walk.
          ta.__renderCounter = render;
          render();
        });
      }

      function recountAllCounters() {
        brandBlocks().forEach(function (block) {
          var fields = ['urls', 'buyer_questions', 'competitors'];
          fields.forEach(function (f) {
            var ta = block.querySelector('[data-field="' + f + '"]');
            if (ta && typeof ta.__renderCounter === 'function') ta.__renderCounter();
          });
        });
      }

      // ---- remove-brand ----
      function attachRemove(block) {
        var btn = block.querySelector('.remove-brand');
        if (!btn) return;
        btn.addEventListener('click', function () {
          block.remove();
          reindexBrands();
          updateAddBrandVisibility();
          recountAllCounters();
        });
      }

      // ---- add-brand ----
      function addBrandBlock() {
        var max = (currentTier() && TIER_MAX_BRANDS[currentTier()]) || 1;
        if (brandBlocks().length >= max) return;
        var nextIdx = brandBlocks().length;
        var clone = template.content.cloneNode(true);
        // Replace __IDX__ in id attributes.
        var withId = clone.querySelectorAll('[id]');
        for (var i = 0; i < withId.length; i++) {
          withId[i].id = withId[i].id.replace('__IDX__', String(nextIdx));
        }
        // Replace __IDX__ in for attributes.
        var withFor = clone.querySelectorAll('[for]');
        for (var j = 0; j < withFor.length; j++) {
          withFor[j].setAttribute('for', withFor[j].getAttribute('for').replace('__IDX__', String(nextIdx)));
        }
        brandsContainer.appendChild(clone);
        var newBlock = brandBlocks()[brandBlocks().length - 1];
        attachCounters(newBlock);
        attachRemove(newBlock);
        reindexBrands();
        updateAddBrandVisibility();
      }

      // ---- tier change handler ----
      form.querySelectorAll('input[name="tier"]').forEach(function (radio) {
        radio.addEventListener('change', function () {
          var tier = currentTier();
          var blocks = brandBlocks();
          if (tier !== 'Enterprise' && blocks.length > 1) {
            var ok = window.confirm(
              'Switching to ' + tierDisplay(tier) +
              ' will remove brands 2 and 3. Continue?'
            );
            if (!ok) {
              var enterprise = form.querySelector('input[name="tier"][value="Enterprise"]');
              if (enterprise) enterprise.checked = true;
              return;
            }
            blocks.slice(1).forEach(function (b) { b.remove(); });
            reindexBrands();
          }
          updateAddBrandVisibility();
          recountAllCounters();
        });
      });

      addBrandBtn.addEventListener('click', function () {
        addBrandBlock();
      });

      // ---- error summary plumbing ----
      // Errors come in two shapes:
      //   - engagement-level: { name: 'email', message: '...' }
      //   - per-brand:        { brandIdx: 0, field: 'website', message: '...' }
      //
      // For per-brand errors, we look up the form input by id
      // (brand-{idx}-{field}) and the offending label as
      // "Brand N {field-label}: {message}".

      function engagementInput(name) {
        if (name === 'tier' || name === 'acknowledgement') {
          return form.querySelector('[name="' + name + '"]');
        }
        return form.querySelector('#' + name);
      }
      function brandInput(brandIdx, field) {
        // Radio groups (local_presence) return the first radio in the group.
        return form.querySelector('#brand-' + brandIdx + '-' + field) ||
               form.querySelector('.brand-block[data-brand-idx="' + brandIdx + '"] [data-field="' + field + '"]');
      }
      function brandFieldErrorContainer(brandIdx, field) {
        var input = brandInput(brandIdx, field);
        if (!input) return null;
        var existing = input.parentNode.querySelector('.field-error[data-brand-idx="' + brandIdx + '"][data-field="' + field + '"]');
        if (existing) return existing;
        var errEl = document.createElement('p');
        errEl.className = 'field-error';
        errEl.setAttribute('data-brand-idx', String(brandIdx));
        errEl.setAttribute('data-field', field);
        errEl.hidden = true;
        // For radio groups (local_presence), append inside the fieldset.
        if (input.type === 'radio') {
          var fs = input.closest('fieldset');
          if (fs) fs.appendChild(errEl);
        } else {
          input.parentNode.insertBefore(errEl, input.nextSibling);
        }
        return errEl;
      }
      function engagementFieldErrorContainer(name) {
        var input = engagementInput(name);
        if (!input) return null;
        var existing = form.querySelector('.field-error[data-engagement="' + name + '"]');
        if (existing) return existing;
        var errEl = document.createElement('p');
        errEl.className = 'field-error';
        errEl.setAttribute('data-engagement', name);
        errEl.hidden = true;
        if (input.type === 'radio' || input.type === 'checkbox') {
          var fs = input.closest('fieldset') || input.closest('label');
          if (fs && fs.parentNode) fs.parentNode.insertBefore(errEl, fs.nextSibling);
        } else {
          input.parentNode.insertBefore(errEl, input.nextSibling);
        }
        return errEl;
      }

      function setEngagementError(name, msg) {
        var errEl = engagementFieldErrorContainer(name);
        if (errEl) {
          errEl.textContent = msg;
          errEl.hidden = false;
        }
        var input = engagementInput(name);
        if (input) {
          var root = input.type === 'radio' ? input.closest('fieldset') : input;
          if (root) root.classList.add('field--invalid');
          if (root && root.tagName === 'FIELDSET') {
            var radios = root.querySelectorAll('input');
            for (var i = 0; i < radios.length; i++) radios[i].setAttribute('aria-invalid', 'true');
          } else if (root) {
            root.setAttribute('aria-invalid', 'true');
          }
        }
      }
      function setBrandError(brandIdx, field, msg) {
        var errEl = brandFieldErrorContainer(brandIdx, field);
        if (errEl) {
          errEl.textContent = msg;
          errEl.hidden = false;
        }
        var input = brandInput(brandIdx, field);
        if (input) {
          var root = input.type === 'radio' ? input.closest('fieldset') : input;
          if (root) root.classList.add('field--invalid');
          if (root && root.tagName === 'FIELDSET') {
            var radios = root.querySelectorAll('input');
            for (var i = 0; i < radios.length; i++) radios[i].setAttribute('aria-invalid', 'true');
          } else if (root) {
            root.setAttribute('aria-invalid', 'true');
          }
        }
      }
      function clearAllErrors() {
        var allErr = form.querySelectorAll('.field-error');
        for (var i = 0; i < allErr.length; i++) {
          allErr[i].textContent = '';
          allErr[i].hidden = true;
        }
        var invalid = form.querySelectorAll('.field--invalid');
        for (var j = 0; j < invalid.length; j++) {
          invalid[j].classList.remove('field--invalid');
        }
        var ariaInvalid = form.querySelectorAll('[aria-invalid="true"]');
        for (var k = 0; k < ariaInvalid.length; k++) {
          ariaInvalid[k].removeAttribute('aria-invalid');
        }
        summary.hidden = true;
        summaryList.innerHTML = '';
      }

      function announce(msg) {
        live.textContent = '';
        setTimeout(function () { live.textContent = msg; }, 50);
      }

      function focusEngagement(name) {
        var input = engagementInput(name);
        if (!input) return;
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
        var scrollTarget = input.type === 'radio' ? input.closest('fieldset') : input;
        if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      function focusBrand(brandIdx, field) {
        var input = brandInput(brandIdx, field);
        if (!input) return;
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
        var scrollTarget = input.type === 'radio' ? input.closest('fieldset') : input;
        if (scrollTarget && typeof scrollTarget.scrollIntoView === 'function') {
          scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }

      function showSummary(errors) {
        summaryList.innerHTML = '';
        for (var i = 0; i < errors.length; i++) {
          var err = errors[i];
          var li = document.createElement('li');
          var a = document.createElement('a');
          var hrefId;
          if (err.brandIdx != null) {
            hrefId = 'brand-' + err.brandIdx + '-' + err.field;
          } else {
            hrefId = err.name;
          }
          a.href = '#' + hrefId;
          a.textContent = err.message;
          a.addEventListener('click', (function (e) {
            return function (ev) {
              ev.preventDefault();
              if (e.brandIdx != null) focusBrand(e.brandIdx, e.field);
              else focusEngagement(e.name);
            };
          }(err)));
          li.appendChild(a);
          summaryList.appendChild(li);
        }
        summary.hidden = false;
      }

      // ---- pre-submit validation ----
      function messageForPreSubmit(el, label) {
        var v = el.validity;
        if (!v) return 'Please fill in ' + label + '.';
        if (v.valueMissing) {
          if (el.type === 'radio') return 'Please choose an option for ' + label + '.';
          if (el.type === 'checkbox') return 'Please check ' + label + ' to continue.';
          if (el.tagName === 'SELECT') return 'Please select ' + label + '.';
          return 'Please fill in ' + label + '.';
        }
        if (v.typeMismatch) {
          if (el.type === 'email') return 'Please enter a valid work email (like jane@acme.com).';
          if (el.type === 'url') return 'Please enter a full URL starting with https:// (like https://acme.com).';
        }
        if (v.tooShort) return label + ' is too short, please expand it a bit.';
        if (v.tooLong) return label + ' is too long, please shorten it.';
        if (v.patternMismatch) return 'Please check the format of ' + label + '.';
        return 'Please review ' + label + '.';
      }

      function validateBeforeSubmit() {
        clearAllErrors();
        var errors = [];

        // Engagement-level fields.
        var engagementOrder = ['tier', 'first_name', 'last_name', 'email', 'audit_type', 'acknowledgement'];
        engagementOrder.forEach(function (name) {
          var label = ENGAGEMENT_FIELD_LABELS[name] || name;
          if (name === 'tier') {
            var tierChecked = form.querySelector('input[name="tier"]:checked');
            if (!tierChecked) {
              var msg = 'Please choose an option for ' + label + '.';
              setEngagementError(name, msg);
              errors.push({ name: name, message: msg });
            }
            return;
          }
          if (name === 'acknowledgement') {
            var ack = form.querySelector('input[name="acknowledgement"]');
            if (ack && !ack.checked) {
              var amsg = 'Please check ' + label + ' to continue.';
              setEngagementError(name, amsg);
              errors.push({ name: name, message: amsg });
            }
            return;
          }
          var el = engagementInput(name);
          if (el && !el.checkValidity()) {
            var emsg = messageForPreSubmit(el, label);
            setEngagementError(name, emsg);
            errors.push({ name: name, message: emsg });
          }
        });

        // Per-brand fields.
        var tier = currentTier();
        var blocks = brandBlocks();
        blocks.forEach(function (block, brandIdx) {
          var brandLabel = 'Brand ' + (brandIdx + 1);
          var requiredFields = ['company', 'website', 'business_one_liner', 'buyer_questions', 'geo_focus'];
          requiredFields.forEach(function (field) {
            var input = brandInput(brandIdx, field);
            if (!input) return;
            if (!input.checkValidity()) {
              var fieldLabel = BRAND_FIELD_LABELS[field] || field;
              var msg = messageForPreSubmit(input, fieldLabel);
              setBrandError(brandIdx, field, msg);
              errors.push({ brandIdx: brandIdx, field: field, message: brandLabel + ' ' + fieldLabel.toLowerCase() + ': ' + msg });
            }
          });
          // local_presence: at least one radio in the group must be checked.
          var lpChecked = block.querySelector('[data-field="local_presence"]:checked');
          if (!lpChecked) {
            var lpMsg = 'Please choose an option for Local presence.';
            setBrandError(brandIdx, 'local_presence', lpMsg);
            errors.push({ brandIdx: brandIdx, field: 'local_presence', message: brandLabel + ' local presence: ' + lpMsg });
          }
          // urls: optional, but enforce per-tier cap + http(s) shape.
          var urlsEl = block.querySelector('[data-field="urls"]');
          if (urlsEl && urlsEl.value.trim()) {
            var urlCap = tier ? TIER_MAX_URLS_PER_BRAND[tier] : 10;
            var urlLines = urlsEl.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
            if (urlLines.length > urlCap) {
              var capMsg = 'Too many URLs for the ' + tierDisplay(tier) + ' tier (' + urlLines.length + ' entered, ' + urlCap + ' max). Trim the list before submitting.';
              setBrandError(brandIdx, 'urls', capMsg);
              errors.push({ brandIdx: brandIdx, field: 'urls', message: brandLabel + ' URLs: ' + capMsg });
            } else {
              for (var u = 0; u < urlLines.length; u++) {
                if (!/^https?:\/\/[^\s]+$/i.test(urlLines[u])) {
                  var badMsg = 'Line ' + (u + 1) + ' is not a valid URL. Each URL must start with http:// or https:// and have no spaces.';
                  setBrandError(brandIdx, 'urls', badMsg);
                  errors.push({ brandIdx: brandIdx, field: 'urls', message: brandLabel + ' URLs: ' + badMsg });
                  break;
                }
              }
            }
          }
          // buyer_questions: required, enforce per-tier cap on entries.
          var bqEl = block.querySelector('[data-field="buyer_questions"]');
          if (bqEl && bqEl.value.trim()) {
            var bqCap = tier ? TIER_MAX_PROMPTS_PER_BRAND[tier] : 10;
            var bqLines = bqEl.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
            if (bqLines.length > bqCap) {
              var bqCapMsg = 'Too many buyer questions for the ' + tierDisplay(tier) + ' tier (' + bqLines.length + ' entered, ' + bqCap + ' max). Trim the list before submitting.';
              setBrandError(brandIdx, 'buyer_questions', bqCapMsg);
              errors.push({ brandIdx: brandIdx, field: 'buyer_questions', message: brandLabel + ' buyer questions: ' + bqCapMsg });
            }
          }
          // competitors: optional, enforce per-tier cap.
          var compEl = block.querySelector('[data-field="competitors"]');
          if (compEl && compEl.value.trim()) {
            var compCap = tier ? TIER_MAX_COMPETITORS[tier] : 2;
            var compLines = compEl.value.split('\n').map(function (s) { return s.trim(); }).filter(Boolean);
            if (compLines.length > compCap) {
              var compCapMsg = 'Too many competitors for the ' + tierDisplay(tier) + ' tier (' + compLines.length + ' entered, ' + compCap + ' max). Trim the list before submitting.';
              setBrandError(brandIdx, 'competitors', compCapMsg);
              errors.push({ brandIdx: brandIdx, field: 'competitors', message: brandLabel + ' competitors: ' + compCapMsg });
            }
          }
        });

        if (errors.length > 0) {
          showSummary(errors);
          announce(errors.length === 1
            ? 'One field needs attention.'
            : errors.length + ' fields need attention.');
          var first = errors[0];
          if (first.brandIdx != null) focusBrand(first.brandIdx, first.field);
          else focusEngagement(first.name);
          return false;
        }
        return true;
      }

      // ---- server 400 handler ----
      // Server returns either:
      //   - { ok: false, error: "<field>: <reason>" }            (legacy / engagement)
      //   - { ok: false, error: "brands[N].<field>: <reason>" }  (per-brand)
      function surfaceServerError(payload) {
        clearAllErrors();
        var raw = (payload && payload.error) || '';
        var rawStr = String(raw);

        // Per-brand error: "brands[N].<field>: <reason>"
        var brandMatch = /^brands\[(\d+)\]\.([a-z_]+):\s*(.+)$/.exec(rawStr);
        if (brandMatch) {
          var bIdx = parseInt(brandMatch[1], 10);
          var bField = brandMatch[2];
          var bReason = brandMatch[3];
          var bLabel = BRAND_FIELD_LABELS[bField] || bField;
          var bMsg = 'Brand ' + (bIdx + 1) + ' ' + bLabel.toLowerCase() + ': ' + bReason;
          setBrandError(bIdx, bField, bReason);
          showSummary([{ brandIdx: bIdx, field: bField, message: bMsg }]);
          focusBrand(bIdx, bField);
          announce(bMsg);
          return { brandIdx: bIdx, field: bField, message: bMsg };
        }

        // Engagement-level error: "<field>: <reason>"
        var match = /^([a-z_]+):\s*(.+)$/.exec(rawStr);
        if (match) {
          var name = match[1];
          var reason = match[2];
          if (name === '_root') {
            announce('Something was off with the submission. Please review and try again.');
            return { name: null, message: rawStr };
          }
          var label = ENGAGEMENT_FIELD_LABELS[name] || BRAND_FIELD_LABELS[name] || name;
          var msg = 'Please review ' + label + ' (' + reason + ').';
          if (ENGAGEMENT_FIELD_LABELS[name]) {
            setEngagementError(name, msg);
            showSummary([{ name: name, message: msg }]);
            focusEngagement(name);
            announce(msg);
            return { name: name, message: msg };
          }
        }
        // Fallback: server returned an unknown shape.
        summaryList.innerHTML = '';
        var li = document.createElement('li');
        li.textContent = 'Something was off with the submission: ' + (rawStr || 'unknown error') + '.';
        summaryList.appendChild(li);
        summary.hidden = false;
        announce('Something was off with the submission. Please review and try again.');
        return { name: null, message: rawStr };
      }

      // ---- network-failure panel ----
      function showRetryPanel() {
        form.hidden = true;
        success.hidden = true;
        retryPanel.hidden = false;
        retryPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      function hideRetryPanel() {
        retryPanel.hidden = true;
        form.hidden = false;
      }
      retryButton.addEventListener('click', function () {
        hideRetryPanel();
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      });

      // ---- submit handler ----
      form.addEventListener('submit', function (e) {
        // Bot trap: honeypot filled
        var hp = form.querySelector('input[name="_gotcha"]');
        if (hp && hp.value) { e.preventDefault(); return; }

        // Bot trap: form submitted unrealistically fast (<3s after page load)
        var tsEl = form.querySelector('#ts_loaded');
        var ts = parseInt((tsEl && tsEl.value) || '0', 10);
        if (ts && (Date.now() - ts) < 3000) {
          e.preventDefault();
          announce('Please take a moment to review your answers before submitting.');
          return;
        }

        e.preventDefault();

        if (!validateBeforeSubmit()) return;

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending…'; }

        function v(block, field) {
          var el = block.querySelector('[data-field="' + field + '"]');
          return el ? el.value.trim() : '';
        }
        function vRadio(block, field) {
          var el = block.querySelector('[data-field="' + field + '"]:checked');
          return el ? el.value : '';
        }

        var payload = {
          tier: currentTier(),
          first_name: form.first_name.value.trim(),
          last_name: form.last_name.value.trim(),
          email: form.email.value.trim(),
          audit_type: form.audit_type.value,
          acknowledgement: 'yes',
          _gotcha: form._gotcha.value,
          ts_loaded: form.ts_loaded.value,
          brands: brandBlocks().map(function (block) {
            return {
              company: v(block, 'company'),
              website: v(block, 'website'),
              urls: v(block, 'urls'),
              business_one_liner: v(block, 'business_one_liner'),
              brand_qualifier: v(block, 'brand_qualifier'),
              buyer_questions: v(block, 'buyer_questions'),
              competitors: v(block, 'competitors'),
              geo_focus: v(block, 'geo_focus'),
              local_presence: vRadio(block, 'local_presence')
            };
          })
        };

        fetch(form.action, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          }
        }).then(function (resp) {
          if (resp.ok) {
            form.hidden = true;
            retryPanel.hidden = true;
            success.hidden = false;
            success.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit intake'; }
          if (resp.status >= 400 && resp.status < 500) {
            resp.json().then(surfaceServerError).catch(function () {
              surfaceServerError({ error: 'server returned ' + resp.status });
            });
          } else {
            showRetryPanel();
          }
        }).catch(function () {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit intake'; }
          showRetryPanel();
        });
      });

      // ---- initial render ----
      addBrandBlock();              // Render Brand 1.
      updateAddBrandVisibility();
    }());

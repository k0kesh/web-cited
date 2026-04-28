// Extracted from contact.html 2026-04-28 (item W: strict CSP).
// Behavior unchanged. Loaded by
//   <script src="js/contact.js" defer></script>
//
    // Stamp page-load timestamp for the bot-trap window. Submissions
    // faster than ~3s are almost always bots.
    (function () {
      var ts = document.getElementById('ts_loaded');
      if (ts) ts.value = String(Date.now());
    }());

    // AJAX submission to the contact Worker (api.web-cited.com/contact).
    //
    // Same three failure modes as start.html, just on a smaller form:
    //   1. Pre-submit: form.checkValidity() per field + inline error
    //      messages, scroll/focus first invalid, summary banner.
    //   2. Server 400: parse {ok:false, error:"<field>: <reason>"} and
    //      anchor it to the right input.
    //   3. Fetch rejected / 5xx: dedicated retry panel.
    (function () {
      var form = document.getElementById('contact-form');
      var success = document.getElementById('contact-success');
      var retryPanel = document.getElementById('contact-retry');
      var retryButton = document.getElementById('contact-retry-button');
      var summary = document.getElementById('contact-error-summary');
      var summaryList = document.getElementById('contact-error-summary-list');
      var live = document.getElementById('contact-live');
      if (!form || !success || !retryPanel || !retryButton || !summary || !summaryList || !live) return;

      var FIELD_LABELS = {
        first_name: 'First name',
        last_name:  'Last name',
        email:      'Work email',
        company:    'Company',
        subject:    'Subject',
        message:    'Message'
      };

      var ERROR_EL = {};
      var FIELD_ROOT = {};
      var FIRST_FOCUSABLE = {};

      (function installErrorContainers() {
        var seen = {};
        var inputs = form.querySelectorAll('[name]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var name = el.name;
          if (!name || name === '_gotcha' || name === 'ts_loaded') continue;
          if (seen[name]) continue;
          seen[name] = true;

          var errEl = document.createElement('p');
          errEl.className = 'field-error';
          errEl.id = 'err-' + name;
          errEl.hidden = true;
          el.parentNode.insertBefore(errEl, el.nextSibling);

          var describers = (el.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
          if (describers.indexOf(errEl.id) === -1) describers.push(errEl.id);
          el.setAttribute('aria-describedby', describers.join(' '));

          ERROR_EL[name] = errEl;
          FIELD_ROOT[name] = el;
          FIRST_FOCUSABLE[name] = el;

          (function (fieldName) {
            function handler() { clearFieldError(fieldName); }
            if (el.tagName === 'SELECT') {
              el.addEventListener('change', handler);
            } else {
              el.addEventListener('input', handler);
            }
          }(name));
        }
      }());

      function setFieldError(name, message) {
        var errEl = ERROR_EL[name];
        if (!errEl) return;
        errEl.textContent = message;
        errEl.hidden = false;
        var root = FIELD_ROOT[name];
        if (root) {
          root.classList.add('field--invalid');
          root.setAttribute('aria-invalid', 'true');
        }
      }
      function clearFieldError(name) {
        var errEl = ERROR_EL[name];
        if (!errEl) return;
        errEl.hidden = true;
        errEl.textContent = '';
        var root = FIELD_ROOT[name];
        if (root) {
          root.classList.remove('field--invalid');
          root.removeAttribute('aria-invalid');
        }
      }
      function clearAllErrors() {
        for (var name in ERROR_EL) if (Object.prototype.hasOwnProperty.call(ERROR_EL, name)) clearFieldError(name);
        summary.hidden = true;
        summaryList.innerHTML = '';
      }

      function messageForPreSubmit(el, label) {
        var v = el.validity;
        if (!v) return 'Please fill in ' + label + '.';
        if (v.valueMissing) {
          if (el.tagName === 'SELECT') return 'Please pick a subject.';
          return 'Please fill in ' + label + '.';
        }
        if (v.typeMismatch) {
          if (el.type === 'email') return 'Please enter a valid work email (like jane@acme.com).';
        }
        if (v.tooShort) return label + ' is too short, please expand it a bit.';
        if (v.tooLong) return label + ' is too long, please shorten it.';
        return 'Please review ' + label + '.';
      }
      function messageForServer(name, reason, label) {
        if (/required string/i.test(reason)) return 'Please fill in ' + label + '.';
        if (/too short/i.test(reason))       return label + ' is too short, please expand it a bit.';
        if (/too long/i.test(reason))        return label + ' is too long, please shorten it.';
        if (/^unknown:/i.test(reason) && name === 'subject') return 'Please pick one of the listed subjects.';
        return 'Please review ' + label + ' (' + reason + ').';
      }

      function showSummary(errors) {
        summaryList.innerHTML = '';
        for (var i = 0; i < errors.length; i++) {
          var li = document.createElement('li');
          var a = document.createElement('a');
          a.href = '#' + (FIRST_FOCUSABLE[errors[i].name].id || 'err-' + errors[i].name);
          a.textContent = errors[i].message;
          a.addEventListener('click', (function (name) {
            return function (ev) { ev.preventDefault(); focusField(name); };
          }(errors[i].name)));
          li.appendChild(a);
          summaryList.appendChild(li);
        }
        summary.hidden = false;
      }
      function focusField(name) {
        var target = FIRST_FOCUSABLE[name];
        if (!target) return;
        try { target.focus({ preventScroll: true }); } catch (e) { target.focus(); }
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      function announce(msg) {
        live.textContent = '';
        setTimeout(function () { live.textContent = msg; }, 50);
      }

      function validateBeforeSubmit() {
        clearAllErrors();
        var errors = [];
        var seen = {};
        var inputs = form.querySelectorAll('[name]');
        for (var i = 0; i < inputs.length; i++) {
          var el = inputs[i];
          var name = el.name;
          if (!name || name === '_gotcha' || name === 'ts_loaded') continue;
          if (seen[name]) continue;
          seen[name] = true;
          if (!el.checkValidity()) {
            var m = messageForPreSubmit(el, FIELD_LABELS[name] || name);
            setFieldError(name, m);
            errors.push({ name: name, message: m });
          }
        }
        if (errors.length > 0) {
          showSummary(errors);
          announce(errors.length === 1 ? 'One field needs attention.' : errors.length + ' fields need attention.');
          focusField(errors[0].name);
          return false;
        }
        return true;
      }

      function surfaceServerError(payload) {
        clearAllErrors();
        var raw = (payload && payload.error) || '';
        var match = /^([a-z_]+):\s*(.+)$/.exec(String(raw));
        if (match) {
          var name = match[1];
          var reason = match[2];
          if (name === '_root') {
            announce('Something was off with the submission. Please review and try again.');
            return;
          }
          var label = FIELD_LABELS[name] || name;
          var msg = messageForServer(name, reason, label);
          if (ERROR_EL[name]) {
            setFieldError(name, msg);
            showSummary([{ name: name, message: msg }]);
            focusField(name);
            announce(msg);
            return;
          }
        }
        summaryList.innerHTML = '';
        var li = document.createElement('li');
        li.textContent = 'Something was off with the submission: ' + (raw || 'unknown error') + '.';
        summaryList.appendChild(li);
        summary.hidden = false;
        announce('Something was off with the submission. Please review and try again.');
      }

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

      form.addEventListener('submit', function (e) {
        var hp = form.querySelector('input[name="_gotcha"]');
        if (hp && hp.value) { e.preventDefault(); return; }
        var tsEl = form.querySelector('#ts_loaded');
        var ts = parseInt((tsEl && tsEl.value) || '0', 10);
        if (ts && (Date.now() - ts) < 3000) {
          e.preventDefault();
          announce('Please take a moment to review your message before submitting.');
          return;
        }
        e.preventDefault();
        if (!validateBeforeSubmit()) return;

        var submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }

        var payload = Object.fromEntries(new FormData(form));

        fetch(form.action, {
          method: 'POST',
          body: JSON.stringify(payload),
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
        }).then(function (resp) {
          if (resp.ok) {
            form.hidden = true;
            retryPanel.hidden = true;
            success.hidden = false;
            success.scrollIntoView({ behavior: 'smooth', block: 'start' });
            return;
          }
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send message'; }
          if (resp.status >= 400 && resp.status < 500) {
            resp.json().then(surfaceServerError).catch(function () {
              surfaceServerError({ error: 'server returned ' + resp.status });
            });
          } else {
            showRetryPanel();
          }
        }).catch(function () {
          if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Send message'; }
          showRetryPanel();
        });
      });
    }());

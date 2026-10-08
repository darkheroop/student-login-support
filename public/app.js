document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('diagnostics-form');
  const mobileInput = document.getElementById('mobile-input');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnSpinner = submitBtn.querySelector('.btn-spinner');
  const validationError = document.getElementById('validation-error');

  const loadingCard = document.getElementById('loading-card');
  const errorCard = document.getElementById('error-card');
  const errorTitle = document.getElementById('error-title');
  const errorMessage = document.getElementById('error-message');

  const resultsCard = document.getElementById('results-card');
  const metricDuration = document.getElementById('metric-duration');
  const metricRequests = document.getElementById('metric-requests');
  const metricResponses = document.getElementById('metric-responses');
  const timelineList = document.getElementById('timeline-list');

  // Basic mobile regex
  const mobileRegex = /^[+]?[(]?[0-9]{1,4}[)]?[-\s./0-9]{6,16}$/;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const mobile = mobileInput.value.trim();

    // Client-side validation
    if (!mobile || !mobileRegex.test(mobile)) {
      validationError.textContent = 'Please enter a valid mobile number (7–20 digits).';
      validationError.hidden = false;
      mobileInput.focus();
      return;
    }

    validationError.hidden = true;
    setLoadingState(true);

    try {
      const response = await fetch('/api/support/login-diagnostics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ mobile }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        showError(
          data.error?.code || 'DIAGNOSTIC_FAILURE',
          data.error?.message || 'Upstream service failed to respond with valid diagnostic data.'
        );
      } else {
        renderResults(data.diagnostics);
      }
    } catch (err) {
      showError(
        'NETWORK_ERROR',
        'Could not communicate with the local diagnostic service. Please check server health.'
      );
    } finally {
      setLoadingState(false);
    }
  });

  mobileInput.addEventListener('input', () => {
    if (!validationError.hidden) {
      validationError.hidden = true;
    }
  });

  function setLoadingState(isLoading) {
    mobileInput.disabled = isLoading;
    submitBtn.disabled = isLoading;
    btnText.textContent = isLoading ? 'Processing...' : 'Check Login Status';
    btnSpinner.hidden = !isLoading;

    if (isLoading) {
      loadingCard.hidden = false;
      errorCard.hidden = true;
      resultsCard.hidden = true;
    } else {
      loadingCard.hidden = true;
    }
  }

  function showError(code, message) {
    errorTitle.textContent = `Diagnostic Error (${code})`;
    errorMessage.textContent = message;
    errorCard.hidden = false;
    resultsCard.hidden = true;
  }

  function renderResults(diagnostics) {
    errorCard.hidden = true;
    resultsCard.hidden = false;

    metricDuration.textContent = `${diagnostics.durationMs}ms`;
    metricRequests.textContent = diagnostics.requestCount;
    metricResponses.textContent = diagnostics.responseCount;

    timelineList.innerHTML = '';

    diagnostics.events.forEach((event, index) => {
      const item = createTimelineItem(event, index);
      timelineList.appendChild(item);
    });
  }

  function createTimelineItem(event, index) {
    const item = document.createElement('div');
    item.className = 'timeline-item' + (index === 0 ? ' open' : '');

    const statusBadgeClass =
      event.status >= 200 && event.status < 300
        ? 'badge-2xx'
        : event.status >= 400 && event.status < 500
        ? 'badge-4xx'
        : 'badge-5xx';

    const statusText = event.status > 0 ? `${event.status}` : 'ERR';

    item.innerHTML = `
      <div class="timeline-item-header">
        <div class="header-left">
          <span class="step-num">Step ${index + 1}</span>
          <span class="http-method ${event.method}">${event.method}</span>
          <span class="endpoint-path font-mono">${escapeHtml(event.path)}</span>
        </div>
        <div class="header-right">
          ${event.retryAttempt ? `<span class="duration-tag font-mono">(Retry #${event.retryAttempt})</span>` : ''}
          <span class="duration-tag font-mono">${event.durationMs}ms</span>
          <span class="badge ${statusBadgeClass}">${statusText}</span>
          <span class="chevron">▶</span>
        </div>
      </div>
      <div class="timeline-item-body">
        <div class="payload-toolbar">
          <span class="payload-title">Opaque Upstream Payload (${event.responseType})</span>
          <button type="button" class="copy-btn">Copy Payload</button>
        </div>
        <pre class="payload-pre font-mono"><code>${formatPayload(event.response)}</code></pre>
      </div>
    `;

    // Toggle accordion
    const header = item.querySelector('.timeline-item-header');
    header.addEventListener('click', () => {
      item.classList.toggle('open');
    });

    // Copy payload button
    const copyBtn = item.querySelector('.copy-btn');
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const rawText = typeof event.response === 'object'
        ? JSON.stringify(event.response, null, 2)
        : String(event.response ?? '');
      await navigator.clipboard.writeText(rawText);
      const originalText = copyBtn.textContent;
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = originalText;
      }, 1800);
    });

    return item;
  }

  function formatPayload(data) {
    if (data === null || data === undefined) {
      return '<span class="json-null">null (empty body)</span>';
    }

    if (typeof data !== 'object') {
      return escapeHtml(String(data));
    }

    const jsonString = JSON.stringify(data, null, 2);
    return syntaxHighlight(jsonString);
  }

  function syntaxHighlight(json) {
    json = escapeHtml(json);
    return json.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          if (/:$/.test(match)) {
            cls = 'json-key';
          } else {
            cls = 'json-string';
            if (match === '"[REDACTED]"') {
              return '<span class="json-redacted">[REDACTED]</span>';
            }
          }
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
});

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

  const analysisBox = document.getElementById('analysis-box');
  const analysisIcon = document.getElementById('analysis-icon');
  const analysisTitle = document.getElementById('analysis-title');
  const analysisSummary = document.getElementById('analysis-summary');
  const analysisAction = document.getElementById('analysis-action');

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

    if (diagnostics.analysis) {
      analysisBox.hidden = false;
      analysisTitle.textContent = diagnostics.analysis.title;
      analysisSummary.textContent = diagnostics.analysis.summary;
      analysisAction.textContent = diagnostics.analysis.recommendedAction;

      analysisBox.className = 'analysis-box';
      if (diagnostics.analysis.verdict === 'SUCCESS') {
        analysisBox.classList.add('verdict-success');
        analysisIcon.textContent = '✅';
      } else if (diagnostics.analysis.verdict === 'GATEWAY_DELAY') {
        analysisBox.classList.add('verdict-delay');
        analysisIcon.textContent = '⏳';
      } else if (diagnostics.analysis.verdict === 'STUDENT_NOT_FOUND') {
        analysisBox.classList.add('verdict-not-found');
        analysisIcon.textContent = '⚠️';
      } else if (diagnostics.analysis.verdict === 'RATE_LIMITED') {
        analysisBox.classList.add('verdict-rate-limited');
        analysisIcon.textContent = '🛑';
      } else {
        analysisBox.classList.add('verdict-error');
        analysisIcon.textContent = '❌';
      }
    } else {
      analysisBox.hidden = true;
    }

    timelineList.innerHTML = '';

    diagnostics.events.forEach((event, index) => {
      const item = createTimelineItem(event, index);
      timelineList.appendChild(item);
    });

    mobileInput.select();
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
    const displayUrl = event.url || event.path;

    item.innerHTML = `
      <div class="timeline-item-header">
        <div class="header-left">
          <span class="step-num">Step ${index + 1}</span>
          <span class="http-method ${event.method}">${event.method}</span>
          <span class="endpoint-path font-mono">${escapeHtml(displayUrl)}</span>
        </div>
        <div class="header-right">
          ${event.retryAttempt ? `<span class="duration-tag font-mono">(Retry #${event.retryAttempt})</span>` : ''}
          <span class="duration-tag font-mono">${event.durationMs}ms</span>
          <span class="badge ${statusBadgeClass}">${statusText}</span>
          <span class="chevron">▶</span>
        </div>
      </div>
      <div class="timeline-item-body">
        ${event.requestPayload ? `
        <div class="payload-section" style="margin-bottom: 1rem;">
          <div class="payload-toolbar">
            <span class="payload-title">Intercepted Outgoing Request</span>
            <button type="button" class="copy-btn copy-req-btn">Copy Request</button>
          </div>
          <pre class="payload-pre font-mono"><code>${formatPayload(event.requestPayload)}</code></pre>
        </div>` : ''}

        <div class="payload-section">
          <div class="payload-toolbar">
            <span class="payload-title">Intercepted Upstream Response (${event.responseType})</span>
            <button type="button" class="copy-btn copy-res-btn">Copy Response</button>
          </div>
          <pre class="payload-pre font-mono"><code>${formatPayload(event.response)}</code></pre>
        </div>
      </div>
    `;

    // Toggle accordion
    const header = item.querySelector('.timeline-item-header');
    header.addEventListener('click', () => {
      item.classList.toggle('open');
    });

    // Copy request button
    const copyReqBtn = item.querySelector('.copy-req-btn');
    if (copyReqBtn) {
      copyReqBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rawText = typeof event.requestPayload === 'object'
          ? JSON.stringify(event.requestPayload, null, 2)
          : String(event.requestPayload ?? '');
        await navigator.clipboard.writeText(rawText);
        copyReqBtn.textContent = 'Copied!';
        setTimeout(() => { copyReqBtn.textContent = 'Copy Request'; }, 1800);
      });
    }

    // Copy response button
    const copyResBtn = item.querySelector('.copy-res-btn');
    if (copyResBtn) {
      copyResBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const rawText = typeof event.response === 'object'
          ? JSON.stringify(event.response, null, 2)
          : String(event.response ?? '');
        await navigator.clipboard.writeText(rawText);
        copyResBtn.textContent = 'Copied!';
        setTimeout(() => { copyResBtn.textContent = 'Copy Response'; }, 1800);
      });
    }

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

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('student-lookup-form');
  const studentInput = document.getElementById('student-number-input');
  const submitBtn = document.getElementById('submit-btn');
  const btnText = submitBtn.querySelector('.btn-text');
  const btnSpinner = submitBtn.querySelector('.btn-spinner');
  const validationError = document.getElementById('validation-error');

  const loadingCard = document.getElementById('loading-card');
  const errorCard = document.getElementById('error-card');
  const errorMessage = document.getElementById('error-message');

  const resultsCard = document.getElementById('results-card');
  const outputUsername = document.getElementById('output-username');
  const outputPassword = document.getElementById('output-password');
  const copyHashBtn = document.getElementById('copy-hash-btn');
  const copyFeedback = document.getElementById('copy-feedback');
  let copyTimeout = null;

  // Input change clears validation error
  studentInput.addEventListener('input', () => {
    if (!validationError.hidden) {
      validationError.hidden = true;
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    // Prevent duplicate submission if already processing
    if (submitBtn.disabled) return;

    // Preserves leading zeros as a string, trims accidental whitespace
    const rawVal = studentInput.value;
    const studentNumber = typeof rawVal === 'string' ? rawVal.trim() : '';

    if (!studentNumber) {
      validationError.textContent = 'Please enter a student number.';
      validationError.hidden = false;
      studentInput.focus();
      return;
    }

    validationError.hidden = true;
    
    // Clear previous results/errors to prevent display artifacts
    outputUsername.textContent = '';
    outputPassword.textContent = '';
    errorMessage.textContent = '';

    setLoading(true);

    try {
      const response = await fetch('/api/support/login-diagnostics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ studentNumber }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        showError(data.error?.message || 'Student record not found.');
      } else {
        renderResult(data.username, data.hash || data.password);
      }
    } catch (err) {
      showError('Unable to communicate with the lookup service.');
    } finally {
      setLoading(false);
    }
  });

  function setLoading(isLoading) {
    studentInput.disabled = isLoading;
    submitBtn.disabled = isLoading;
    btnText.textContent = isLoading ? 'Processing...' : 'Submit';
    btnSpinner.hidden = !isLoading;

    if (isLoading) {
      loadingCard.hidden = false;
      errorCard.hidden = true;
      resultsCard.hidden = true;
      if (copyHashBtn) copyHashBtn.hidden = true;
    } else {
      loadingCard.hidden = true;
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg || 'An error occurred during lookup.';
    errorCard.hidden = false;
    resultsCard.hidden = true;
    loadingCard.hidden = true;
    if (copyHashBtn) copyHashBtn.hidden = true;
  }

  function renderResult(username, password) {
    const hasValidHash = Boolean(password && typeof password === 'string' && password.trim() && password.trim() !== 'Password hash unavailable');
    outputUsername.textContent = username || '-';
    outputPassword.textContent = hasValidHash ? password.trim() : 'Password hash unavailable';

    if (copyHashBtn) {
      copyHashBtn.hidden = !hasValidHash;
      copyHashBtn.classList.remove('copied', 'copy-error');
      if (copyFeedback) copyFeedback.textContent = '';
      copyHashBtn.setAttribute('title', 'Copy hash');
    }

    resultsCard.hidden = false;
    errorCard.hidden = true;
    loadingCard.hidden = true;
  }

  // Copy hash to clipboard handler
  copyHashBtn?.addEventListener('click', async () => {
    const hashToCopy = outputPassword.textContent ? outputPassword.textContent.trim() : '';
    if (!hashToCopy || hashToCopy === 'Password hash unavailable' || hashToCopy === '-') {
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(hashToCopy);
      } else {
        // Fallback for non-secure / older browser contexts
        const textArea = document.createElement('textarea');
        textArea.value = hashToCopy;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!successful) throw new Error('Copy command failed');
      }

      copyHashBtn.classList.add('copied');
      copyHashBtn.classList.remove('copy-error');
      if (copyFeedback) copyFeedback.textContent = 'Copied!';
      copyHashBtn.setAttribute('title', 'Copied to clipboard!');

      clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copyHashBtn.classList.remove('copied');
        if (copyFeedback) copyFeedback.textContent = '';
        copyHashBtn.setAttribute('title', 'Copy hash');
      }, 2000);
    } catch (err) {
      copyHashBtn.classList.add('copy-error');
      if (copyFeedback) copyFeedback.textContent = 'Failed';
      clearTimeout(copyTimeout);
      copyTimeout = setTimeout(() => {
        copyHashBtn.classList.remove('copy-error');
        if (copyFeedback) copyFeedback.textContent = '';
      }, 2500);
    }
  });
});

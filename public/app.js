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
        renderResult(data.username, data.password);
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
    } else {
      loadingCard.hidden = true;
    }
  }

  function showError(msg) {
    errorMessage.textContent = msg || 'An error occurred during lookup.';
    errorCard.hidden = false;
    resultsCard.hidden = true;
    loadingCard.hidden = true;
  }

  function renderResult(username, password) {
    outputUsername.textContent = username || '-';
    outputPassword.textContent = (password && typeof password === 'string' && password.trim())
      ? password
      : 'Password hash unavailable';
    resultsCard.hidden = false;
    errorCard.hidden = true;
    loadingCard.hidden = true;
  }
});

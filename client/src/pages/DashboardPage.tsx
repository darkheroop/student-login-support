import React, { useState } from 'react';
import { useDiagnostics } from '../hooks/useDiagnostics';
import LoadingSpinner from '../components/LoadingSpinner';
import DiagnosticTimeline from '../components/DiagnosticTimeline';

const DashboardPage: React.FC = () => {
  const [mobile, setMobile] = useState('');
  const [validationError, setValidationError] = useState('');
  const { result, loading, error, runDiagnostics } = useDiagnostics();

  const validateMobile = (num: string) => {
    // 7-20 characters: digits, spaces, hyphens, dots, parentheses, plus
    const regex = /^[+]?[0-9\s\-().]{7,20}$/;
    return regex.test(num.trim());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (loading) return; // Prevent duplicate submissions

    setValidationError('');

    const trimmed = mobile.trim();
    if (!trimmed) {
      setValidationError('Please enter a student mobile number.');
      return;
    }

    if (!validateMobile(trimmed)) {
      setValidationError('Invalid mobile format. Please enter a valid 7-20 digit number.');
      return;
    }

    runDiagnostics(trimmed);
  };

  return (
    <div className="single-page-container">
      {/* Header */}
      <header className="page-header">
        <div className="header-content">
          <h1>Student Login Support</h1>
          <p className="subtitle">
            Enter a student mobile number to execute the authorized upstream diagnostic workflow.
          </p>
        </div>
      </header>

      {/* Main Single-Page Workflow Card */}
      <main className="main-content">
        <div className="card workflow-card">
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="mobile">Student Mobile Number</label>
              <div className="input-group">
                <input
                  type="text"
                  id="mobile"
                  name="mobile"
                  placeholder="e.g. +91 98765 43210"
                  value={mobile}
                  onChange={(e) => {
                    setMobile(e.target.value);
                    if (validationError) setValidationError('');
                  }}
                  disabled={loading}
                  autoComplete="off"
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={loading || !mobile.trim()}
                  className="submit-button"
                >
                  {loading ? (
                    <span className="loading-content">
                      <LoadingSpinner /> Processing...
                    </span>
                  ) : (
                    'Check Login Status'
                  )}
                </button>
              </div>
              {validationError && <div className="error-text">{validationError}</div>}
            </div>
          </form>
        </div>

        {/* Loading Indicator */}
        {loading && (
          <div className="card status-card loading-card">
            <LoadingSpinner />
            <h3>Processing Diagnostics...</h3>
            <p className="text-secondary text-sm">
              Executing authorized upstream workflow and capturing response payloads
            </p>
          </div>
        )}

        {/* Error State */}
        {!loading && error && (
          <div className="card status-card error-card">
            <div className="status-header">
              <span className="status-icon">⚠️</span>
              <h3>Unable to Complete Diagnostics</h3>
            </div>
            <p className="error-detail">{error}</p>
          </div>
        )}

        {/* Success Output */}
        {!loading && result && (
          <div className="card results-card">
            <div className="results-header">
              <div className="status-pill success-pill">
                ✓ Diagnostic Workflow Complete
              </div>
              <div className="stats-row">
                <span className="stat-item">
                  <strong>Duration:</strong> {result.durationMs}ms
                </span>
                <span className="stat-separator">•</span>
                <span className="stat-item">
                  <strong>Requests:</strong> {result.requestCount}
                </span>
                <span className="stat-separator">•</span>
                <span className="stat-item">
                  <strong>Responses:</strong> {result.responseCount}
                </span>
              </div>
            </div>

            <div className="timeline-section">
              <h3>Diagnostic Results & Request Timeline</h3>
              <DiagnosticTimeline events={result.events} />
            </div>
          </div>
        )}
      </main>

      <footer className="page-footer">
        <p className="text-secondary text-sm">
          Authorized Student Login Diagnostic System • Pure Stateless Processing
        </p>
      </footer>
    </div>
  );
};

export default DashboardPage;

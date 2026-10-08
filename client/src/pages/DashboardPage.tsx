import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useDiagnostics, HistoryItem } from '../hooks/useDiagnostics';
import LoadingSpinner from '../components/LoadingSpinner';
import DiagnosticTimeline from '../components/DiagnosticTimeline';
import StatusBadge from '../components/StatusBadge';

const DashboardPage: React.FC = () => {
  const { user, logout } = useAuth();
  const [mobile, setMobile] = useState('');
  const [validationError, setValidationError] = useState('');
  const { result, loading, error, history, runDiagnostics, selectHistoryItem } = useDiagnostics();

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
      setValidationError('Invalid mobile format. Must be 7-20 characters (digits, +, -, space, brackets).');
      return;
    }

    runDiagnostics(trimmed);
  };

  const handleSelectRecent = (item: HistoryItem) => {
    setMobile(item.mobile);
    setValidationError('');
    selectHistoryItem(item);
  };

  return (
    <div className="dashboard-layout">
      <header className="dashboard-header">
        <div className="header-brand">
          <span className="brand-icon">🛡️</span>
          <h1>Student Login Support</h1>
          <span className="environment-tag">Authorized Support</span>
        </div>
        <div className="user-controls">
          <span className="username">
            Operator: <strong>{user?.username}</strong> ({user?.role})
          </span>
          <button type="button" onClick={logout} className="logout-button">
            Logout
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        {/* Left Sidebar: Controls & Run History */}
        <aside className="dashboard-sidebar">
          <div className="card">
            <h2>Start Diagnostics</h2>
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-group">
                <label htmlFor="mobile">Student Mobile Number</label>
                <div className="input-with-icon">
                  <span className="icon">📱</span>
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
                  />
                </div>
                {validationError && <div className="error-text">{validationError}</div>}
              </div>

              <button
                type="submit"
                disabled={loading || !mobile.trim()}
                className="primary-button"
                id="start-diagnostics-btn"
              >
                {loading ? (
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                    <LoadingSpinner /> Intercepting & Diagnosing...
                  </span>
                ) : (
                  'Start Login Diagnostics'
                )}
              </button>
            </form>
          </div>

          <div className="card mt-4">
            <h2>Recent Runs ({history.length})</h2>
            {history.length === 0 ? (
              <p className="text-secondary text-sm">No recent diagnostic runs in this session.</p>
            ) : (
              <ul className="history-list">
                {history.map((item, idx) => (
                  <li
                    key={idx}
                    className="history-item"
                    onClick={() => handleSelectRecent(item)}
                    style={{ cursor: 'pointer' }}
                    title="Click to view run results"
                  >
                    <div>
                      <span className="history-mobile font-mono">{item.mobile}</span>
                      <span className="history-time">
                        {new Date(item.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div>
                      <StatusBadge status={item.success ? 200 : 502} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Right Section: Results & Timeline */}
        <section className="dashboard-content">
          <div className="card results-card">
            <h2>Diagnostic Results</h2>

            {loading && (
              <div className="loading-state">
                <LoadingSpinner />
                <p style={{ marginTop: '1rem', fontWeight: 500 }}>Executing authorized login-support workflow...</p>
                <span className="text-secondary text-sm">
                  Forwarding requests through internal proxy layer & capturing upstream responses
                </span>
              </div>
            )}

            {!loading && error && (
              <div className="error-message large">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>⚠️</span>
                  <h3 style={{ margin: 0 }}>Diagnostic Error</h3>
                </div>
                <p style={{ margin: 0 }}>{error}</p>
              </div>
            )}

            {!loading && !error && !result && (
              <div className="empty-state">
                <span style={{ fontSize: '3rem', opacity: 0.4 }}>🔍</span>
                <p style={{ fontWeight: 500 }}>No Active Diagnostic Run</p>
                <span className="text-secondary text-sm">
                  Enter a student's mobile number on the left to initiate the authorized login-support diagnostic flow.
                </span>
              </div>
            )}

            {!loading && result && (
              <div className="results-container">
                <div className="results-summary">
                  <div className="summary-stat">
                    <span className="stat-label">Operation Status</span>
                    <span className="stat-value" style={{ color: 'var(--success)' }}>
                      COMPLETED
                    </span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-label">Duration</span>
                    <span className="stat-value font-mono">{result.durationMs}ms</span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-label">Upstream Requests</span>
                    <span className="stat-value font-mono">{result.requestCount}</span>
                  </div>
                  <div className="summary-stat">
                    <span className="stat-label">Upstream Responses</span>
                    <span className="stat-value font-mono">{result.responseCount}</span>
                  </div>
                </div>

                <div className="timeline-container">
                  <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Diagnostic Timeline</h3>
                  <DiagnosticTimeline events={result.events} />
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

export default DashboardPage;

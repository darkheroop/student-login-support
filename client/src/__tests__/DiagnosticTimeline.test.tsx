import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import DiagnosticTimeline from '../components/DiagnosticTimeline';
import { DiagnosticEvent } from '../types';

describe('DiagnosticTimeline Component', () => {
  it('renders empty message when no events exist', () => {
    render(<DiagnosticTimeline events={[]} />);
    expect(screen.getByText('No diagnostic events recorded for this run.')).toBeInTheDocument();
  });

  it('renders request and response stages with status and path', () => {
    const events: DiagnosticEvent[] = [
      {
        requestId: 'req-1',
        timestamp: '2026-10-08T10:00:00.000Z',
        method: 'POST',
        path: '/authorized/login-support',
        status: 200,
        durationMs: 45,
        response: { success: true },
        responseType: 'json',
      },
      {
        requestId: 'req-2',
        timestamp: '2026-10-08T10:00:01.000Z',
        method: 'POST',
        path: '/authorized/verification-state',
        status: 200,
        durationMs: 80,
        response: { state: 'VERIFIED' },
        responseType: 'json',
        retryAttempt: 2,
      },
    ];

    render(<DiagnosticTimeline events={events} />);

    expect(screen.getByText('/authorized/login-support')).toBeInTheDocument();
    expect(screen.getByText('/authorized/verification-state')).toBeInTheDocument();
    expect(screen.getByText('Retry #2')).toBeInTheDocument();
    expect(screen.getAllByText('REQUEST')).toHaveLength(2);
    expect(screen.getAllByText('RESPONSE')).toHaveLength(2);

    // Click Expand All button
    const expandAllBtn = screen.getByText('Expand All');
    fireEvent.click(expandAllBtn);
    expect(screen.getByText('success')).toBeInTheDocument();
    expect(screen.getByText('state')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
  });
});

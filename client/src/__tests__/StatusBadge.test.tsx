import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from '../components/StatusBadge';

describe('StatusBadge Component', () => {
  it('renders HTTP 200 badge with green class', () => {
    render(<StatusBadge status={200} />);
    const badge = screen.getByText('200');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('status-badge-green');
  });

  it('renders HTTP 400 badge with yellow class', () => {
    render(<StatusBadge status={400} />);
    const badge = screen.getByText('400');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('status-badge-yellow');
  });

  it('renders HTTP 500 badge with red class', () => {
    render(<StatusBadge status={500} />);
    const badge = screen.getByText('500');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('status-badge-red');
  });

  it('renders status 0 as ERR with gray class', () => {
    render(<StatusBadge status={0} />);
    const badge = screen.getByText('ERR');
    expect(badge).toBeInTheDocument();
    expect(badge.className).toContain('status-badge-gray');
  });
});

import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import JsonViewer from '../components/JsonViewer';

describe('JsonViewer Component', () => {
  it('renders empty response body placeholder when data is null/undefined/empty', () => {
    render(<JsonViewer data={null} />);
    expect(screen.getByText('(empty response body)')).toBeInTheDocument();
  });

  it('renders arbitrary JSON data and redacts sensitive keys', () => {
    const data = {
      username: 'student123',
      password: 'superSecretPassword',
      safeInfo: 'verified',
    };
    render(<JsonViewer data={data} />);
    expect(screen.getByText('username')).toBeInTheDocument();
    expect(screen.getByText('student123')).toBeInTheDocument();
    expect(screen.getByText('safeInfo')).toBeInTheDocument();
    expect(screen.getByText('"[REDACTED]"')).toBeInTheDocument();
    expect(screen.queryByText('superSecretPassword')).not.toBeInTheDocument();
  });

  it('switches between Formatted and Raw tabs', () => {
    const data = { status: 'active' };
    render(<JsonViewer data={data} />);

    const rawTab = screen.getByText('Raw');
    fireEvent.click(rawTab);
    expect(rawTab.className).toContain('active');

    const formattedTab = screen.getByText('Formatted');
    fireEvent.click(formattedTab);
    expect(formattedTab.className).toContain('active');
  });

  it('highlights search terms when filtering', () => {
    const data = { studentName: 'Alice', studentRole: 'Undergrad' };
    render(<JsonViewer data={data} />);

    const searchInput = screen.getByPlaceholderText('Search / Filter...');
    fireEvent.change(searchInput, { target: { value: 'Alice' } });

    const mark = screen.getByText('Alice');
    expect(mark.tagName).toBe('MARK');
  });
});

import React, { useState } from 'react';
import { DiagnosticEvent } from '../types';
import JsonViewer from './JsonViewer';
import StatusBadge from './StatusBadge';

interface Props {
  events: DiagnosticEvent[];
}

const DiagnosticTimeline: React.FC<Props> = ({ events }) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedItems(new Set(events.map((e, i) => `${e.requestId}-${i}`)));
  };

  const collapseAll = () => {
    setExpandedItems(new Set());
  };

  const formatTime = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toTimeString().split(' ')[0] + '.' + String(d.getMilliseconds()).padStart(3, '0');
    } catch {
      return isoString;
    }
  };

  if (!events || events.length === 0) {
    return <div className="text-secondary" style={{ padding: '1rem', fontStyle: 'italic' }}>No diagnostic events recorded for this run.</div>;
  }

  return (
    <div className="timeline-wrapper">
      <div className="timeline-controls" style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginBottom: '1rem' }}>
        <button type="button" onClick={expandAll} className="small-button">Expand All</button>
        <button type="button" onClick={collapseAll} className="small-button">Collapse All</button>
      </div>

      <div className="timeline">
        {events.map((event, index) => {
          const id = `${event.requestId}-${index}`;
          const isExpanded = expandedItems.has(id);
          const timeStr = formatTime(event.timestamp);

          return (
            <div key={id} className="timeline-entry card" style={{ marginBottom: '1rem' }}>
              {/* Request Segment */}
              <div className="timeline-row request-row" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', paddingBottom: '0.5rem' }}>
                <span className="time-badge font-mono">{timeStr}</span>
                <span className="stage-tag stage-request">REQUEST</span>
                <span className={`method-badge ${event.method.toLowerCase()}`}>{event.method}</span>
                <span className="path-text font-mono">{event.path}</span>
              </div>

              {/* Response Segment */}
              <div 
                className="timeline-row response-row" 
                onClick={() => toggleExpand(id)}
                style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  gap: '0.75rem', 
                  cursor: 'pointer',
                  paddingTop: '0.5rem', 
                  borderTop: '1px dashed var(--border)' 
                }}
              >
                <span className="time-badge font-mono">{timeStr}</span>
                <span className="stage-tag stage-response">RESPONSE</span>
                <span className="http-status-label font-mono">
                  {event.status > 0 ? `HTTP ${event.status}` : 'ERROR'}
                </span>
                <StatusBadge status={event.status} />

                <span className="duration-tag text-secondary text-sm">
                  {event.durationMs}ms
                </span>

                {event.retryAttempt !== undefined && event.retryAttempt > 0 && (
                  <span className="retry-badge">Retry #{event.retryAttempt}</span>
                )}

                <div className="flex-spacer" style={{ flex: 1 }} />

                <span className="expand-indicator text-secondary text-sm">
                  {isExpanded ? '▲ Hide Body' : '▼ View Body'}
                </span>
              </div>

              {/* Expandable Response Body */}
              {isExpanded && (
                <div className="timeline-details" style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border)' }}>
                  <JsonViewer 
                    data={event.response} 
                    title={`Response Body (${event.responseType.toUpperCase()})`} 
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DiagnosticTimeline;

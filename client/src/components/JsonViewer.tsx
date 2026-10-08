import React, { useState, useMemo } from 'react';

interface Props {
  data: unknown;
  title?: string;
}

const SENSITIVE_TERMS = ['password', 'otp', 'pin', 'secret', 'token', 'authorization', 'cookie', 'cvv', 'ssn'];

const isSensitiveKey = (key: string): boolean => {
  const lower = key.toLowerCase();
  return SENSITIVE_TERMS.some(term => {
    if (term === 'pin') {
      return /(^|[_\W])pin($|[_\W])|pinCode|userPin/i.test(key);
    }
    return lower.includes(term);
  });
};

const maskSensitiveData = (val: unknown, keyName?: string): unknown => {
  if (keyName && isSensitiveKey(keyName)) {
    return '[REDACTED]';
  }
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) {
    return val.map((item, idx) => maskSensitiveData(item, String(idx)));
  }
  if (typeof val === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      copy[k] = isSensitiveKey(k) ? '[REDACTED]' : maskSensitiveData(v, k);
    }
    return copy;
  }
  return val;
};

const HighlightedText: React.FC<{ text: string; search: string; color?: string }> = ({ text, search, color }) => {
  if (!search.trim()) {
    return <span style={{ color }}>{text}</span>;
  }

  const parts = text.split(new RegExp(`(${search.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi'));
  return (
    <span style={{ color }}>
      {parts.map((part, i) =>
        part.toLowerCase() === search.toLowerCase() ? (
          <mark key={i} style={{ backgroundColor: '#fef08a', color: '#854d0e', padding: '0 2px', borderRadius: '2px' }}>
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
};

const JsonNode: React.FC<{
  data: unknown;
  name?: string;
  searchTerm: string;
  depth?: number;
}> = ({ data, name, searchTerm, depth = 0 }) => {
  const [collapsed, setCollapsed] = useState(false);

  // Primitives and null
  if (typeof data !== 'object' || data === null) {
    let renderedVal: React.ReactNode;

    if (name && isSensitiveKey(name)) {
      renderedVal = <span style={{ color: 'var(--success)', fontWeight: 600 }}>"[REDACTED]"</span>;
    } else if (data === null) {
      renderedVal = <span style={{ color: 'var(--error)' }}>null</span>;
    } else if (typeof data === 'boolean') {
      renderedVal = <span style={{ color: '#c084fc', fontWeight: 600 }}>{data ? 'true' : 'false'}</span>;
    } else if (typeof data === 'number') {
      renderedVal = <span style={{ color: 'var(--warning)', fontWeight: 600 }}>{data}</span>;
    } else if (typeof data === 'string') {
      renderedVal = (
        <span style={{ color: 'var(--success)' }}>
          "<HighlightedText text={data} search={searchTerm} color="var(--success)" />"
        </span>
      );
    } else {
      renderedVal = <span>{String(data)}</span>;
    }

    return (
      <div className="json-line" style={{ paddingLeft: `${depth * 18}px`, lineHeight: '1.6' }}>
        {name && (
          <>
            <span className="json-key" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              "<HighlightedText text={name} search={searchTerm} color="var(--accent)" />"
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>: </span>
          </>
        )}
        {renderedVal}
      </div>
    );
  }

  const isArray = Array.isArray(data);
  const entries = Object.entries(data as Record<string, unknown>);
  const count = entries.length;

  if (count === 0) {
    return (
      <div className="json-line" style={{ paddingLeft: `${depth * 18}px`, lineHeight: '1.6' }}>
        {name && (
          <>
            <span className="json-key" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              "{name}"
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>: </span>
          </>
        )}
        <span style={{ color: 'var(--text-secondary)' }}>{isArray ? '[]' : '{}'}</span>
      </div>
    );
  }

  return (
    <div className="json-tree-node">
      <div
        className="json-header-line"
        onClick={() => setCollapsed(!collapsed)}
        style={{
          paddingLeft: `${depth * 18}px`,
          cursor: 'pointer',
          userSelect: 'none',
          lineHeight: '1.6',
        }}
      >
        <span style={{ display: 'inline-block', width: '14px', fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          {collapsed ? '▶' : '▼'}
        </span>
        {name && (
          <>
            <span className="json-key" style={{ color: 'var(--accent)', fontWeight: 500 }}>
              "<HighlightedText text={name} search={searchTerm} color="var(--accent)" />"
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>: </span>
          </>
        )}
        <span style={{ color: 'var(--text-secondary)' }}>{isArray ? '[' : '{'}</span>
        {collapsed && (
          <span className="text-secondary text-sm" style={{ fontStyle: 'italic', margin: '0 4px' }}>
            {count} {count === 1 ? 'item' : 'items'}
          </span>
        )}
        {collapsed && <span style={{ color: 'var(--text-secondary)' }}>{isArray ? ']' : '}'}</span>}
      </div>

      {!collapsed && (
        <div className="json-children">
          {entries.map(([key, val], idx) => (
            <React.Fragment key={key}>
              <JsonNode
                data={val}
                name={isArray ? undefined : key}
                searchTerm={searchTerm}
                depth={depth + 1}
              />
              {idx < count - 1 && <span style={{ display: 'none' }}>,</span>}
            </React.Fragment>
          ))}
        </div>
      )}

      {!collapsed && (
        <div style={{ paddingLeft: `${depth * 18}px`, color: 'var(--text-secondary)', lineHeight: '1.6' }}>
          {isArray ? ']' : '}'}
        </div>
      )}
    </div>
  );
};

const JsonViewer: React.FC<Props> = ({ data, title }) => {
  const [activeTab, setActiveTab] = useState<'formatted' | 'raw'>('formatted');
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);

  // Mask sensitive credentials before rendering
  const safeData = useMemo(() => maskSensitiveData(data), [data]);

  const rawString = useMemo(() => {
    if (data === undefined || data === null || data === '') {
      return '(empty response body)';
    }
    if (typeof data === 'string') {
      try {
        const parsed = JSON.parse(data);
        return JSON.stringify(maskSensitiveData(parsed), null, 2);
      } catch {
        return data;
      }
    }
    try {
      return JSON.stringify(safeData, null, 2);
    } catch {
      return String(data);
    }
  }, [data, safeData]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(rawString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isEmpty = data === undefined || data === null || data === '';
  const isString = typeof data === 'string' && !isEmpty;

  return (
    <div className="json-viewer-container">
      <div className="json-viewer-toolbar">
        <div className="json-viewer-header-left">
          {title && <span className="json-viewer-title">{title}</span>}
          <div className="tabs">
            <button
              type="button"
              className={`tab ${activeTab === 'formatted' ? 'active' : ''}`}
              onClick={() => setActiveTab('formatted')}
            >
              Formatted
            </button>
            <button
              type="button"
              className={`tab ${activeTab === 'raw' ? 'active' : ''}`}
              onClick={() => setActiveTab('raw')}
            >
              Raw
            </button>
          </div>
        </div>

        <div className="toolbar-actions">
          <input
            type="text"
            placeholder="Search / Filter..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="json-search-input"
          />
          <button type="button" onClick={copyToClipboard} className="copy-button">
            {copied ? '✓ Copied' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="json-content-area">
        {isEmpty ? (
          <div className="text-secondary" style={{ fontStyle: 'italic', padding: '0.5rem' }}>
            (empty response body)
          </div>
        ) : isString ? (
          <pre className="raw-content font-mono text-sm">
            <HighlightedText text={data as string} search={searchTerm} />
          </pre>
        ) : activeTab === 'formatted' ? (
          <div className="formatted-content font-mono text-sm">
            <JsonNode data={safeData} searchTerm={searchTerm} />
          </div>
        ) : (
          <pre className="raw-content font-mono text-sm">
            <HighlightedText text={rawString} search={searchTerm} />
          </pre>
        )}
      </div>
    </div>
  );
};

export default JsonViewer;

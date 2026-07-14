import { useEffect, useRef, useState } from 'react';
import { search, type SearchMatch } from '../api/client';

export function SearchPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!query.trim()) { setResults([]); setSearched(false); return; }

    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await search(query.trim());
        setResults(res);
        setSearched(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 400);

    return () => { if (debounce.current) clearTimeout(debounce.current); };
  }, [query]);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 16 }}>Search Vault</h1>

      <input
        className="input"
        style={{ fontSize: 15, padding: '10px 14px', marginBottom: 20 }}
        placeholder='Search decisions, context, architecture… e.g. "why gRPC" or "authentication"'
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoFocus
      />

      {loading && <p style={{ color: 'var(--text-2)', fontSize: 13 }}>Searching…</p>}

      {!loading && searched && results.length === 0 && (
        <p style={{ color: 'var(--text-2)', fontSize: 13 }}>No results for "{query}"</p>
      )}

      {results.length > 0 && (
        <div className="flex flex-col gap-3">
          <p style={{ fontSize: 12, color: 'var(--text-2)' }}>
            {results.length} file(s) matched
          </p>
          {results.map((match, i) => (
            <div key={i} className="card">
              <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)', marginBottom: 8, fontFamily: 'monospace' }}>
                {match.file}
              </p>
              <div className="flex flex-col gap-1">
                {match.lines.map((line, j) => (
                  <pre key={j} style={{
                    fontSize: 12,
                    color: 'var(--text-2)',
                    background: 'var(--surface-2)',
                    padding: '4px 8px',
                    borderRadius: 4,
                    whiteSpace: 'pre-wrap',
                    margin: 0,
                  }}>
                    {line}
                  </pre>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

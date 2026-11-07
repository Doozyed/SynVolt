import { fetchDisplayPage } from '../../../services/paginateScripts';
import { fetchRScripts } from '../../../services/rscriptsApi';
import { useState, useEffect, useRef } from 'react';
import { colors } from '../../../config/theme';
import { useAccentColor } from '../../../hooks/useAccentColor';
import {
  fetchScripts,
  searchScripts,
  getScriptDetails,
  Script,
  SortBy,
  SortOrder,
} from '../../../services/scriptbloxApi';
import { Search, Eye, Key, CheckCircle, Loader2, ChevronLeft, ChevronRight, Copy, Play, X, Globe, AlertTriangle, ChevronDown } from 'lucide-react';

interface ScriptHubProps {
  onExecuteScript: (script: string) => Promise<void>;
}

function ScriptAction({ label, successLabel, onAction, disabled, primary, accent }: {
  label: 'Copy' | 'Run'; successLabel: string; onAction: () => Promise<void>;
  disabled: boolean; primary?: boolean; accent: { primary: string; contrastText: string };
}) {
  const [phase, setPhase] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; window.clearTimeout(timer.current); }; }, []);
  const perform = async (event: React.MouseEvent) => {
    event.stopPropagation();
    if (phase === 'pending') return;
    window.clearTimeout(timer.current);
    setPhase('pending');
    try { await onAction(); if (!mounted.current) return; setPhase('success'); }
    catch { if (!mounted.current) return; setPhase('error'); }
    timer.current = window.setTimeout(() => setPhase('idle'), 1800);
  };
  const text = phase === 'pending' ? (label === 'Copy' ? 'Copying…' : 'Sending…') : phase === 'success' ? successLabel : phase === 'error' ? 'Failed' : label;
  return <button type="button" className="script-action-button" data-phase={phase} disabled={disabled || phase === 'pending'}
    title={disabled ? 'Script source unavailable' : phase === 'error' ? `${label} failed` : label} onClick={perform}
    style={{ background: primary ? accent.primary : 'var(--bg-raised)', color: primary ? accent.contrastText : colors.textWhite }}>
    {phase === 'pending' ? <Loader2 size={12} className="script-action-spinner" /> : phase === 'success' ? <CheckCircle size={12} /> : phase === 'error' ? <AlertTriangle size={12} /> : label === 'Copy' ? <Copy size={12} /> : <Play size={12} />}
    {text}
  </button>;
}

interface FilterState {
  verified: boolean | null;
  key: boolean | null;
  patched: boolean | null;
  universal: boolean | null;
  sortBy: SortBy;
  order: SortOrder;
}

function Dropdown({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((o) => o.value === value);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          padding: '6px 10px',
          background: 'var(--bg-surface)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          color: colors.textWhite,
          fontSize: 11,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          minWidth: 90,
        }}
      >
        <span style={{ flex: 1, textAlign: 'left' }}>{selectedOption?.label}</span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            marginTop: 4,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            overflow: 'hidden',
            zIndex: 100,
            minWidth: '100%',
            boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
          }}
        >
          {options.map((option) => (
            <div
              key={option.value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              style={{
                padding: '8px 12px',
                fontSize: 11,
                color: value === option.value ? colors.textWhite : colors.textMuted,
                background: value === option.value ? '#252530' : 'transparent',
                cursor: 'pointer',
                transition: 'background 0.1s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#252530')}
              onMouseLeave={(e) => (e.currentTarget.style.background = value === option.value ? '#252530' : 'transparent')}
            >
              {option.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  label,
  active,
  activeState,
  onClick,
  accent,
}: {
  label: string;
  active: boolean;
  activeState: boolean | null;
  onClick: () => void;
  accent: { primary: string; contrastText: string };
}) {
  const [hovered, setHovered] = useState(false);

  const getLabel = () => {
    if (activeState === true) return `✓ ${label}`;
    if (activeState === false) return `✗ ${label}`;
    return label;
  };

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '5px 10px',
        background: active ? accent.primary : hovered ? 'var(--bg-raised)' : 'transparent',
        border: '1px solid ' + (active ? accent.primary : 'var(--border)'),
        borderRadius: 5,
        color: active ? accent.contrastText : colors.textMuted,
        fontSize: 11,
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      {getLabel()}
    </button>
  );
}

function ScriptCard({
  script,
  accent,
  onCopy,
  onExecute,
  onOpen,
}: {
  script: Script;
  accent: { primary: string; contrastText: string };
  onCopy: (script: string) => Promise<void>;
  onExecute: (script: string) => Promise<void>;
  onOpen: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [imageError, setImageError] = useState(false);

  const imageUrl = script.image
    ? script.image.startsWith('http')
      ? script.image
      : `https://scriptblox.com${script.image}`
    : null;

  const gameImageUrl = script.game?.imageUrl
    ? script.game.imageUrl.startsWith('http')
      ? script.game.imageUrl
      : `https://scriptblox.com${script.game.imageUrl}`
    : null;

  const displayImage = !imageError && imageUrl ? imageUrl : (!imageError && gameImageUrl ? gameImageUrl : null);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`View details for ${script.title}`}
      onClick={onOpen}
      onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(); } }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg-panel)',
        borderRadius: 8,
        overflow: 'hidden',
        border: '1px solid var(--border-subtle)',
        transition: 'all 0.15s ease',
        cursor: 'pointer',
        transform: hovered ? 'translateY(-1px)' : 'none',
        boxShadow: hovered ? '0 4px 12px rgba(0,0,0,0.3)' : 'none',
      }}
    >
      <div
        style={{
          height: 110,
          background: displayImage ? 'transparent' : '#0a0a0e',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {displayImage ? (
          <img
            src={displayImage}
            alt={script.title}
            onError={() => setImageError(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#333',
            }}
          >
            <Globe size={28} strokeWidth={1.5} />
          </div>
        )}

        <div style={{ position: 'absolute', top: 6, right: 6, display: 'flex', gap: 3 }}>
          {script.verified && (
            <div style={{ background: 'rgba(0,0,0,0.6)', padding: '3px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
              <CheckCircle size={10} color="#4ADE80" />
            </div>
          )}
          {script.key && (
            <div style={{ background: 'rgba(0,0,0,0.6)', padding: '3px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
              <Key size={10} color="#FBBF24" />
            </div>
          )}
          {script.isPatched && (
            <div style={{ background: 'rgba(0,0,0,0.6)', padding: '3px 6px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 3 }}>
              <AlertTriangle size={10} color="#FF4D6A" />
            </div>
          )}
        </div>

        {hovered && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.75)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <ScriptAction label="Copy" successLabel="Copied" disabled={!script.script} accent={accent} onAction={() => onCopy(script.script)} />
            <ScriptAction label="Run" successLabel="Sent" disabled={!script.script} accent={accent} primary onAction={() => onExecute(script.script)} />
          </div>
        )}
      </div>

      <div style={{ padding: 10 }}>
        <h3
          style={{
            fontSize: 12,
            fontWeight: 600,
            color: colors.textWhite,
            marginBottom: 4,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {script.title}
        </h3>

        <p
          style={{
            fontSize: 10,
            color: colors.textMuted,
            marginBottom: 8,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {script.game?.name || (script.isUniversal ? 'Universal' : 'Unknown')}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <Eye size={10} color={colors.textMuted} />
          <span style={{ fontSize: 10, color: colors.textMuted }}>
            {script.views >= 1000 ? `${(script.views / 1000).toFixed(1)}K` : script.views}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ScriptHub({ onExecuteScript }: ScriptHubProps) {
  const accent = useAccentColor();
  const [source, setSource] = useState(() => localStorage.getItem('hub-source') === 'RScripts' ? 'RScripts' : 'ScriptBlox');
  const [sort, setSort] = useState('recommended');
  const [retry, setRetry] = useState(0);
  const [selectedScript, setSelectedScript] = useState<Script | null>(null);
  const [description, setDescription] = useState('');
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [detailsError, setDetailsError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [scripts, setScripts] = useState<Script[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [pageSize, setPageSize] = useState(32);
  const pageSizeRef = useRef(32);
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    let timer: number | undefined;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width <= 0 || height <= 0) return;
      const columns = Math.max(1, Math.floor((width + 12) / 192));
      const rows = Math.min(Math.max(1, Math.floor(384 / columns)), Math.max(Math.ceil(32 / columns), Math.ceil(height / 192)));
      const nextSize = columns * rows;
      window.clearTimeout(timer);
      if (nextSize === pageSizeRef.current) return;
      timer = window.setTimeout(() => {
        const oldSize = pageSizeRef.current;
        if (oldSize === nextSize) return;
        pageSizeRef.current = nextSize;
        setPage(previous => Math.floor(((previous - 1) * oldSize) / nextSize) + 1);
        setPageSize(nextSize);
      }, 180);
    });
    observer.observe(element);
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);
  const [filters, setFilters] = useState<FilterState>({
    verified: null,
    key: null,
    patched: null,
    universal: null,
    sortBy: 'updatedAt',
    order: 'desc',
  });
  useEffect(() => {
    if (!selectedScript) return;
    let active = true;
    setDescription(selectedScript.description || '');
    setDetailsError(false);
    if (source === 'RScripts') { setDetailsLoading(false); return; }
    setDetailsLoading(true);
    getScriptDetails(selectedScript.slug).then(result => {
      if (!active) return;
      setDescription(result.script.features || result.script.description || '');
      setSelectedScript(current => current?._id === selectedScript._id
        ? { ...current, script: result.script.script || current.script } : current);
    }).catch(() => { if (active) setDetailsError(true); })
      .finally(() => { if (active) setDetailsLoading(false); });
    return () => { active = false; };
  }, [selectedScript?._id, source]);

  useEffect(() => {
    if (!selectedScript) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelectedScript(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selectedScript]);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    async function load() {
      try {
        const q = searchQuery.trim();
        let result;
        if (source === 'RScripts') {
          result = await fetchRScripts(q, page, sort, pageSize);
        } else {
          const flag = (value: boolean | null) => value === null ? undefined : value ? 1 : 0;
          const params = { max: 20, verified: flag(filters.verified), key: flag(filters.key),
            patched: flag(filters.patched), universal: flag(filters.universal),
            sortBy: filters.sortBy, order: filters.order } as const;
          result = await fetchDisplayPage(page, async sourcePage => {
            const response = q ? await searchScripts({ ...params, page: sourcePage, q }) : await fetchScripts({ ...params, page: sourcePage });
            return response.result;
          }, 500, pageSize);
        }
        if (current) {
          setScripts(result.scripts);
          setTotalPages(result.totalPages);
        }
      } catch (err) {
        if (current) setError(err instanceof Error ? err.message : 'Failed to load scripts');
      } finally {
        if (current) setLoading(false);
      }
    }
    const timer = window.setTimeout(load, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [source, searchQuery, page, filters, retry, sort, pageSize]);

  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPage(1);
  };

  const toggleFilter = (key: keyof Omit<FilterState, 'sortBy' | 'order'>) => {
    setFilters((prev) => ({
      ...prev,
      [key]: prev[key] === null ? true : prev[key] === true ? false : null,
    }));
    setPage(1);
  };

  const handleCopyScript = async (script: string) => {
    await navigator.clipboard.writeText(script);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: colors.bgDark }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '8px 12px',
            background: 'var(--bg-panel)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
          }}
        >
          <Dropdown value={source} options={['ScriptBlox', 'RScripts'].map(value => ({ value, label: value }))}
            onChange={(value) => {
              setSource(value);
              setSelectedScript(null);
              localStorage.setItem('hub-source', value);
              setPage(1);
              setScripts([]);
            }}
          />
          <Search size={14} color={colors.textMuted} />
          <input
            type="text"
            placeholder="Search scripts..."
            value={searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: 12,
              color: colors.textWhite,
            }}
          />
          {searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: colors.textMuted,
                padding: 2,
                display: 'flex',
              }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {source === 'RScripts' ? (
            <Dropdown value={sort} options={[
                { value: 'recommended', label: 'Recommended' }, { value: 'newest', label: 'Newest' },
                { value: 'most-views', label: 'Most views' }, { value: 'most-likes', label: 'Most likes' },
              ]} onChange={(value) => { setSort(value); setPage(1); }} />
          ) : (<>
          <FilterChip
            label="Verified"
            active={filters.verified !== null}
            activeState={filters.verified}
            onClick={() => toggleFilter('verified')}
            accent={accent}
          />
          <FilterChip
            label="Key"
            active={filters.key !== null}
            activeState={filters.key}
            onClick={() => toggleFilter('key')}
            accent={accent}
          />
          <FilterChip
            label="Universal"
            active={filters.universal !== null}
            activeState={filters.universal}
            onClick={() => toggleFilter('universal')}
            accent={accent}
          />
          <FilterChip
            label="Patched"
            active={filters.patched !== null}
            activeState={filters.patched}
            onClick={() => toggleFilter('patched')}
            accent={accent}
          />

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <Dropdown
              value={filters.sortBy}
              options={[
                { value: 'updatedAt', label: 'Updated' },
                { value: 'createdAt', label: 'Created' },
                { value: 'views', label: 'Views' },
                { value: 'likeCount', label: 'Likes' },
              ]}
              onChange={(v) => setFilters((prev) => ({ ...prev, sortBy: v as SortBy }))}
            />
            <Dropdown
              value={filters.order}
              options={[
                { value: 'desc', label: 'Desc' },
                { value: 'asc', label: 'Asc' },
              ]}
              onChange={(v) => setFilters((prev) => ({ ...prev, order: v as SortOrder }))}
            />
          </div>
          </>)}
        </div>
      </div>

      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', scrollbarGutter: 'stable', padding: 16 }}>
        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
            <Loader2 size={24} color={accent.primary} style={{ animation: 'spin 1s linear infinite' }} />
            <span style={{ fontSize: 12, color: colors.textMuted }}>Loading...</span>
          </div>
        ) : error ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 12 }}>
            <AlertTriangle size={24} color={colors.error} />
            <span style={{ fontSize: 12, color: colors.error }}>{error}</span>
            <button
              onClick={() => setRetry(value => value + 1)}
              style={{
                padding: '6px 12px',
                background: accent.primary,
                border: 'none',
                borderRadius: 6,
                color: accent.contrastText,
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        ) : scripts.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8 }}>
            <Search size={32} color="#333" strokeWidth={1} />
            <span style={{ fontSize: 12, color: colors.textMuted }}>No scripts found</span>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
            }}
          >
            {scripts.map((script) => (
              <ScriptCard
                key={script._id}
                script={script}
                accent={accent}
                onCopy={handleCopyScript}
                onExecute={onExecuteScript}
                onOpen={() => setSelectedScript(script)}
              />
            ))}
          </div>
        )}
      </div>

      {!loading && !error && scripts.length > 0 && totalPages > 1 && (
        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            style={{
              padding: '6px 10px',
              background: page <= 1 ? 'var(--bg-panel)' : 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 5,
              color: page <= 1 ? '#333' : colors.textMuted,
              cursor: page <= 1 ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
            }}
          >
            <ChevronLeft size={14} />
          </button>

          <span style={{ fontSize: 11, color: colors.textMuted }}>
            {page} / {totalPages}
          </span>

          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            style={{
              padding: '6px 10px',
              background: page >= totalPages ? 'var(--bg-panel)' : 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 5,
              color: page >= totalPages ? '#333' : colors.textMuted,
              cursor: page >= totalPages ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
            }}
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {selectedScript && (
        <div className="motion-overlay" onClick={() => setSelectedScript(null)} style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: 'rgba(0,0,0,0.72)' }}>
          <div className="motion-dialog" role="dialog" aria-modal="true" aria-label={selectedScript.title} onClick={event => event.stopPropagation()}
            style={{ width: 'min(600px, 100%)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: colors.panelDark, border: `1px solid ${colors.border}`, borderRadius: 10, padding: 20, boxShadow: '0 16px 50px rgba(0,0,0,0.45)' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ color: colors.textWhite, fontSize: 18, overflowWrap: 'anywhere' }}>{selectedScript.title}</h2>
                <p style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>{selectedScript.game?.name || (selectedScript.isUniversal ? 'Universal' : 'Unknown game')} · {source}</p>
              </div>
              <button aria-label="Close details" onClick={() => setSelectedScript(null)} style={{ color: colors.textMuted, background: 'none', border: 0, cursor: 'pointer' }}><X size={18}/></button>
            </div>
            <div style={{ overflowY: 'auto', margin: '18px 0', minHeight: 70, color: colors.textWhite, fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {detailsLoading ? 'Loading description…' : description.trim() || (detailsError ? 'Could not load the description.' : 'No description provided.')}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <ScriptAction label="Copy" successLabel="Copied" disabled={!selectedScript.script} accent={accent} onAction={() => handleCopyScript(selectedScript.script)} />
              <ScriptAction label="Run" successLabel="Sent" disabled={!selectedScript.script} accent={accent} primary onAction={() => onExecuteScript(selectedScript.script)} />
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

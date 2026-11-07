import { useState, useEffect, useRef, useSyncExternalStore, useCallback } from 'react';
import { colors } from '../../config/theme';
import { getConsoleAccounts, getConsoleUsernameForPid, subscribeToConsoleLogs } from '../../stores/consoleStore';
import { getDiagnosticCounts, subscribeToDiagnostics, DiagnosticCounts } from '../../stores/diagnosticStore';
import {
  getAttachState,
  subscribeAttach,
  getProcesses,
  getSelectedPids,
  refreshProcesses,
  togglePid,
  selectAllPids,
  deselectAllPids,
  RobloxProcess,
} from '../../stores/attachStore';

function useAttachStore<T>(selector: () => T): T {
  return useSyncExternalStore(subscribeAttach, selector);
}

export function StatusBar() {
  const [connectionHovered, setConnectionHovered] = useState(false);
  const [statusHovered, setStatusHovered] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [counts, setCounts] = useState<DiagnosticCounts>({ errors: 0, warnings: 0, info: 0 });
  const dropdownRef = useRef<HTMLDivElement>(null);

  const attachState = useAttachStore(getAttachState);
  const processes = useAttachStore(getProcesses);
  const accounts = useSyncExternalStore(subscribeToConsoleLogs, getConsoleAccounts);
  const selectedPids = useAttachStore(getSelectedPids);
  const isAttached = attachState === 'attached';

  useEffect(() => {
    const updateCounts = () => setCounts(getDiagnosticCounts());
    updateCounts();
    return subscribeToDiagnostics(updateCounts);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleToggleDropdown = useCallback(() => {
    if (!dropdownOpen) refreshProcesses();
    setDropdownOpen(!dropdownOpen);
  }, [dropdownOpen]);

  const allSelected = processes.length > 0 && selectedPids.length === processes.length;
  const someSelected = selectedPids.length > 0 && selectedPids.length < processes.length;

  const getStatusLabel = () => {
    if (processes.length === 0) return 'No Instances';
    if (processes.length === 1 && getConsoleUsernameForPid(processes[0].pid)) return getConsoleUsernameForPid(processes[0].pid)!;
    if (selectedPids.length === 0) return `${processes.length} Instance${processes.length > 1 ? 's' : ''} (All)`;
    if (allSelected) return `${processes.length} Instance${processes.length > 1 ? 's' : ''} (All)`;
    return `${selectedPids.length}/${processes.length} Selected`;
  };

  return (
    <div
      style={{
        height: 24,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 12px',
        background: 'var(--bg-main)',
        borderTop: '1px solid var(--border-subtle)',
        fontSize: 11,
        color: colors.textMuted,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div
          onMouseEnter={() => setStatusHovered(true)}
          onMouseLeave={() => setStatusHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: statusHovered ? colors.textWhite : colors.textMuted,
            transition: 'color 0.1s ease',
            cursor: 'default',
          }}
        >
          <span>Runtime: {isAttached ? 'Ready' : 'Unavailable'}</span>
        </div>

        {(counts.errors > 0 || counts.warnings > 0) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {counts.errors > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: colors.error }}>
                <span style={{ fontSize: 10 }}>x</span>
                <span>{counts.errors}</span>
              </div>
            )}
            {counts.warnings > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#FFA726' }}>
                <span style={{ fontSize: 10 }}>!</span>
                <span>{counts.warnings}</span>
              </div>
            )}
          </div>
        )}
      </div>

      <div
        ref={dropdownRef}
        style={{ position: 'relative' }}
      >
        <div
          onClick={handleToggleDropdown}
          onMouseEnter={() => setConnectionHovered(true)}
          onMouseLeave={() => setConnectionHovered(false)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            color: connectionHovered ? colors.textWhite : colors.textMuted,
            transition: 'color 0.1s ease',
            cursor: 'pointer',
            userSelect: 'none',
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: processes.length > 0 ? colors.success : colors.error,
            }}
          />
          <span>{getStatusLabel()}</span>
          
        </div>

        {dropdownOpen && (
          <div className="motion-menu"
            style={{
              position: 'absolute',
              bottom: 28,
              right: 0,
              minWidth: 220,
              background: 'var(--bg-panel)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              zIndex: 1000,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 10, fontWeight: 600, color: colors.textMuted, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Roblox Instances
              </span>
              <div
                onClick={refreshProcesses}
                style={{
                  fontSize: 10,
                  color: colors.textMuted,
                  cursor: 'pointer',
                  padding: '2px 6px',
                  borderRadius: 4,
                  transition: 'all 0.1s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = colors.textWhite;
                  e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = colors.textMuted;
                  e.currentTarget.style.background = 'transparent';
                }}
              >
                Refresh
              </div>
            </div>

            {processes.length === 0 ? (
              <div
                style={{
                  padding: '14px 12px',
                  color: colors.textMuted,
                  fontSize: 11,
                  textAlign: 'center',
                }}
              >
                No Roblox instances found
              </div>
            ) : (
              <>
                <div
                  onClick={() => allSelected ? deselectAllPids() : selectAllPids()}
                  style={{
                    padding: '7px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    fontSize: 11,
                    color: colors.textMuted,
                    cursor: 'pointer',
                    borderBottom: '1px solid var(--border-subtle)',
                    transition: 'background 0.1s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--border-subtle)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                >
                  <div
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 3,
                      border: `1.5px solid ${allSelected || someSelected ? colors.success : '#444'}`,
                      background: allSelected ? colors.success : 'transparent',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.1s ease',
                      flexShrink: 0,
                    }}
                  >
                    {allSelected && (
                      <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                        <path d="M1 4L3 6L7 2" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {someSelected && (
                      <div style={{ width: 6, height: 1.5, background: colors.success, borderRadius: 1 }} />
                    )}
                  </div>
                  <span style={{ fontWeight: 500 }}>Select All ({processes.length})</span>
                </div>

                {processes.map((proc: RobloxProcess) => {
                  const isSelected = selectedPids.includes(proc.pid);
                  return (
                    <div
                      key={proc.pid}
                      onClick={() => togglePid(proc.pid)}
                      style={{
                        padding: '7px 12px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        fontSize: 11,
                        color: colors.textMuted,
                        cursor: 'pointer',
                        transition: 'background 0.1s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--border-subtle)')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <div
                        style={{
                          width: 14,
                          height: 14,
                          borderRadius: 3,
                          border: `1.5px solid ${isSelected ? colors.success : '#444'}`,
                          background: isSelected ? colors.success : 'transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.1s ease',
                          flexShrink: 0,
                        }}
                      >
                        {isSelected && (
                          <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                            <path d="M1 4L3 6L7 2" stroke="#000" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div
                        style={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          background: colors.success,
                          flexShrink: 0,
                        }}
                      />
                      <span>{getConsoleUsernameForPid(proc.pid) ? `${getConsoleUsernameForPid(proc.pid)} (PID ${proc.pid})` : proc.name}</span>
                    </div>
                  );
                })}

                {accounts.length > 0 && processes.length > 1 && <div style={{ padding: '7px 12px', borderTop: '1px solid var(--border-subtle)', color: colors.textMuted, fontSize: 10 }}>
                  Connected accounts: {accounts.join(', ')}
                </div>}
                <div
                  style={{
                    padding: '6px 12px',
                    borderTop: '1px solid var(--border-subtle)',
                    fontSize: 10,
                    color: colors.textMuted,
                    textAlign: 'center',
                    opacity: 0.7,
                  }}
                >
                  {selectedPids.length === 0
                    ? 'No selection = execute on all'
                    : `Executing on ${selectedPids.length} instance${selectedPids.length > 1 ? 's' : ''}`}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

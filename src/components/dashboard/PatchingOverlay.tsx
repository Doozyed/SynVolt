import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { Eye } from 'lucide-react';
import logo from '../../assets/icon.png';

export function PatchingOverlay() {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState('');
  const dialog = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (active) dialog.current?.focus();
  }, [active]);

  useEffect(() => {
    let mounted = true;
    const unlisteners: UnlistenFn[] = [];
    const start = () => {
      if (mounted) {
        setMessage('');
        setActive(true);
      }
    };
    const attach = (name: string, handler: () => void) => {
      void listen(name, handler).then(unlisten => {
        if (mounted) unlisteners.push(unlisten);
        else unlisten();
      }).catch(() => {});
    };

    window.addEventListener('synvolt-manual-patching-started', start);
    attach('synz-patching-started', start);
    attach('synz-reinstall-finished', () => {
      if (mounted) setActive(false);
    });

    return () => {
      mounted = false;
      window.removeEventListener('synvolt-manual-patching-started', start);
      unlisteners.forEach(unlisten => unlisten());
    };
  }, []);

  const showInstaller = async () => {
    try {
      const shown = await invoke<boolean>('show_synapse_launcher');
      if (shown) setActive(false);
      else setMessage('The SynZ window could not be shown yet.');
    } catch {
      setMessage('The SynZ window could not be shown yet.');
    }
  };

  const keepFocusInDialog = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (!buttons.length) {
      event.preventDefault();
      return;
    }
    if (index < 0 || (!event.shiftKey && index === buttons.length - 1) || (event.shiftKey && index === 0)) {
      event.preventDefault();
      buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
    }
  };

  if (!active) return null;

  return (
    <div
      ref={dialog}
      tabIndex={-1}
      className="patching-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="patching-title"
      aria-describedby="patching-description"
      onKeyDown={keepFocusInDialog}
    >
      <div className="patching-card">
        <div className="patching-emblem">
          <div className="patching-ring" aria-hidden="true" />
          <img src={logo} alt="" />
        </div>
        <div className="patching-label">SYNVOLT SETUP</div>
        <h1 id="patching-title">
          Patching Roblox
          <span className="patching-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
        </h1>
        <p id="patching-description">SynZ is in the background. Show SynZ to check when patching is complete.</p>
        <div className="patching-bar" aria-hidden="true"><div /></div>
        {message && <p className="patching-error" role="status">{message}</p>}
        <button type="button" className="patching-show" onClick={showInstaller}>
          <Eye size={14} /> Show SynZ
        </button>
        <button type="button" className="patching-show" onClick={() => setActive(false)}>
          Back to SynVolt
        </button>
      </div>
    </div>
  );
}

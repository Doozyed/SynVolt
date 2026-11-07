import { useEffect, useRef, useState } from 'react';
import { BookOpen, Cloud, FolderOpen, Play, Settings, ShieldAlert, Terminal } from 'lucide-react';

const STORAGE_KEY = 'synvolt-onboarding-v1';
const steps = [
  { title: 'Your script explorer', icon: FolderOpen, destination: 'workspace', target: '[data-tour="explorer"]', text: 'Create, open, and organize scripts and folders here. Use the star on a script to add it to Favorites on the home page.' },
  { title: 'Workspace shortcuts', icon: Play, destination: 'workspace', target: '[data-tour="workspace-actions"]', text: 'Start a new script, open a file, launch Roblox, or open the terminal and settings from these shortcuts. Open a script to edit and run it.' },
  { title: 'The console', icon: Terminal, destination: 'console', target: '[data-tour="console"]', text: 'Watch available script output here. You can choose where output goes in Settings and use the console controls to search or clear it.' },
  { title: 'Explore Script Hub', icon: Cloud, destination: 'hub', target: 'input[placeholder="Search scripts..."]', text: 'Search scripts here and choose a source. Select a script for more details, or use its buttons to copy or run it.' },
  { title: 'Make it yours', icon: Settings, destination: 'settings', target: '.settings-search', text: 'Search Settings to quickly find options for themes, the editor, output, and more. You can return to the workspace at any time.' },
];
type Box = { left: number; top: number; width: number; height: number };

export function FirstRunGuide() {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== 'complete'; } catch { return true; }
  });
  const [page, setPage] = useState(-1);
  const [started] = useState(() => Date.now());
  const [seconds, setSeconds] = useState(10);
  const [target, setTarget] = useState<Box | null>(null);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => { if (visible) dialog.current?.focus(); }, [visible]);
  useEffect(() => {
    if (!visible || page !== -1) return;
    const tick = () => setSeconds(Math.max(0, Math.ceil((10000 - (Date.now() - started)) / 1000)));
    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [visible, page, started]);
  useEffect(() => {
    if (!visible || page < 0) return;
    window.dispatchEvent(new CustomEvent('synvolt-guide-navigate', { detail: steps[page].destination }));
    const deadline = Date.now() + 1800;
    const update = () => {
      setViewport({ width: window.innerWidth, height: window.innerHeight });
      const rect = document.querySelector(steps[page].target)?.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        if (Date.now() >= deadline) setTarget(null);
        return;
      }
      setTarget(old => old && old.left === rect.left && old.top === rect.top && old.width === rect.width && old.height === rect.height ? old : { left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    };
    update();
    const timer = window.setInterval(update, 150);
    window.addEventListener('resize', update);
    return () => { window.clearInterval(timer); window.removeEventListener('resize', update); };
  }, [visible, page]);

  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, 'complete'); } catch { /* Show again next time if storage is unavailable. */ }
    if (page >= 0) window.dispatchEvent(new CustomEvent('synvolt-guide-navigate', { detail: 'workspace' }));
    setVisible(false);
  };
  if (!visible) return null;
  const step = steps[page];
  const Icon = step?.icon ?? ShieldAlert;
  const width = Math.min(360, viewport.width - 32);
  let bubble: React.CSSProperties | undefined;
  if (page >= 0 && target) {
    const gap = 18;
    const right = target.left + target.width + gap;
    const left = target.left - width - gap;
    const x = right + width <= viewport.width - 16 ? right : left >= 16 ? left : Math.max(16, Math.min(target.left, viewport.width - width - 16));
    const below = x !== right && x !== left;
    const y = below ? (target.top + target.height + 250 < viewport.height ? target.top + target.height + gap : target.top - 250 - gap) : target.top;
    bubble = { position: 'fixed', width, left: x, top: Math.max(16, Math.min(y, viewport.height - 255)), margin: 0 };
  }
  return <div className={`onboarding-overlay ${page >= 0 && target ? 'onboarding-tour-overlay' : ''}`}>
    {page >= 0 && target && <div className="onboarding-spotlight" aria-hidden="true" style={{ left: target.left - 6, top: target.top - 6, width: target.width + 12, height: target.height + 12 }} />}
    <section ref={dialog} tabIndex={-1} style={bubble} className={`onboarding-dialog ${page >= 0 ? 'onboarding-bubble' : ''}`} role="dialog" aria-modal="true" aria-labelledby="onboarding-title" aria-describedby="onboarding-description" onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      if (!buttons.length) { event.preventDefault(); return; }
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (current === -1 || (!event.shiftKey && current === buttons.length - 1) || (event.shiftKey && current === 0)) {
        event.preventDefault();
        buttons[event.shiftKey ? buttons.length - 1 : 0].focus();
      }
    }}>
      <div key={page} className="onboarding-step-content">
        <div className="onboarding-icon"><Icon size={22} strokeWidth={1.7} /></div>
        <div className="onboarding-eyebrow">{page < 0 ? 'PLEASE READ' : `GETTING STARTED · ${page + 1} OF ${steps.length}`}</div>
        <h1 id="onboarding-title">{step?.title ?? 'Before you begin'}</h1>
        <p id="onboarding-description">{step?.text ?? <>This app is a reskin of Synapse Z. You must still own a Synapse Z license for this application to work. The project is still new, so please expect bugs. If you have bug reports, please DM <strong>doozyed_d</strong> on Discord.</>}</p>
      </div>
      {page < 0 ? <>
        <div className="onboarding-reading" aria-live="polite">{seconds > 0 ? `Please take a moment to read · ${seconds}s` : 'You can continue when you are ready.'}</div>
        <div className="onboarding-actions"><button type="button" className="onboarding-primary" disabled={seconds > 0} onClick={() => setPage(0)}>Continue to walkthrough <BookOpen size={15} /></button></div>
      </> : <>
        <div className="onboarding-progress" aria-label={`Step ${page + 1} of ${steps.length}`}>{steps.map((item, index) => <span key={item.title} className={index === page ? 'active' : ''} />)}</div>
        <div className="onboarding-actions"><button type="button" className="onboarding-secondary" onClick={finish}>Skip</button><div>{page > 0 && <button type="button" className="onboarding-secondary" onClick={() => setPage(page - 1)}>Back</button>}<button type="button" className="onboarding-primary" onClick={() => page === steps.length - 1 ? finish() : setPage(page + 1)}>{page === steps.length - 1 ? 'Get started' : 'Next'}</button></div></div>
      </>}
    </section>
  </div>;
}

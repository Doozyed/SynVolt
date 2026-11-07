import { useState, useEffect } from 'react';
import { currentMonitor, getCurrentWindow, LogicalSize, PhysicalPosition } from '@tauri-apps/api/window';
import { Dashboard } from './components/dashboard/Dashboard';
import { FirstRunGuide } from './components/dashboard/FirstRunGuide';
import { loadQuickExecuteSettings } from './stores/quickExecuteStore';

import { check, type Update } from '@tauri-apps/plugin-updater';
import startupLogo from './assets/icon.png';
import { getInitialWindowSize } from './utils/windowSizing';
import './styles/globals.css';

type AppView = 'loading' | 'dashboard';

function App() {
  const [view, setView] = useState<AppView>('loading');
  const [update, setUpdate] = useState<Update | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');

  useEffect(() => {
    const initializeDashboard = async () => {
      const win = getCurrentWindow();
      try {
        const monitor = await currentMonitor().catch(() => null);
        const scale = monitor?.scaleFactor && monitor.scaleFactor > 0 ? monitor.scaleFactor : 1;
        const workWidth = monitor ? monitor.workArea.size.width / scale : window.screen.availWidth;
        const workHeight = monitor ? monitor.workArea.size.height / scale : window.screen.availHeight;
        const size = getInitialWindowSize(workWidth || 1339, workHeight || 828);
        await win.setMinSize(new LogicalSize(Math.min(600, size.width), Math.min(400, size.height)));
        await win.setSize(new LogicalSize(size.width, size.height));
        await win.setResizable(true);
        if (monitor) {
          const x = Math.round(monitor.workArea.position.x + (monitor.workArea.size.width - size.width * scale) / 2);
          const y = Math.round(monitor.workArea.position.y + (monitor.workArea.size.height - size.height * scale) / 2);
          await win.setPosition(new PhysicalPosition(x, y));
        } else {
          await win.center();
        }
      } catch (error) {
        console.error('Could not adjust window size:', error);
      } finally {
        await win.show().catch(() => {});
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) await new Promise(resolve => window.setTimeout(resolve, 1250));
        setView('dashboard');
      }
    };

    initializeDashboard();
  }, []);

  useEffect(() => {
    if (view === 'dashboard') {
      loadQuickExecuteSettings();
      void check({ timeout: 10000 }).then(setUpdate).catch(() => {});
    }
  }, [view]);

  if (view === 'dashboard') {
    return <>
      <Dashboard />
      <FirstRunGuide />
      {update && <div className="update-notice" role="status">
        <strong>SynVolt {update.version} is available</strong>
        <span>{updateError || 'Your scripts and settings will be kept.'}</span>
        <div><button disabled={updating} onClick={() => { setUpdating(true); setUpdateError(''); void update.downloadAndInstall().catch(error => { setUpdateError('Update failed: ' + String(error)); setUpdating(false); }); }}>{updating ? 'Installing…' : 'Install update'}</button>
        <button disabled={updating} onClick={() => setUpdate(null)}>Later</button></div>
      </div>}
    </>;
  }

  if (view === 'loading') {
    return <div className="synvolt-startup" role="status" aria-label="Starting SynVolt">
      <div className="startup-mark" aria-hidden="true">
        <div className="startup-slices">{Array.from({ length: 32 }, (_, index) => <img key={index} src={startupLogo} alt="" className="startup-slice" style={{ clipPath: `inset(${index * 100 / 32}% 0 ${(31 - index) * 100 / 32}% 0)`, animationDelay: `${-index * 27}ms` }} />)}</div>
        <img className="startup-still" src={startupLogo} alt="" />
      </div><span>SynVolt</span>
    </div>;
  }

  return <Dashboard />;
}

export default App;

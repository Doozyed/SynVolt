import { invoke } from '@tauri-apps/api/core';
import { useState, useCallback, useEffect, useSyncExternalStore, useRef, useMemo } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { colors } from '../../config/theme';
import { useKeybinds } from '../../hooks/useKeybinds';
import { Sidebar } from './Sidebar';
import { TabBar, Tab } from './TabBar';
import { WelcomePage } from './WelcomePage';
import { TerminalPanel } from './TerminalPanel';
import { StatusBar } from './StatusBar';
import { SplitContainer } from './SplitContainer';
import { DropZoneOverlay } from './DropZoneOverlay';
import { DragGhost } from './DragGhost';
import { SettingsPage } from './SettingsPage';
import { AccountPage } from './AccountPage';
import { ScriptHub } from './ScriptHub';
import { FloatingExecuteButton } from './FloatingExecuteButton';
import { QuickFilePicker } from './QuickFilePicker';
import { ClientManagerDialog } from './ClientManagerDialog';
import { FileViewer } from './FileViewer';
import { fileStore, initializeFileStore, type VirtualFile } from '../../stores/fileStore';
import { loadSettings, getSettings, subscribeToSettings, WorkbenchSettings, updateWorkbenchSetting } from '../../stores/settingsStore';
import { saveSession, loadSession } from '../../stores/sessionStore';
import { executeScript, getProcesses, refreshProcesses, subscribeAttach } from '../../stores/attachStore';
import { initializeConsoleListener } from '../../stores/consoleStore';
import { loadClientSettings } from '../../stores/clientSettingsStore';
import { transformScript, loadQolSettings } from '../../stores/qolStore';
import { loadClientManager } from '../../stores/clientManagerStore';
import {
  readWorkspaceFile,
  renameWorkspacePath,
  writeWorkspaceFile,
} from '../../stores/workspaceStore';
import {
  getStore,
  subscribe,
  startDrag,
  updateDragPosition,
  endDrag,
  setActiveTab,
  removeTabFromPane,
  addTabToPane,
  moveTabToPane,
  updateTabContent,
  setActivePaneId,
  getPane,
  reorderTabs,
  closeOtherTabs,
  closeTabsToLeft,
  closeTabsToRight,
  closeAllTabsInPane,
  getPanes,
  updatePane,
  renameTab,
  removeTabFromAllPanes,
  removeTabsMatching,
  initializeWithStartupAction,
  restoreSession,
  getSessionState,
  markTabClean,
  updateTabWidth,
  splitPane,
  DropZone,
  PaneTab,
  updateTabInAllPanes,
} from '../../stores/splitStore';
import { getFileExtension, getPaneTabKind, isTextFileExtension } from '../../utils/fileTypes';
import { getBaseName, getParentPath, joinPath, normalizeAbsolutePath, pathStartsWith } from '../../utils/filePaths';
import synapseIcon from '../../assets/icon.png';
import { Minus, Square, X, ChevronLeft, ChevronRight } from 'lucide-react';

const DEFAULT_WORKBENCH_SETTINGS: WorkbenchSettings = {
  startupAction: 'welcome',
  restoreTabs: false,
  floatingExecuteButton: false,
  showWorkspaceInSidebar: true,
  sidebarPosition: 'left',
  terminalPosition: 'bottom',
  sidebarWidth: 260,
  alwaysOnTop: false,
};

function getPathTabId(source: 'workspace' | 'external', path: string): string {
  return `${source}:${normalizeAbsolutePath(path).toLowerCase()}`;
}

function createScriptTab(file: VirtualFile): PaneTab {
  return {
    id: `file_${file.id}`,
    title: file.name,
    kind: 'code',
    source: 'scripts',
    fileId: file.id,
    path: file.relativePath,
    extension: file.extension,
    content: file.content,
    closable: true,
  };
}

function createPathTab(options: {
  id: string;
  title: string;
  source: 'workspace' | 'external' | 'generated';
  path?: string;
  extension: string | null;
  content?: string;
  readOnly?: boolean;
}): PaneTab {
  return {
    id: options.id,
    title: options.title,
    kind: getPaneTabKind(options.extension),
    source: options.source,
    path: options.path,
    extension: options.extension,
    content: options.content,
    readOnly: options.readOnly,
    closable: true,
    isDirty: false,
  };
}

function isRunnableTab(tab: PaneTab | undefined): tab is PaneTab {
  return Boolean(tab && (tab.kind === 'code' || (tab.kind === undefined && tab.content !== undefined)));
}

function isTextualTab(tab: PaneTab | undefined): tab is PaneTab {
  return Boolean(
    tab &&
      (
        tab.kind === 'code' ||
        tab.kind === 'text' ||
        tab.kind === 'json' ||
        (tab.kind === undefined && tab.content !== undefined)
      ),
  );
}

function canSaveTab(tab: PaneTab | undefined): boolean {
  return Boolean(tab && isTextualTab(tab) && !tab.readOnly && (tab.fileId || tab.path));
}

function ensureFileExtension(name: string, extension: string | null): string {
  if (!extension) {
    return name;
  }

  const normalizedExtension = extension.toLowerCase();
  return name.toLowerCase().endsWith(`.${normalizedExtension}`)
    ? name
    : `${name}.${normalizedExtension}`;
}

function updateTabsMatching(
  predicate: (tab: PaneTab) => boolean,
  updater: (tab: PaneTab) => PaneTab,
): void {
  for (const pane of getPanes()) {
    if (!pane.tabs.some(predicate)) {
      continue;
    }

    updatePane(pane.id, (currentPane) => {
      let nextActiveTabId = currentPane.activeTabId;
      const tabs = currentPane.tabs.map((tab) => {
        if (!predicate(tab)) {
          return tab;
        }

        const updatedTab = updater(tab);
        if (currentPane.activeTabId === tab.id) {
          nextActiveTabId = updatedTab.id;
        }
        return updatedTab;
      });

      return {
        ...currentPane,
        tabs,
        activeTabId: nextActiveTabId,
      };
    });
  }
}

interface WindowButtonProps {
  onClick: () => void;
  tooltip: string;
  children: React.ReactNode;
  isClose?: boolean;
}

function WindowButton({ onClick, tooltip, children, isClose }: WindowButtonProps) {
  const [hovered, setHovered] = useState(false);
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={onClick}
        aria-label={tooltip}
        onMouseEnter={() => {
          setHovered(true);
          setTimeout(() => setShowTooltip(true), 400);
        }}
        onMouseLeave={() => {
          setHovered(false);
          setShowTooltip(false);
        }}
        style={{
          width: 32,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          background: hovered ? (isClose ? '#FF4D6A' : 'var(--bg-surface)') : 'transparent',
          color: hovered && isClose ? '#FFF' : colors.textMuted,
          cursor: 'pointer',
          borderRadius: 6,
          transition: 'all 0.15s ease',
        }}
      >
        {children}
      </button>
      {showTooltip && hovered && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginTop: 6,
            padding: '4px 8px',
            background: 'var(--bg-surface)',
            color: colors.textWhite,
            fontSize: 11,
            borderRadius: 4,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            border: '1px solid var(--border-subtle)',
            zIndex: 1000,
          }}
        >
          {tooltip}
        </div>
      )}
    </div>
  );
}

function AnimatedPane({ transitionKey, children }: { transitionKey: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const animation = ref.current.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: 190, easing: 'ease-out',
    });
    return () => animation.cancel();
  }, [transitionKey]);
  return <div ref={ref} style={{ width: '100%', height: '100%', overflow: 'hidden' }}>{children}</div>;
}

export function Dashboard() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [isScreenFilled, setIsScreenFilled] = useState(false);
  const windowSurface = useRef<HTMLDivElement>(null);
  const fullscreenTransition = useRef(false);
  const store = useSyncExternalStore(subscribe, getStore);
  const [synapseHidden, setSynapseHidden] = useState(false);
  const [synapseChanging, setSynapseChanging] = useState(false);
  const synapseChangeInFlight = useRef(false);
  const synapseStateVersion = useRef(0);
  const [synapseInstalled, setSynapseInstalled] = useState<boolean | null>(null);
  const [launcherStatus, setLauncherStatus] = useState<'checking' | 'hidden' | 'running' | 'installing' | 'not_installed' | 'not_found' | 'failed'>('checking');
  const launcherStart = useRef<Promise<string> | null>(null);
  const robloxProcesses = useSyncExternalStore(subscribeAttach, getProcesses);
  const [activeView, setActiveView] = useState<'editor' | 'settings' | 'account'>('editor');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('synvolt-sidebar-collapsed') === 'true');
  const [sidebarResizing, setSidebarResizing] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(180);
  const [workbenchSettings, setWorkbenchSettings] = useState<WorkbenchSettings>(DEFAULT_WORKBENCH_SETTINGS);
  const [quickFilePickerOpen, setQuickFilePickerOpen] = useState(false);
  const [clientManagerOpen, setClientManagerOpen] = useState(false);
  const initializedRef = useRef(false);
  const restoreTabsRef = useRef(false);

  useEffect(() => {
    let active = true;
    let sequence = 0;
    let unlisten: (() => void) | undefined;
    const updateWindowState = async () => {
      const current = ++sequence;
      try {
        const [maximized, fullscreen] = await Promise.all([appWindow.isMaximized(), appWindow.isFullscreen()]);
        if (active && current === sequence) setIsScreenFilled(maximized || fullscreen);
      } catch { /* Keep the current appearance if the window is closing. */ }
    };
    void updateWindowState();
    void appWindow.onResized(updateWindowState).then(stop => {
      if (active) unlisten = stop;
      else stop();
    }).catch(() => {});
    return () => { active = false; unlisten?.(); };
  }, [appWindow]);

  useEffect(() => {
    let active = true;
    const check = () => {
      void invoke<boolean>('is_synapse_installed')
        .then(installed => { if (active) setSynapseInstalled(installed); })
        .catch(() => { if (active) setSynapseInstalled(null); });
    };
    check();
    const interval = window.setInterval(check, 30000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    let active = true;
    if (!launcherStart.current) launcherStart.current = invoke<string>('start_synapse_launcher');
    void launcherStart.current.then(status => {
      if (!active) return;
      if (status === 'hidden' || status === 'running' || status === 'installing' || status === 'not_installed' || status === 'not_found') {
        setLauncherStatus(status);
        setSynapseHidden(status === 'hidden');
      } else setLauncherStatus('failed');
    }).catch(() => { if (active) setLauncherStatus('failed'); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    void refreshProcesses();
    const interval = window.setInterval(refreshProcesses, 3000);
    return () => window.clearInterval(interval);
  }, []);

  const toggleSynapseWindow = useCallback(async () => {
    if (synapseChangeInFlight.current) return;
    synapseChangeInFlight.current = true;
    synapseStateVersion.current++;
    setSynapseChanging(true);
    try {
      const current = await invoke<string>('get_synapse_launcher_state');
      if (current === 'hidden') {
        const shown = await invoke<boolean>('show_synapse_launcher');
        setSynapseHidden(!shown);
        if (!shown) window.alert('Could not show the Synapse Z launcher. It may still be starting or require administrator permissions.');
      } else {
        const hidden = await invoke<boolean>('hide_synapse_launcher');
        setSynapseHidden(hidden);
        if (!hidden) window.alert('Could not hide the Synapse Z launcher. Make sure it is open and finished starting.');
      }
    } catch (error) {
      window.alert(String(error));
    } finally {
      synapseStateVersion.current++;
      synapseChangeInFlight.current = false;
      setSynapseChanging(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (synapseChangeInFlight.current) return;
      const version = synapseStateVersion.current;
      try {
        const current = await invoke<string>('get_synapse_launcher_state');
        if (active && !synapseChangeInFlight.current && version === synapseStateVersion.current) setSynapseHidden(current === 'hidden');
      } catch { /* The launcher can disappear while it is restarting. */ }
    };
    void refresh();
    const interval = window.setInterval(refresh, 2000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    loadQolSettings();
    loadClientManager();
    initializeConsoleListener();
    loadClientSettings();

    loadSettings().then(async () => {
      const settings = getSettings();
      const action = settings.workbench.startupAction;
      restoreTabsRef.current = settings.workbench.restoreTabs;
      setWorkbenchSettings(settings.workbench);

      if (settings.workbench.alwaysOnTop) {
        appWindow.setAlwaysOnTop(true);
      }

      if (settings.workbench.restoreTabs) {
        const session = await loadSession();
        if (session && session.tabs.length > 0) {
          restoreSession(session.tabs, session.activeTabId);
          return;
        }
      }

      if (action === 'new') {
        await initializeFileStore();
        let name = 'script.lua';
        for (let n = 2; fileStore.getFileByRelativePath(name); n++) name = `script${n}.lua`;
        const file = await fileStore.createFile(name, '-- New Script\n');
        initializeWithStartupAction('none');
        addTabToPane('main', createScriptTab(file));
      } else {
        initializeWithStartupAction(action);
      }
    });
  }, []);

  useEffect(() => {
    const unsubscribeSettings = subscribeToSettings(() => {
      const settings = getSettings();
      restoreTabsRef.current = settings.workbench.restoreTabs;
      setWorkbenchSettings(settings.workbench);
    });
    return unsubscribeSettings;
  }, []);

  useEffect(() => {
    if (!restoreTabsRef.current) return;
    const { tabs, activeTabId } = getSessionState();
    if (tabs.length > 0) {
      saveSession(tabs, activeTabId);
    }
  }, [store.root]);

  const handleMinimize = () => appWindow.minimize();
  const handleMaximize = async () => {
    if (fullscreenTransition.current) return;
    fullscreenTransition.current = true;
    const surface = windowSurface.current;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let fade: Animation | undefined;
    try {
      if (surface && !reduced) {
        fade = surface.animate([{ opacity: 1 }, { opacity: .35 }], { duration: 110, easing: 'ease-in', fill: 'forwards' });
        await fade.finished.catch(() => {});
      }
      const wasFullscreen = await appWindow.isFullscreen();
      await appWindow.setFullscreen(!wasFullscreen);
      setIsScreenFilled(!wasFullscreen || await appWindow.isMaximized());
    } catch (error) {
      console.error('Could not change fullscreen mode:', error);
    } finally {
      fade?.cancel();
      if (surface && !reduced) surface.animate([{ opacity: .35 }, { opacity: 1 }], { duration: 210, easing: 'ease-out' });
      fullscreenTransition.current = false;
    }
  };
  const handleClose = () => appWindow.close();

  const handleBackToEditor = () => setActiveView('editor');

  const handleScriptHubExecute = useCallback(async (script: string) => {
    if (!script.trim()) return;
    await executeScript(transformScript(script));
  }, []);

  const handleScriptHubOpen = useCallback(() => {
    const tabId = 'scripthub';
    const newTab: PaneTab = {
      id: tabId,
      title: 'Script Hub',
      kind: 'page',
      source: 'page',
      closable: true,
    };
    addTabToPane(store.activePaneId, newTab);
  }, [store.activePaneId]);

  useEffect(() => {
    const navigate = (event: Event) => {
      const destination = (event as CustomEvent<string>).detail;
      setSidebarCollapsed(false);
      if (destination === 'settings') { setActiveView('settings'); return; }
      setActiveView('editor');
      if (destination === 'hub') handleScriptHubOpen();
      else {
        addTabToPane(store.activePaneId, { id: 'welcome', title: 'Workspace', kind: 'page', source: 'page', closable: true });
        if (destination === 'console') setTerminalOpen(true);
      }
    };
    window.addEventListener('synvolt-guide-navigate', navigate);
    return () => window.removeEventListener('synvolt-guide-navigate', navigate);
  }, [handleScriptHubOpen, store.activePaneId]);

  const handleLaunchRoblox = useCallback(async () => {
    try {
      await invoke('launch_roblox');
    } catch (error) {
      window.alert(`Could not launch Roblox: ${String(error)}`);
    }
  }, []);

  const handleDragStart = useCallback(
    (paneId: string, tabId: string, tabTitle: string, x: number, y: number) => {
      startDrag(paneId, tabId, tabTitle, x, y);
    },
    []
  );

  useEffect(() => {
    if (!store.dragState.isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      updateDragPosition(e.clientX, e.clientY);
    };

    const handleMouseUp = () => {
      endDrag();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'grabbing';
    document.body.style.userSelect = 'none';

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [store.dragState.isDragging]);

  const handleDrop = useCallback(
    (targetPaneId: string) => (zone: DropZone) => {
      const { sourcePane, tabId } = store.dragState;
      if (!sourcePane || !tabId) return;
      moveTabToPane(sourcePane, tabId, targetPaneId, zone);
      endDrag();
    },
    [store.dragState]
  );

  const openFileInPane = useCallback((fileId: string) => {
    const file = fileStore.getFile(fileId);
    if (!file) {
      return;
    }

    addTabToPane(store.activePaneId, createScriptTab(file));
  }, [store.activePaneId]);

  const openWorkspaceFileInPane = useCallback(async (
    path: string,
    fileName: string,
    extension: string | null,
  ) => {
    const normalizedPath = normalizeAbsolutePath(path);
    const isTextFile = isTextFileExtension(extension);
    const content = isTextFile ? await readWorkspaceFile(normalizedPath) : undefined;

    addTabToPane(
      store.activePaneId,
      createPathTab({
        id: getPathTabId('workspace', normalizedPath),
        title: fileName,
        source: 'workspace',
        path: normalizedPath,
        extension,
        content,
        readOnly: !isTextFile,
      }),
    );
  }, [store.activePaneId]);

  const openExternalPathInPane = useCallback(async (filePath: string, autoExecution = false) => {
    const normalizedPath = normalizeAbsolutePath(filePath);
    const fileName = getBaseName(normalizedPath) || 'untitled';
    const extension = getFileExtension(fileName);
    const isTextFile = isTextFileExtension(extension);
    const content = isTextFile ? await readTextFile(normalizedPath) : undefined;

    addTabToPane(
      store.activePaneId,
      { autoExecution, ...createPathTab({
        id: getPathTabId('external', normalizedPath),
        title: fileName,
        source: 'external',
        path: normalizedPath,
        extension,
        content,
        readOnly: !isTextFile,
      }) },
    );
  }, [store.activePaneId]);

  const handleContentChange = useCallback(
    (paneId: string, tabId: string) => (newContent: string) => {
      updateTabContent(paneId, tabId, newContent, true);
    },
    []
  );

  const handleScriptPathDelete = useCallback((relativePath: string, isDir: boolean) => {
    if (isDir) {
      removeTabsMatching((tab) =>
        tab.source === 'scripts' &&
        Boolean(tab.path) &&
        pathStartsWith(tab.path!, relativePath),
      );
      return;
    }

    const file = fileStore.getFileByRelativePath(relativePath);
    if (file) {
      removeTabFromAllPanes(`file_${file.id}`);
    } else {
      removeTabsMatching((tab) => tab.source === 'scripts' && tab.path === relativePath);
    }
  }, []);

  const syncScriptTabsFromStore = useCallback((matcher?: (file: VirtualFile) => boolean) => {
    for (const file of fileStore.getAllFiles()) {
      if (matcher && !matcher(file)) {
        continue;
      }

      updateTabInAllPanes(`file_${file.id}`, (tab) => ({
        ...tab,
        title: file.name,
        path: file.relativePath,
        extension: file.extension,
        content: tab.isDirty ? tab.content : file.content,
      }));
    }
  }, []);

  const handleScriptFileRename = useCallback((file: VirtualFile, oldRelativePath: string) => {
    syncScriptTabsFromStore((candidate) => candidate.id === file.id);

    if (oldRelativePath !== file.relativePath) {
      removeTabsMatching((tab) =>
        tab.source === 'scripts' &&
        tab.id !== `file_${file.id}` &&
        tab.path === oldRelativePath,
      );
    }
  }, [syncScriptTabsFromStore]);

  const handleScriptDirectoryRename = useCallback((oldPath: string, newPath: string) => {
    syncScriptTabsFromStore((file) => pathStartsWith(file.relativePath, newPath));

    removeTabsMatching((tab) =>
      tab.source === 'scripts' &&
      Boolean(tab.path) &&
      pathStartsWith(tab.path!, oldPath) &&
      !fileStore.getAllFiles().some((file) => `file_${file.id}` === tab.id),
    );
  }, [syncScriptTabsFromStore]);

  const handleWorkspacePathDelete = useCallback((path: string, isDir: boolean) => {
    const normalizedPath = normalizeAbsolutePath(path);
    removeTabsMatching((tab) => {
      if (tab.source !== 'workspace' || !tab.path) {
        return false;
      }

      return isDir ? pathStartsWith(tab.path, normalizedPath) : tab.path === normalizedPath;
    });
  }, []);

  const handleWorkspaceFileRename = useCallback((oldPath: string, newPath: string) => {
    updateTabsMatching(
      (tab) => tab.source === 'workspace' && tab.path === oldPath,
      (tab) => ({
        ...tab,
        id: getPathTabId('workspace', newPath),
        title: getBaseName(newPath),
        path: newPath,
        extension: getFileExtension(newPath),
      }),
    );
  }, []);

  const handleWorkspaceDirectoryRename = useCallback((oldPath: string, newPath: string) => {
    updateTabsMatching(
      (tab) =>
        tab.source === 'workspace' &&
        Boolean(tab.path) &&
        pathStartsWith(tab.path!, oldPath),
      (tab) => {
        const nextPath = tab.path!.replace(oldPath, newPath);
        return {
          ...tab,
          id: getPathTabId('workspace', nextPath),
          title: getBaseName(nextPath),
          path: nextPath,
          extension: getFileExtension(nextPath),
        };
      },
    );
  }, []);

  const handleSidebarMutation = useCallback((mutation: import('./Sidebar').SidebarMutation) => {
    switch (mutation.type) {
      case 'library-moved': {
        const { move, newPath } = mutation;
        const file = fileStore.getAllFiles().find(item => item.filePath.toLowerCase() === newPath.toLowerCase());
        updateTabsMatching(
          tab => move.from === 'scripts' ? tab.source === 'scripts' && tab.path === move.relative
            : tab.source === 'external' && tab.path?.toLowerCase() === move.oldPath.toLowerCase(),
          tab => file && move.to === 'scripts'
            ? { ...tab, ...createScriptTab(file), content: tab.content, isDirty: tab.isDirty, autoExecution: false }
            : { ...tab, id: getPathTabId('external', newPath), fileId: undefined, source: 'external', path: newPath, autoExecution: true },
        );
        break;
      }
      case 'script-file-renamed':
        handleScriptFileRename(mutation.file, mutation.oldPath);
        break;
      case 'script-path-removed':
        handleScriptPathDelete(mutation.path, mutation.isDir);
        break;
      case 'script-directory-renamed':
        handleScriptDirectoryRename(mutation.oldPath, mutation.newPath);
        break;
      case 'workspace-file-renamed':
        handleWorkspaceFileRename(mutation.oldPath, mutation.newPath);
        break;
      case 'workspace-path-removed':
        handleWorkspacePathDelete(mutation.path, mutation.isDir);
        break;
      case 'workspace-directory-renamed':
        handleWorkspaceDirectoryRename(mutation.oldPath, mutation.newPath);
        break;
    }
  }, [
    handleScriptDirectoryRename,
    handleScriptFileRename,
    handleScriptPathDelete,
    handleWorkspaceDirectoryRename,
    handleWorkspaceFileRename,
    handleWorkspacePathDelete,
  ]);

  const handleTabsReorder = useCallback((paneId: string) => (tabs: Tab[]) => {
    const paneTabs: PaneTab[] = tabs.map((t) => {
      const pane = getPane(paneId);
      const existingTab = pane?.tabs.find((pt) => pt.id === t.id);
      return existingTab || { id: t.id, title: t.title, closable: t.closable };
    });
    reorderTabs(paneId, paneTabs);
  }, []);

  const handleCloseOthers = useCallback((paneId: string) => (tabId: string) => {
    closeOtherTabs(paneId, tabId);
  }, []);

  const handleCloseToLeft = useCallback((paneId: string) => (tabId: string) => {
    closeTabsToLeft(paneId, tabId);
  }, []);

  const handleCloseToRight = useCallback((paneId: string) => (tabId: string) => {
    closeTabsToRight(paneId, tabId);
  }, []);

  const handleCloseAll = useCallback((paneId: string) => () => {
    closeAllTabsInPane(paneId);
  }, []);

  const handleTabRename = useCallback((paneId: string) => async (tabId: string, newTitle: string) => {
    const pane = getPane(paneId);
    if (!pane) return;

    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    if (tab.source === 'scripts' && tab.fileId) {
      const finalName = ensureFileExtension(newTitle, tab.extension || 'lua');
      const currentDirectory = getParentPath(tab.path || '');
      const relativeTargetPath = joinPath(currentDirectory, finalName);
      const existingFile = fileStore.getFileByRelativePath(relativeTargetPath);
      if (existingFile && existingFile.id !== tab.fileId) {
        return;
      }

      const oldRelativePath = tab.path || '';
      const renamedFile = await fileStore.renameFile(tab.fileId, finalName);
      handleScriptFileRename(renamedFile, oldRelativePath);
      return;
    }

    if (tab.source === 'workspace' && tab.path) {
      const finalName = ensureFileExtension(newTitle, tab.extension || getFileExtension(tab.path));
      const { oldPath, newPath } = await renameWorkspacePath(tab.path, finalName);
      handleWorkspaceFileRename(oldPath, newPath);
      return;
    }

    renameTab(paneId, tabId, newTitle);
  }, [handleScriptFileRename, handleWorkspaceFileRename]);

  const handleTabWidthChange = useCallback((paneId: string) => (tabId: string, width: number) => {
    updateTabWidth(paneId, tabId, width);
  }, []);

  const handleNewTab = useCallback((paneId: string) => async () => {
    const baseName = 'script';
    let counter = 1;
    let newName = `${baseName}.lua`;

    while (fileStore.getFileByRelativePath(newName)) {
      counter++;
      newName = `${baseName}${counter}.lua`;
    }

    const file = await fileStore.createFile(newName, '-- New Script\n');
    addTabToPane(paneId, createScriptTab(file));
  }, []);

  const savePaneTab = useCallback(async (paneId: string, tab?: PaneTab) => {
    if (!tab || !canSaveTab(tab)) {
      return;
    }

    const content = tab.content || '';

    if (tab.fileId) {
      await initializeFileStore();
      const file = fileStore.getFile(tab.fileId) ??
        (tab.path ? fileStore.getFileByRelativePath(tab.path) : undefined);
      if (!file) throw new Error(`Cannot find script ${tab.path || tab.title}`);
      await fileStore.updateFile(file.id, content);
    } else if (tab.source === 'workspace' && tab.path) {
      await writeWorkspaceFile(tab.path, content);
    } else if (tab.source === 'external' && tab.path) {
      await writeTextFile(tab.path, content);
    }

    if (getPane(paneId)?.tabs.find((item) => item.id === tab.id)?.content === tab.content) {
      markTabClean(paneId, tab.id);
    }
  }, []);

  useEffect(() => {
    let closing = false;
    const listener = getCurrentWindow().onCloseRequested(async (event) => {
      if (closing) {
        event.preventDefault();
        return;
      }
      closing = true;
      try {
        while (true) {
          const pending = getPanes().flatMap((pane) => pane.tabs
            .filter((tab) => (tab.source === 'scripts' || tab.autoExecution) && tab.isDirty && canSaveTab(tab))
            .map((tab) => ({ paneId: pane.id, tab })));
          if (!pending.length) break;
          for (const { paneId, tab } of pending) await savePaneTab(paneId, tab);
        }
      } catch (error) {
        event.preventDefault();
        closing = false;
        window.alert(`Could not save your script. The window will stay open.\n${error}`);
      }
    });
    return () => { void listener.then((unlisten) => unlisten()); };
  }, [savePaneTab]);

  const handleSaveTab = useCallback((paneId: string) => async () => {
    const pane = getPane(paneId);
    if (!pane) return;
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    await savePaneTab(paneId, tab);
  }, [savePaneTab]);

  const handleSeparateTab = useCallback((paneId: string) => (tabId: string) => {
    const pane = getPane(paneId);
    if (!pane) return;
    const tab = pane.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    removeTabFromPane(paneId, tabId);
    splitPane(paneId, 'right', tab);
  }, []);

  const handleRevealInExplorer = useCallback((fileId: string) => {
    fileStore.revealInExplorer(fileId);
  }, []);

  const handleNewTempTab = useCallback((paneId: string) => () => {
    const tabId = `temp_${Date.now()}`;
    const newTab: PaneTab = {
      id: tabId,
      title: 'Untitled',
      kind: 'code',
      source: 'generated',
      extension: 'lua',
      content: '',
      closable: true,
    };
    addTabToPane(paneId, newTab);
  }, []);

  const handleDuplicateTab = useCallback((paneId: string) => async () => {
    const pane = getPane(paneId);
    if (!pane) return;
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    if (!tab?.fileId || tab.source !== 'scripts') return;

    const originalFile = fileStore.getFile(tab.fileId);
    if (!originalFile) return;

    const scriptDirectory = getParentPath(originalFile.relativePath);
    const baseName = originalFile.name.replace(/\.(lua|luau)$/, '');
    let counter = 1;
    let newName = `${baseName}_copy.lua`;

    while (fileStore.getFileByRelativePath(joinPath(scriptDirectory, newName))) {
      counter++;
      newName = `${baseName}_copy${counter}.lua`;
    }

    const newFile = await fileStore.createFile(newName, originalFile.content, scriptDirectory);
    addTabToPane(paneId, createScriptTab(newFile));
  }, []);

  const handleExecuteScript = useCallback((paneId: string) => async () => {
    const pane = getPane(paneId);
    if (!pane) return;
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    if (!isRunnableTab(tab)) return;
    const content = tab.content || '';
    if (!content.trim()) return;
    await executeScript(transformScript(content));
  }, []);

  const handleFloatingExecute = useCallback(async () => {
    const pane = getPane(store.activePaneId);
    if (!pane) return;
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    if (!isRunnableTab(tab)) return;
    const content = tab.content || '';
    if (!content.trim()) return;
    await executeScript(transformScript(content));
  }, [store.activePaneId]);

  const handleKeybindNewScript = useCallback(async () => {
    const baseName = 'script';
    let counter = 1;
    let newName = `${baseName}.lua`;
    while (fileStore.getFileByRelativePath(newName)) {
      counter++;
      newName = `${baseName}${counter}.lua`;
    }
    const file = await fileStore.createFile(newName, '-- New Script\n');
    addTabToPane(store.activePaneId, createScriptTab(file));
  }, [store.activePaneId]);

  const handleKeybindSaveScript = useCallback(async () => {
    const pane = getPane(store.activePaneId);
    if (!pane) return;
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    if (tab?.isDirty) {
      await savePaneTab(store.activePaneId, tab);
    }
  }, [savePaneTab, store.activePaneId]);

  const handleKeybindCloseTab = useCallback(() => {
    const pane = getPane(store.activePaneId);
    if (!pane || !pane.activeTabId) return;
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    if (tab?.closable !== false) {
      const event = new CustomEvent('synvolt-animate-close-tab', {
        cancelable: true, detail: { paneId: store.activePaneId, tabId: pane.activeTabId },
      });
      if (window.dispatchEvent(event)) removeTabFromPane(store.activePaneId, pane.activeTabId);
    }
  }, [store.activePaneId]);

  const handleKeybindExecuteScript = useCallback(async () => {
    const pane = getPane(store.activePaneId);
    if (!pane) return;
    const tab = pane.tabs.find((t) => t.id === pane.activeTabId);
    if (!isRunnableTab(tab)) return;
    const content = tab.content || '';
    if (!content.trim()) return;
    await executeScript(transformScript(content));
  }, [store.activePaneId]);

  const handleKeybindToggleTerminal = useCallback(() => {
    setTerminalOpen((prev) => !prev);
  }, []);

  const handleKeybindOpenSettings = useCallback(() => {
    setActiveView('settings');
  }, []);

  const handleKeybindQuickFilePicker = useCallback(() => {
    setQuickFilePickerOpen(true);
  }, []);

  const handleKeybindOpenFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [
        { name: 'Lua Scripts', extensions: ['lua', 'luau'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    if (!selected) return;

    const filePath = typeof selected === 'string' ? selected : selected;
    await openExternalPathInPane(filePath);
  }, [openExternalPathInPane]);

  const keybindHandlers = useMemo(
    () => ({
      onNewScript: handleKeybindNewScript,
      onOpenFile: handleKeybindOpenFile,
      onSaveScript: handleKeybindSaveScript,
      onCloseTab: handleKeybindCloseTab,
      onExecuteScript: handleKeybindExecuteScript,
      onToggleTerminal: handleKeybindToggleTerminal,
      onOpenSettings: handleKeybindOpenSettings,
      onQuickFilePicker: handleKeybindQuickFilePicker,
    }),
    [
      handleKeybindNewScript,
      handleKeybindOpenFile,
      handleKeybindSaveScript,
      handleKeybindCloseTab,
      handleKeybindExecuteScript,
      handleKeybindToggleTerminal,
      handleKeybindOpenSettings,
      handleKeybindQuickFilePicker,
    ]
  );

  useKeybinds(keybindHandlers, activeView === 'editor');

  const renderPaneContent = useCallback(
    (paneId: string) => {
      const pane = getPane(paneId);
      if (!pane) return null;

      const activeTab = pane.tabs.find((t) => t.id === pane.activeTabId);
      const isPaneActive = store.activePaneId === paneId;
      const showRunButton = isRunnableTab(activeTab);
      const allowSave = canSaveTab(activeTab);
      const allowDuplicate = activeTab?.source === 'scripts' && Boolean(activeTab.fileId);

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: '100%',
            height: '100%',
            overflow: 'hidden',
            position: 'relative',
          boxShadow: isPaneActive ? 'inset 0 0 0 1px rgba(255,255,255,0.06)' : 'none',
          borderRadius: 4,
          transition: 'box-shadow 0.15s ease',
          }}
          onClick={() => setActivePaneId(paneId)}
        >
          <TabBar
            tabs={pane.tabs}
            activeTabId={pane.activeTabId}
            onTabClick={(tabId) => setActiveTab(paneId, tabId)}
            onTabClose={(tabId) => removeTabFromPane(paneId, tabId)}
            onRunClick={handleExecuteScript(paneId)}
            onLaunchRoblox={handleLaunchRoblox}
            showRunButton={showRunButton}
            hideRunButton={workbenchSettings.floatingExecuteButton}
            paneId={paneId}
            onDragStart={handleDragStart}
            draggingTabId={store.dragState.sourcePane === paneId ? store.dragState.tabId : null}
            isActive={isPaneActive}
            onTabsReorder={handleTabsReorder(paneId)}
            onCloseOthers={handleCloseOthers(paneId)}
            onCloseToLeft={handleCloseToLeft(paneId)}
            onCloseToRight={handleCloseToRight(paneId)}
            onCloseAll={handleCloseAll(paneId)}
            onTabRename={handleTabRename(paneId)}
            onSaveTab={allowSave ? handleSaveTab(paneId) : undefined}
            onNewTab={handleNewTab(paneId)}
            onDuplicateTab={allowDuplicate ? handleDuplicateTab(paneId) : undefined}
            onTabWidthChange={handleTabWidthChange(paneId)}
            onNewTempTab={handleNewTempTab(paneId)}
            onSeparateTab={handleSeparateTab(paneId)}
          />

          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <AnimatedPane transitionKey={pane.activeTabId || 'empty'}>
            {pane.activeTabId === 'welcome' && (
              <WelcomePage
                onToggleTerminal={() => setTerminalOpen(!terminalOpen)}
                onOpenSettings={() => setActiveView('settings')}
                onOpenFile={openFileInPane}
                onOpenAutoFile={(path) => openExternalPathInPane(path, true)}
                onNewFile={handleNewTab(paneId)}
                onLaunchRoblox={handleLaunchRoblox}
                synapseInstalled={synapseInstalled}
              />
            )}
            {pane.activeTabId === 'scripthub' && (
              <ScriptHub onExecuteScript={handleScriptHubExecute} />
            )}
            {activeTab &&
              activeTab.id !== 'welcome' &&
              activeTab.id !== 'scripthub' && (
                <FileViewer
                  tab={activeTab}
                  onChange={handleContentChange(paneId, activeTab.id)}
                  onExecute={handleExecuteScript(paneId)}
                  onSave={allowSave ? handleSaveTab(paneId) : undefined}
                />
              )}

            </AnimatedPane>
            <DropZoneOverlay
              isDragging={store.dragState.isDragging}
              onDrop={handleDrop(paneId)}
            />
          </div>
        </div>
      );
    },
    [
      store.activePaneId,
      store.dragState,
      handleDragStart,
      handleContentChange,
      handleDrop,
      handleTabsReorder,
      handleCloseOthers,
      handleCloseToLeft,
      handleCloseToRight,
      handleCloseAll,
      handleTabRename,
      handleNewTab,
      handleSaveTab,
      handleDuplicateTab,
      handleExecuteScript,
      handleScriptHubExecute,
      handleLaunchRoblox,
      synapseInstalled,
      handleTabWidthChange,
      handleNewTempTab,
      handleSeparateTab,
    ]
  );

  const activePane = getPane(store.activePaneId);
  const activeTab = activePane?.tabs.find((t) => t.id === activePane.activeTabId);

  return (
    <div ref={windowSurface}
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: colors.bgDark,
        borderRadius: isScreenFilled ? 0 : 10,
        overflow: 'hidden',
      }}
    >
      <div
        data-tauri-drag-region
        style={{
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          background: 'var(--bg-panel)',
          borderBottom: '1px solid var(--border-subtle)',
          userSelect: 'none',
        }}
      >
        <div
          data-tauri-drag-region
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            minWidth: 0,
          }}
        >
          <img
            src={synapseIcon}
            alt="SynVolt"
            style={{
              width: 24,
              height: 24,
              borderRadius: 6,
              cursor: activeView !== 'editor' ? 'pointer' : 'default',
            }}
            onClick={activeView !== 'editor' ? handleBackToEditor : undefined}
          />
          <span key={activeView === 'editor' ? activeTab?.id || 'workspace' : activeView} className="motion-area-name"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: colors.textMuted,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {activeView === 'settings' ? 'Settings' : activeView === 'account' ? 'Account' : activeTab?.id === 'welcome' ? 'Workspace' : activeTab?.title || 'SynVolt'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button onClick={toggleSynapseWindow} disabled={synapseChanging} title={synapseHidden ? 'Show Synapse Z launcher' : 'Hide Synapse Z launcher'}
            style={{ background: 'transparent', border: 'none', color: colors.textMuted, fontSize: 11, cursor: synapseChanging ? 'default' : 'pointer', padding: '6px 8px' }}>
            {synapseHidden ? 'Show Synapse Z' : 'Hide Synapse Z'}
          </button>
          <WindowButton onClick={handleMinimize} tooltip="Minimize">
            <Minus size={12} />
          </WindowButton>

          <WindowButton onClick={handleMaximize} tooltip={isScreenFilled ? 'Restore' : 'Fullscreen'}>
            <Square size={10} />
          </WindowButton>

          <WindowButton onClick={handleClose} tooltip="Close" isClose>
            <X size={12} />
          </WindowButton>
        </div>
      </div>

      {robloxProcesses.length > 0 && (synapseInstalled === false || launcherStatus === 'not_installed' || launcherStatus === 'not_found') && (
        <div role="status" style={{ padding: '8px 14px', background: '#241d17', color: '#f5cd9c', fontSize: 12 }}>
          You do not have a SynZ launcher. Please install Synapse Z or place its launcher in Downloads.
        </div>
      )}
      {robloxProcesses.length > 0 && launcherStatus === 'failed' && synapseInstalled !== false && (
        <div role="status" style={{ padding: '8px 14px', background: '#241d17', color: '#f5cd9c', fontSize: 12 }}>
          SynVolt could not open the SynZ launcher. Please open it manually.
        </div>
      )}
      <div key={activeView} className="motion-view" style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {activeView === 'editor' ? (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div className="sidebar-host" data-collapsed={sidebarCollapsed || undefined} data-resizing={sidebarResizing || undefined} style={{ width: sidebarCollapsed ? 34 : workbenchSettings.sidebarWidth, order: workbenchSettings.sidebarPosition === 'left' ? 0 : 2 }}>
              <div style={{ height: '100%', display: sidebarCollapsed ? 'none' : 'block' }}>
            <Sidebar
              activeTabPath={activeTab?.path}
              activeTabSource={activeTab?.source}
              onHome={() => addTabToPane(store.activePaneId, { id: 'welcome', title: 'Workspace', kind: 'page', source: 'page', closable: true })}
              onCollapse={() => { setSidebarCollapsed(true); localStorage.setItem('synvolt-sidebar-collapsed', 'true'); }}
              onAutoOpen={(path) => openExternalPathInPane(path, true)}
              onFileOpen={openFileInPane}
              onWorkspaceFileOpen={openWorkspaceFileInPane}
              onSidebarMutation={handleSidebarMutation}
              onSettingsClick={() => setActiveView('settings')}
              onAccountClick={() => setActiveView('account')}
              onScriptHubClick={handleScriptHubOpen}
              onClientManagerClick={() => setClientManagerOpen(true)}
              onRevealInExplorer={handleRevealInExplorer}
              showWorkspace={workbenchSettings.showWorkspaceInSidebar}
              width={workbenchSettings.sidebarWidth}
              onWidthChange={(w) => updateWorkbenchSetting('sidebarWidth', w)}
              onResizeStateChange={setSidebarResizing}
              position={workbenchSettings.sidebarPosition}
              order={workbenchSettings.sidebarPosition === 'left' ? 0 : 2}
            />
              </div>
              {sidebarCollapsed && <button type="button" className="sidebar-expand-button" title="Expand sidebar" aria-label="Expand sidebar" onClick={() => { setSidebarCollapsed(false); localStorage.setItem('synvolt-sidebar-collapsed', 'false'); }}>
                {workbenchSettings.sidebarPosition === 'left' ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
              </button>}
            </div>

            <div style={{ 
              flex: 1, 
              display: 'flex', 
              flexDirection: 'column', 
              overflow: 'hidden',
              order: 1,
            }}>
              <TerminalPanel
                isOpen={terminalOpen && activeTab?.id !== 'scripthub'}
                onToggle={() => setTerminalOpen(!terminalOpen)}
                height={terminalHeight}
                onHeightChange={setTerminalHeight}
                position={workbenchSettings.terminalPosition}
                order={workbenchSettings.terminalPosition === 'top' ? 0 : 2}
              />

              <div style={{ flex: 1, overflow: 'hidden', order: 1 }}>
                <SplitContainer node={store.root} renderPane={renderPaneContent} />
              </div>
            </div>
          </div>
        ) : activeView === 'account' ? (
          <AccountPage onBack={handleBackToEditor} />
        ) : (
          <SettingsPage onBack={handleBackToEditor} />
        )}
      </div>

      {activeView === 'editor' && <StatusBar />}

      {store.dragState.isDragging && store.dragState.tabTitle && (
        <DragGhost
          title={store.dragState.tabTitle}
          x={store.dragState.mouseX}
          y={store.dragState.mouseY}
        />
      )}

      {activeView === 'editor' && workbenchSettings.floatingExecuteButton && (
        <FloatingExecuteButton onExecute={handleFloatingExecute} />
      )}

      <QuickFilePicker
        isOpen={quickFilePickerOpen}
        onClose={() => setQuickFilePickerOpen(false)}
        onFileSelect={openFileInPane}
      />

      <ClientManagerDialog
        isOpen={clientManagerOpen}
        onClose={() => setClientManagerOpen(false)}
      />
    </div>
  );
}

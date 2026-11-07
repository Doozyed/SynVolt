import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { colors } from '../../config/theme';
import { useAccentColor } from '../../hooks/useAccentColor';
import { fileStore, VirtualFile, subscribeToFileStore } from '../../stores/fileStore';
import { getFavorites, isFavoriteByPath, toggleFavoriteByPath, subscribeToFavorites, loadFavorites } from '../../stores/favoritesStore';
import { getKeybinds, loadKeybinds, subscribeToKeybinds, keybindToDisplay, KeybindsSettings } from '../../stores/keybindsStore';
import synapseIcon from '../../assets/icon.png';
import {
  Star,
  Clock,
  FileCode,
  Plus,
  Play,
  Settings,
  Terminal,
  FolderOpen,
  Keyboard,
  Download,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

interface WelcomePageProps {
  onToggleTerminal: () => void;
  onOpenSettings: () => void;
  onOpenFile?: (fileId: string, fileName: string) => void;
  onNewFile?: () => void;
  onOpenAutoFile?: (path: string) => Promise<void>;
  onLaunchRoblox: () => void;
  synapseInstalled: boolean | null;
}

interface ShortcutItemProps {
  keys: string[];
  label: string;
  accentColor: string;
}

function ShortcutItem({ keys, label, accentColor }: ShortcutItemProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 0',
      }}
    >
      <span style={{ fontSize: 13, color: colors.textMuted }}>{label}</span>
      <div style={{ display: 'flex', gap: 4 }}>
        {keys.map((key, i) => (
          <span
            key={i}
            style={{
              padding: '4px 8px',
              background: 'var(--border-subtle)',
              border: '1px solid #2a2a2f',
              borderRadius: 4,
              fontSize: 11,
              fontFamily: 'monospace',
              color: accentColor,
            }}
          >
            {key}
          </span>
        ))}
      </div>
    </div>
  );
}

interface FileCardProps {
  file: VirtualFile;
  isFav: boolean;
  onOpen: () => void;
  onToggleFavorite: () => void;
  accentColor: string;
}

function FileCard({ file, isFav, onOpen, onToggleFavorite, accentColor }: FileCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onOpen}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 14px',
        background: hovered ? 'var(--bg-surface)' : 'var(--bg-panel)',
        boxShadow: hovered 
          ? `inset 0 0 0 1px ${accentColor}30, inset 0 2px 8px rgba(0,0,0,0.3)` 
          : 'inset 0 2px 8px rgba(0,0,0,0.25)',
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
      }}
    >
      <FileCode size={18} color={accentColor} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: colors.textWhite,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {file.name}
        </div>
        <div style={{ fontSize: 11, color: colors.textMuted }}>
          {new Date(file.modifiedAt).toLocaleDateString()}
        </div>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite();
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: hovered || isFav ? 1 : 0,
          transition: 'opacity 0.15s ease',
        }}
      >
        <Star
          size={16}
          fill={isFav ? accentColor : 'transparent'}
          color={isFav ? accentColor : colors.textMuted}
        />
      </button>
    </div>
  );
}

interface QuickActionProps {
  icon: React.ReactNode;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  accentColor: string;
}

function QuickAction({ icon, label, shortcut, onClick, accentColor }: QuickActionProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      className="motion-action"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '12px 16px',
        background: hovered ? 'var(--bg-surface)' : 'var(--bg-panel)',
        border: 'none',
        boxShadow: hovered 
          ? `inset 0 0 0 1px ${accentColor}30, inset 0 2px 8px rgba(0,0,0,0.3)` 
          : 'inset 0 2px 8px rgba(0,0,0,0.25)',
        borderRadius: 8,
        cursor: 'pointer',
        transition: 'all 0.15s ease',
        flex: 1,
        minWidth: 140,
      }}
    >
      <div style={{ color: hovered ? accentColor : colors.textMuted }}>{icon}</div>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: colors.textWhite }}>{label}</div>
        {shortcut && (
          <div style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{shortcut}</div>
        )}
      </div>
    </button>
  );
}

export function WelcomePage({ onToggleTerminal, onOpenSettings, onOpenFile, onNewFile, onOpenAutoFile, onLaunchRoblox, synapseInstalled }: WelcomePageProps) {
  const accent = useAccentColor();
  const [files, setFiles] = useState<VirtualFile[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [keybinds, setKeybinds] = useState<KeybindsSettings>(getKeybinds());
  const [savingInstaller, setSavingInstaller] = useState(false);
  const [installerMessage, setInstallerMessage] = useState('');
  const [installerOpened, setInstallerOpened] = useState(false);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;
    listen<string>('synz-reinstall-finished', event => {
      if (active) { setInstallerMessage(event.payload); setInstallerOpened(false); }
    }).then(stop => { if (active) unlisten = stop; else stop(); }).catch(() => {});
    return () => { active = false; unlisten?.(); };
  }, []);

  const saveInstaller = async () => {
    setSavingInstaller(true);
    setInstallerOpened(false);
    setInstallerMessage('');
    try {
      const result = await invoke<{ path: string; launched: boolean; cancelled: boolean }>('run_synz_installer');
      const filename = result.path.split(/[\\/]/).pop();
      setInstallerOpened(result.launched);
      setInstallerMessage(result.launched ? 'Click Install in SynZ, then choose Hide while patching.' : `Setup was cancelled. Saved in Downloads: ${filename}`);
    } catch (error) {
      setInstallerMessage(String(error));
    } finally {
      setSavingInstaller(false);
    }
  };

  const hideWhilePatching = async () => {
    try {
      const hidden = await invoke<boolean>('hide_synapse_launcher');
      if (!hidden) { setInstallerMessage('Could not hide SynZ. Keep its window open and try again.'); return; }
      window.dispatchEvent(new Event('synvolt-manual-patching-started'));
    } catch (error) { setInstallerMessage(String(error)); }
  };

  useEffect(() => {
    loadFavorites();
    loadKeybinds();
    setFiles(fileStore.getAllFiles());
    setFavoriteIds(getFavorites());
    setKeybinds(getKeybinds());

    const unsubFiles = subscribeToFileStore(() => {
      setFiles(fileStore.getAllFiles());
    });
    const unsubFavs = subscribeToFavorites(() => {
      setFavoriteIds(getFavorites());
    });
    const unsubKeybinds = subscribeToKeybinds(() => {
      setKeybinds(getKeybinds());
    });

    return () => {
      unsubFiles();
      unsubFavs();
      unsubKeybinds();
    };
  }, []);

  const recentFiles = [...files]
    .sort((a, b) => b.modifiedAt - a.modifiedAt)
    .slice(0, 4);

  const favoriteFiles = favoriteIds.map(path => files.find(file => file.filePath.toLowerCase() === path.toLowerCase()) || ({
    id: path, filePath: path, name: path.split(/[\\/]/).pop() || path, modifiedAt: Date.now(),
  } as VirtualFile));

  const handleOpenFile = (file: VirtualFile) => {
    if (files.some(item => item.id === file.id)) onOpenFile?.(file.id, file.name);
    else if (file.filePath) void onOpenAutoFile?.(file.filePath);
  };

  return (
    <div className="welcome-page"
      style={{
        height: '100%',
        overflowY: 'auto',
        background: colors.bgDark,
      }}
    >
      <div
        style={{
          maxWidth: 800,
          margin: '0 auto',
          paddingBottom: 40,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginBottom: 48,
          }}
        >
          <img
            src={synapseIcon}
            alt="SynVolt"
            style={{
              width: 72,
              height: 72,
              borderRadius: 14,
              marginBottom: 16,
            }}
          />
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: colors.textWhite,
              marginBottom: 4,
            }}
          >
            Welcome to SynVolt
          </h1>
          <p style={{ fontSize: 14, color: colors.textMuted }}>
            Script execution environment
          </p>
        </div>

        <div data-tour="workspace-actions"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            marginBottom: 40,
          }}
        >
          <QuickAction
            icon={<Plus size={18} />}
            label="New Script"
            shortcut={keybinds.newScript}
            onClick={onNewFile}
            accentColor={accent.primary}
          />
          <QuickAction
            icon={<FolderOpen size={18} />}
            label="Open File"
            shortcut={keybinds.openFile}
            accentColor={accent.primary}
          />
          <QuickAction
            icon={<Terminal size={18} />}
            label="Terminal"
            shortcut={keybinds.toggleTerminal}
            onClick={onToggleTerminal}
            accentColor={accent.primary}
          />
          <QuickAction
            icon={<Settings size={18} />}
            label="Settings"
            shortcut={keybinds.openSettings}
            onClick={onOpenSettings}
            accentColor={accent.primary}
          />
          <QuickAction
            icon={<Play size={18} />}
            label="Launch Roblox"
            onClick={onLaunchRoblox}
            accentColor={accent.primary}
          />
        </div>

        <div className="synz-installer-card">
          {synapseInstalled ? <CheckCircle2 size={18} color={colors.success} /> : <AlertCircle size={18} color={colors.textMuted} />}
          <div className="synz-installer-status">
            <strong>Synapse Z</strong>
            <span>{installerMessage || (synapseInstalled === null ? 'Checking installation…' : synapseInstalled ? 'Installed' : 'Not installed')}</span>
          </div>
          <button type="button" disabled={savingInstaller} onClick={saveInstaller} className="synz-installer-button">
            <Download size={14} />{savingInstaller ? 'Opening…' : synapseInstalled ? 'Reinstall Synapse Z' : 'Install Synapse Z'}
          </button>
          {installerOpened && <button type="button" onClick={hideWhilePatching} className="synz-installer-button">Hide while patching</button>}
        </div>

        <div className="welcome-sections" style={{ display: 'grid', gap: 24, marginBottom: 40 }}>
          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
              }}
            >
              <Star size={16} color={accent.primary} />
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.textWhite }}>
                Favorites
              </span>
            </div>
            {favoriteFiles.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {favoriteFiles.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    isFav={true}
                    onOpen={() => handleOpenFile(file)}
                    onToggleFavorite={() => file.filePath && toggleFavoriteByPath(file.filePath)}
                    accentColor={accent.primary}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: 24,
                  background: 'var(--bg-panel)',
                  boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.25)',
                  borderRadius: 8,
                  textAlign: 'center',
                }}
              >
                <Star size={24} color={colors.textMuted} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 13, color: colors.textMuted }}>
                  No favorites yet
                </div>
                <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>
                  Star scripts to access them quickly
                </div>
              </div>
            )}
          </div>

          <div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 16,
              }}
            >
              <Clock size={16} color={accent.primary} />
              <span style={{ fontSize: 14, fontWeight: 600, color: colors.textWhite }}>
                Recent Files
              </span>
            </div>
            {recentFiles.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentFiles.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    isFav={file.filePath ? isFavoriteByPath(file.filePath) : false}
                    onOpen={() => handleOpenFile(file)}
                    onToggleFavorite={() => file.filePath && toggleFavoriteByPath(file.filePath)}
                    accentColor={accent.primary}
                  />
                ))}
              </div>
            ) : (
              <div
                style={{
                  padding: 24,
                  background: 'var(--bg-panel)',
                  boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.25)',
                  borderRadius: 8,
                  textAlign: 'center',
                }}
              >
                <FileCode size={24} color={colors.textMuted} style={{ marginBottom: 8 }} />
                <div style={{ fontSize: 13, color: colors.textMuted }}>
                  No recent files
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            background: 'var(--bg-panel)',
            boxShadow: 'inset 0 2px 8px rgba(0,0,0,0.25)',
            borderRadius: 10,
            padding: 20,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: 16,
            }}
          >
            <Keyboard size={16} color={accent.primary} />
            <span style={{ fontSize: 14, fontWeight: 600, color: colors.textWhite }}>
              Keyboard Shortcuts
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 32px' }}>
            <ShortcutItem keys={keybindToDisplay(keybinds.newScript)} label="New Script" accentColor={accent.primary} />
            <ShortcutItem keys={keybindToDisplay(keybinds.saveScript)} label="Save Script" accentColor={accent.primary} />
            <ShortcutItem keys={keybindToDisplay(keybinds.openFile)} label="Open File" accentColor={accent.primary} />
            <ShortcutItem keys={keybindToDisplay(keybinds.closeTab)} label="Close Tab" accentColor={accent.primary} />
            <ShortcutItem keys={keybindToDisplay(keybinds.executeScript)} label="Execute Script" accentColor={accent.primary} />
            <ShortcutItem keys={keybindToDisplay(keybinds.toggleTerminal)} label="Toggle Terminal" accentColor={accent.primary} />
            <ShortcutItem keys={keybindToDisplay(keybinds.openSettings)} label="Open Settings" accentColor={accent.primary} />
            <ShortcutItem keys={keybindToDisplay(keybinds.findInFile)} label="Find in File" accentColor={accent.primary} />
          </div>
        </div>
      </div>
    </div>
  );
}

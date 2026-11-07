import { invoke } from '@tauri-apps/api/core';
import { useState, useEffect, useRef } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { colors } from '../../config/theme';
import { useAccentColor } from '../../hooks/useAccentColor';
import { loadPersistedJson, savePersistedJson } from '../../stores/persistedJson';
import {
  getSettings,
  loadSettings,
  updateEditorSetting,
  updateAutoAttachSetting,
  updateAppearanceSetting,
  updateWorkbenchSetting,
  subscribeToSettings,
  AppSettings,
  AppTheme,
} from '../../stores/settingsStore';
import {
  getClientSettings,
  loadClientSettings,
  subscribeToClientSettings,
  updateClientSynSetting,
  ClientSynSettings,
  ClientSettingValue,
} from '../../stores/clientSettingsStore';
import {
  getQuickExecuteSettings,
  saveQuickExecuteSettings,
  loadQuickExecuteSettings,
  subscribeToQuickExecute,
  QuickExecuteSettings,
} from '../../stores/quickExecuteStore';
import {
  getQolSettings,
  loadQolSettings,
  subscribeToQol,
  setQolEnabled,
  getDefaultTransformations,
  addUserTransformation,
  updateUserTransformation,
  removeUserTransformation,
  QolSettings,
} from '../../stores/qolStore';
import {
  getKeybinds,
  loadKeybinds,
  saveKeybinds,
  subscribeToKeybinds,
  resetKeybinds,
  formatKeybind,
  KeybindsSettings,
  KeybindAction,
  KEYBIND_LABELS,
  KEYBIND_DESCRIPTIONS,
} from '../../stores/keybindsStore';
import { ArrowLeft, Layout, Palette, Code, Zap, Keyboard, RotateCcw, SlidersHorizontal, Plus, Trash2, Lock, Check, ChevronDown } from 'lucide-react';

const SETTINGS_INDEX = [{"section":"editor","label":"Font Size","description":"Size of the text in the code editor"},{"section":"editor","label":"Font Family","description":"Choose the font used by the code editor"},{"section":"editor","label":"Tab Size","description":"Number of spaces per tab"},{"section":"editor","label":"Insert Spaces","description":"Insert spaces when pressing Tab"},{"section":"editor","label":"Render Whitespace","description":"Control how whitespace characters are displayed"},{"section":"editor","label":"Minimap","description":"Show code overview on the right side"},{"section":"editor","label":"Minimap Side","description":"Choose which side displays the minimap"},{"section":"editor","label":"Word Wrap","description":"Wrap long lines to fit the editor width"},{"section":"editor","label":"Line Numbers","description":"Show line numbers in the gutter"},{"section":"editor","label":"Font Ligatures","description":"Enable programming font ligatures"},{"section":"editor","label":"Luau LSP","description":"Enable Luau hover and signature assistance in the editor"},{"section":"editor","label":"Auto Ready Runtime","description":"Automatically mark the local runtime as ready when SynVolt starts"},{"section":"editor","label":"Ready Delay","description":"Time to wait before the runtime is marked ready (in milliseconds)"},{"section":"appearance","label":"Theme","description":"Choose the look of SynVolt"},{"section":"appearance","label":"Background Opacity","description":"Opacity of the window background"},{"section":"workbench","label":"Startup Action","description":"What to show when SynVolt starts"},{"section":"workbench","label":"Restore Tabs","description":"Reopen previously open tabs when SynVolt starts"},{"section":"workbench","label":"Floating Execute Button","description":"Show a draggable execute button you can place anywhere"},{"section":"workbench","label":"Show Workspace in Sidebar","description":"Display the workspace tree above scripts in the main sidebar"},{"section":"workbench","label":"Always on Top","description":"Keep the window above all other windows"},{"section":"workbench","label":"Sidebar Position","description":"Position of the file explorer sidebar"},{"section":"workbench","label":"Terminal Position","description":"Position of the terminal panel"},{"section":"workbench","label":"Sidebar Width","description":"Default width of the sidebar in pixels"},{"section":"quickExecute","label":"Enable Quick Execute","description":"Show floating panel for quick script execution"},{"section":"quickExecute","label":"Toggle Menu","description":"Keybind to open/close the Quick Execute menu"},{"section":"quickExecute","label":"Execute Script","description":"Keybind to run the selected script"},{"section":"qol","label":"Enable QoL Replacements","description":"Automatically transform shortcuts into full code when you click Run"}] as const;

const CLIENT_WARNING_PREFS_FILE = 'client-warning-prefs.json';

function isLightAccent(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5;
}

interface SettingsPageProps {
  onBack: () => void;
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  accentColor: string;
}

function ToggleSwitch({ checked, onChange, disabled, accentColor }: ToggleSwitchProps) {
  const knobColor = checked ? (isLightAccent(accentColor) ? '#0B0B0F' : '#FFFFFF') : colors.textWhite;
  return (
    <div
      onClick={() => !disabled && onChange(!checked)}
      style={{
        width: 32,
        height: 18,
        borderRadius: 9,
        background: checked ? accentColor : 'var(--border)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'background 0.2s ease',
        position: 'relative',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div
        style={{
          width: 12,
          height: 12,
          borderRadius: '50%',
          background: knobColor,
          position: 'absolute',
          top: 3,
          left: checked ? 17 : 3,
          transition: 'left 0.2s ease',
          boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        }}
      />
    </div>
  );
}

interface NumberInputProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
  accentColor: string;
}

function NumberInput({ value, min, max, step = 1, onChange, suffix, accentColor }: NumberInputProps) {
  const [inputValue, setInputValue] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setInputValue(String(value));
    }
  }, [value, focused]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleBlur = () => {
    setFocused(false);
    let num = parseFloat(inputValue);
    if (isNaN(num)) num = value;
    num = Math.max(min, Math.min(max, num));
    if (step >= 1) num = Math.round(num);
    setInputValue(String(num));
    onChange(num);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const increment = () => {
    const newValue = Math.min(max, value + step);
    onChange(newValue);
  };

  const decrement = () => {
    const newValue = Math.max(min, value - step);
    onChange(newValue);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <button
        onClick={decrement}
        style={{
          width: 28,
          height: 28,
          background: 'var(--bg-raised)',
          border: 'none',
          borderRadius: 4,
          color: colors.textWhite,
          cursor: 'pointer',
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        −
      </button>
      <div style={{ position: 'relative' }}>
        <input
          type="text"
          value={inputValue}
          onChange={handleChange}
          onFocus={() => setFocused(true)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          style={{
            width: 60,
            height: 28,
            background: 'var(--bg-raised)',
            border: focused ? `1px solid ${accentColor}` : '1px solid transparent',
            borderRadius: 4,
            color: colors.textWhite,
            fontSize: 13,
            textAlign: 'center',
            outline: 'none',
            paddingRight: suffix ? 20 : 0,
          }}
        />
        {suffix && (
          <span
            style={{
              position: 'absolute',
              right: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: 11,
              color: colors.textMuted,
              pointerEvents: 'none',
            }}
          >
            {suffix}
          </span>
        )}
      </div>
      <button
        onClick={increment}
        style={{
          width: 28,
          height: 28,
          background: 'var(--bg-raised)',
          border: 'none',
          borderRadius: 4,
          color: colors.textWhite,
          cursor: 'pointer',
          fontSize: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        +
      </button>
    </div>
  );
}

interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="settings-row" data-setting-name={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '11px 0',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div className="settings-row-label" style={{ flex: 1, paddingRight: 24 }}>
        <div style={{ fontSize: 14, color: colors.textWhite, fontWeight: 500 }}>{label}</div>
        {description && (
          <div style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{description}</div>
        )}
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accentColor: string;
}

function TabButton({ active, onClick, icon, label, accentColor }: TabButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '5px 9px',
        background: active ? 'var(--bg-raised)' : hovered ? 'var(--bg-surface)' : 'transparent',
        border: 'none',
        borderRadius: 8,
        cursor: 'pointer',
        width: '100%',
        color: active ? colors.textWhite : colors.textMuted,
        transition: 'all 0.15s ease',
        textAlign: 'left',
        borderLeft: active ? `3px solid ${accentColor}` : '3px solid transparent',
      }}
    >
      <div style={{ color: active ? accentColor : 'inherit' }}>{icon}</div>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
    </button>
  );
}

interface OptionButtonProps {
  label: string;
  selected: boolean;
  onClick: () => void;
  accentColor: string;
}

function OptionButton({ label, selected, onClick, accentColor }: OptionButtonProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: '5px 10px',
        background: selected ? accentColor : hovered ? 'var(--border)' : 'var(--bg-raised)',
        border: 'none',
        borderRadius: 6,
        color: selected ? (isLightAccent(accentColor) ? '#0B0B0F' : '#FFFFFF') : colors.textWhite,
        fontSize: 12,
        cursor: 'pointer',
        transition: 'background 0.15s ease',
      }}
    >
      {label}
    </button>
  );
}

const THEME_OPTIONS: { value: AppTheme; label: string }[] = [
  { value: 'synvolt', label: 'SynVolt' }, { value: 'synviolet', label: 'SynViolet' },
  { value: 'cream', label: 'Cream' }, { value: 'midnight', label: 'Midnight Blue' },
  { value: 'emerald', label: 'Emerald' }, { value: 'crimson', label: 'Crimson' },
  { value: 'graphite', label: 'Graphite' }, { value: 'sakura', label: 'Sakura' },
];

interface PickerOption { value: string; label: string; group?: string }
function StyledSelector({ label, value, options, onChange, searchable = false }: {
  label: string; value: string; options: PickerOption[]; onChange: (value: string) => void; searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const selected = options.find(option => option.value === value);
  const visible = options.filter(option => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const focusOption = (index: number) => {
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
    if (buttons?.length) buttons[Math.max(0, Math.min(index, buttons.length - 1))]?.focus();
  };
  const openMenu = (keyboard = false) => {
    setOpen(true);
    requestAnimationFrame(() => {
      if (searchable) search.current?.focus();
      else if (keyboard) focusOption(Math.max(0, options.findIndex(option => option.value === value)));
    });
  };
  return <div className={searchable ? 'theme-picker font-picker' : 'theme-picker'} ref={root} onBlur={event => { if (event.relatedTarget && !root.current?.contains(event.relatedTarget as Node)) { setOpen(false); setQuery(''); } }}>
    <button type="button" ref={trigger} className="theme-picker-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
      onClick={() => open ? (setOpen(false), setQuery('')) : openMenu()}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openMenu(true); } }}>
      <span>{selected?.label || value}</span><ChevronDown size={14} className={open ? 'theme-chevron open' : 'theme-chevron'} />
    </button>
    {open && <div className="theme-picker-menu" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery(''); trigger.current?.focus(); return; }
      const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (index >= 0 && (event.key === 'Home' || event.key === 'End'))) {
        event.preventDefault(); focusOption(event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : index < 0 ? 0 : index + (event.key === 'ArrowDown' ? 1 : -1));
      }
    }}>
      {searchable && <input ref={search} className="picker-search" aria-label={label + ' search'} placeholder="Search fonts..." value={query} onChange={event => setQuery(event.target.value)} />}
      <div role="listbox" aria-label={label + ' choices'}>
        {visible.map((option, index) => <div key={option.value}>
          {option.group && (index === 0 || visible[index - 1].group !== option.group) && <div className="picker-group">{option.group}</div>}
          <button type="button" role="option" aria-selected={option.value === value}
            onClick={() => { onChange(option.value); setOpen(false); setQuery(''); trigger.current?.focus(); }}>
            <span>{option.label}</span>{option.value === value && <Check size={14} />}
          </button>
        </div>)}
        {visible.length === 0 && <div className="picker-empty">No fonts found</div>}
      </div>
    </div>}
  </div>;
}

export function SettingsPage({ onBack }: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings>(getSettings());
  const [clientSettings, setClientSettings] = useState<ClientSynSettings>(getClientSettings());
  const [showClientRestartWarning, setShowClientRestartWarning] = useState(false);
  const [clientWarningDontShowAgain, setClientWarningDontShowAgain] = useState(false);
  const [clientWarningEnabled, setClientWarningEnabled] = useState(true);
  const [quickExecuteSettings, setQuickExecuteSettings] = useState<QuickExecuteSettings>(getQuickExecuteSettings());
  const [keybindsSettings, setKeybindsSettings] = useState<KeybindsSettings>(getKeybinds());
  const [qolSettings, setQolSettings] = useState<QolSettings>(getQolSettings());
  const [newPattern, setNewPattern] = useState('');
  const [newReplacement, setNewReplacement] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchTarget, setSearchTarget] = useState<{ label: string; nonce: number } | null>(null);
  const [installedFonts, setInstalledFonts] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<'editor' | 'appearance' | 'workbench' | 'client' | 'quickExecute' | 'keybinds' | 'qol'>('editor');
  const [editingKeybind, setEditingKeybind] = useState<'toggle' | 'execute' | 'save' | KeybindAction | null>(null);
  const keybindInputRef = useRef<HTMLInputElement>(null);
  const accent = useAccentColor();

  useEffect(() => {
    void invoke<string[]>('get_installed_font_families').then(setInstalledFonts).catch(() => {});
    loadSettings();
    loadClientSettings();
    loadPersistedJson<{ enabled: boolean }>(CLIENT_WARNING_PREFS_FILE, { enabled: true }).then((prefs) => {
      setClientWarningEnabled(prefs.enabled !== false);
    });
    loadQuickExecuteSettings();
    loadKeybinds();
    loadQolSettings();
    const unsubscribe = subscribeToSettings(() => {
      setSettings(getSettings());
    });
    const unsubscribeQE = subscribeToQuickExecute(() => {
      setQuickExecuteSettings(getQuickExecuteSettings());
    });
    const unsubscribeClient = subscribeToClientSettings(() => {
      setClientSettings(getClientSettings());
    });
    const unsubscribeKB = subscribeToKeybinds(() => {
      setKeybindsSettings(getKeybinds());
    });
    const unsubscribeQol = subscribeToQol(() => {
      setQolSettings(getQolSettings());
    });
    return () => {
      unsubscribe();
      unsubscribeClient();
      unsubscribeQE();
      unsubscribeKB();
      unsubscribeQol();
    };
  }, []);

  useEffect(() => {
    if (editingKeybind && keybindInputRef.current) {
      keybindInputRef.current.focus();
    }
  }, [editingKeybind]);

  const handleKeybindKeyDown = (e: React.KeyboardEvent, field: 'toggle' | 'execute' | 'save' | KeybindAction) => {
    e.preventDefault();
    if (e.key === 'Escape') {
      setEditingKeybind(null);
      return;
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

    const keybind = formatKeybind(e.nativeEvent);
    if (field === 'toggle') {
      saveQuickExecuteSettings({ toggleKeybind: keybind });
    } else if (field === 'execute') {
      saveQuickExecuteSettings({ executeKeybind: keybind });
    } else if (field === 'save') {
      saveQuickExecuteSettings({ saveKeybind: keybind });
    } else {
      saveKeybinds({ [field]: keybind });
    }
    setEditingKeybind(null);
  };

  const persistClientWarningPreference = async (enabled: boolean) => {
    setClientWarningEnabled(enabled);
    await savePersistedJson(CLIENT_WARNING_PREFS_FILE, { enabled });
  };

  const handleClientBooleanToggle = async (key: string, value: boolean) => {
    try {
      await updateClientSynSetting(key, value);
    } catch (error) {
      window.alert(`Could not save this setting: ${String(error)}`);
      return;
    }

    if (clientWarningEnabled) {
      setClientWarningDontShowAgain(false);
      setShowClientRestartWarning(true);
    }
  };

  const formatClientSettingLabel = (key: string) =>
    key
      .split('_')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');

  const renderClientSettingControl = (key: string, value: ClientSettingValue) => {
    if (typeof value === 'boolean') {
      return (
        <ToggleSwitch
          checked={value}
          onChange={(next) => handleClientBooleanToggle(key, next)}
          accentColor={accent.primary}
        />
      );
    }

    if (typeof value === 'number') {
      return (
        <NumberInput
          value={value}
          min={Number.MIN_SAFE_INTEGER}
          max={Number.MAX_SAFE_INTEGER}
          step={Number.isInteger(value) ? 1 : 0.1}
          onChange={(next) => { void updateClientSynSetting(key, next).catch(error => window.alert(String(error))); }}
          accentColor={accent.primary}
        />
      );
    }

    return (
      <input
        type="text"
        value={value ?? ''}
        onChange={(e) => { void updateClientSynSetting(key, e.target.value).catch(error => window.alert(String(error))); }}
        style={{
          width: 220,
          background: 'var(--border-subtle)',
          border: '1px solid var(--border)',
          borderRadius: 6,
          padding: '7px 10px',
          color: colors.textWhite,
          fontSize: 12,
          outline: 'none',
        }}
      />
    );
  };

  const searchableSettings = [
    ...SETTINGS_INDEX,
    { section: 'qol' as const, label: 'Transformations', description: 'Manage code replacement patterns' },
    ...Object.keys(clientSettings).map(key => ({ section: 'client' as const, label: formatClientSettingLabel(key), description: key.replace(/_/g, ' ') })),
    ...Object.entries(KEYBIND_LABELS).map(([key, label]) => ({ section: 'keybinds' as const, label, description: KEYBIND_DESCRIPTIONS[key as KeybindAction] || '' })),
  ];
  const results = searchQuery.trim() ? searchableSettings.filter(item => (item.label + ' ' + item.description + ' ' + item.section).toLowerCase().includes(searchQuery.trim().toLowerCase())).slice(0, 30) : [];
  useEffect(() => {
    if (!searchTarget) return;
    let timeout: number | undefined;
    const frame = requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>('[data-setting-name]')].find(row => row.dataset.settingName === searchTarget.label);
      if (!target) return;
      target.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' });
      target.classList.remove('setting-search-highlight');
      void target.offsetWidth;
      target.classList.add('setting-search-highlight');
      timeout = window.setTimeout(() => target.classList.remove('setting-search-highlight'), 1000);
    });
    return () => { cancelAnimationFrame(frame); if (timeout) window.clearTimeout(timeout); };
  }, [searchTarget, activeTab]);

  const renderContent = () => {
    switch (activeTab) {
      case 'editor':
        return (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Editor</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>Customize the code editor experience</p>
            </div>

            <SettingRow label="Font Size" description="Size of the text in the code editor">
              <NumberInput
                value={settings.editor.fontSize}
                min={10}
                max={24}
                onChange={(v) => updateEditorSetting('fontSize', v)}
                suffix="px"
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Font Family" description="Choose the font used by the code editor">
              <StyledSelector label="Font Family" value={settings.editor.fontFamily} searchable onChange={font => updateEditorSetting('fontFamily', font)} options={(() => {
                const recommended = ['Cascadia Code', 'JetBrains Mono', 'Fira Code', 'Source Code Pro', 'IBM Plex Mono', 'Monaspace Neon', 'Consolas', 'System Monospace'];
                const names = new Set(recommended.map(font => font.toLowerCase()));
                return [...recommended.map(font => ({ value: font, label: font, group: 'Recommended' })),
                  ...installedFonts.filter(font => !names.has(font.toLowerCase())).map(font => ({ value: font, label: font, group: 'Installed Fonts' }))];
              })()} />
            </SettingRow>

            <SettingRow label="Tab Size" description="Number of spaces per tab">
              <NumberInput
                value={settings.editor.tabSize}
                min={2}
                max={8}
                onChange={(v) => updateEditorSetting('tabSize', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Insert Spaces" description="Insert spaces when pressing Tab">
              <ToggleSwitch checked={settings.editor.insertSpaces} onChange={value => updateEditorSetting('insertSpaces', value)} accentColor={accent.primary} />
            </SettingRow>
            <SettingRow label="Render Whitespace" description="Control how whitespace characters are displayed">
              <div className="themed-select"><select aria-label="Render Whitespace" value={settings.editor.renderWhitespace} onChange={e => updateEditorSetting('renderWhitespace', e.target.value as typeof settings.editor.renderWhitespace)}>
                {(['none', 'boundary', 'selection', 'trailing', 'all'] as const).map(value => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
              </select></div>
            </SettingRow>
            <SettingRow label="Minimap" description="Show code overview on the right side">
              <ToggleSwitch
                checked={settings.editor.minimap}
                onChange={(v) => updateEditorSetting('minimap', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Minimap Side" description="Choose which side displays the minimap">
              <div className="themed-select"><select aria-label="Minimap Side" value={settings.editor.minimapSide} onChange={e => updateEditorSetting('minimapSide', e.target.value as 'left' | 'right')}><option value="right">Right</option><option value="left">Left</option></select></div>
            </SettingRow>
            <SettingRow label="Word Wrap" description="Wrap long lines to fit the editor width">
              <ToggleSwitch
                checked={settings.editor.wordWrap}
                onChange={(v) => updateEditorSetting('wordWrap', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Line Numbers" description="Show line numbers in the gutter">
              <ToggleSwitch
                checked={settings.editor.lineNumbers}
                onChange={(v) => updateEditorSetting('lineNumbers', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Font Ligatures" description="Enable programming font ligatures">
              <ToggleSwitch
                checked={settings.editor.fontLigatures}
                onChange={(v) => updateEditorSetting('fontLigatures', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Luau LSP" description="Enable Luau hover and signature assistance in the editor">
              <ToggleSwitch
                checked={settings.editor.luauLsp}
                onChange={(v) => updateEditorSetting('luauLsp', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <div style={{ marginBottom: 24, marginTop: 40 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Runtime Preparation</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>Configure how SynVolt readies the local execution runtime</p>
            </div>

            <SettingRow
              label="Auto Ready Runtime"
              description="Automatically mark the local runtime as ready when SynVolt starts"
            >
              <ToggleSwitch
                checked={settings.autoAttach.enabled}
                onChange={(v) => updateAutoAttachSetting('enabled', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow
              label="Ready Delay"
              description="Time to wait before the runtime is marked ready (in milliseconds)"
            >
              <NumberInput
                value={settings.autoAttach.delay}
                min={0}
                max={5000}
                step={100}
                onChange={(v) => updateAutoAttachSetting('delay', v)}
                suffix="ms"
                accentColor={accent.primary}
              />
            </SettingRow>
          </>
        );

      case 'appearance':
        return (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Appearance</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>Customize the look and feel of SynVolt</p>
            </div>

            <SettingRow label="Theme" description="Choose the look of SynVolt">
              <StyledSelector label="Theme" value={settings.appearance.theme} options={THEME_OPTIONS} onChange={theme => updateAppearanceSetting('theme', theme as AppTheme)} />
            </SettingRow>

            <SettingRow label="Background Opacity" description="Opacity of the window background">
              <NumberInput
                value={Math.round(settings.appearance.backgroundOpacity * 100)}
                min={50}
                max={100}
                onChange={(v) => updateAppearanceSetting('backgroundOpacity', v / 100)}
                suffix="%"
                accentColor={accent.primary}
              />
            </SettingRow>
          </>
        );

      case 'workbench':
        return (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>General</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>Configure workspace behavior</p>
            </div>

            <SettingRow label="Startup Action" description="What to show when SynVolt starts">
              <div style={{ display: 'flex', gap: 8 }}>
                <OptionButton
                  label="Welcome"
                  selected={settings.workbench.startupAction === 'welcome'}
                  onClick={() => updateWorkbenchSetting('startupAction', 'welcome')}
                  accentColor={accent.primary}
                />
                <OptionButton
                  label="New Tab"
                  selected={settings.workbench.startupAction === 'new'}
                  onClick={() => updateWorkbenchSetting('startupAction', 'new')}
                  accentColor={accent.primary}
                />
                <OptionButton
                  label="None"
                  selected={settings.workbench.startupAction === 'none'}
                  onClick={() => updateWorkbenchSetting('startupAction', 'none')}
                  accentColor={accent.primary}
                />
              </div>
            </SettingRow>

            <SettingRow label="Restore Tabs" description="Reopen previously open tabs when SynVolt starts">
              <ToggleSwitch
                checked={settings.workbench.restoreTabs}
                onChange={(v) => updateWorkbenchSetting('restoreTabs', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Floating Execute Button" description="Show a draggable execute button you can place anywhere">
              <ToggleSwitch
                checked={settings.workbench.floatingExecuteButton}
                onChange={(v) => updateWorkbenchSetting('floatingExecuteButton', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Show Workspace in Sidebar" description="Display the workspace tree above scripts in the main sidebar">
              <ToggleSwitch
                checked={settings.workbench.showWorkspaceInSidebar}
                onChange={(v) => updateWorkbenchSetting('showWorkspaceInSidebar', v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Always on Top" description="Keep the window above all other windows">
              <ToggleSwitch
                checked={settings.workbench.alwaysOnTop}
                onChange={async (v) => {
                  await getCurrentWindow().setAlwaysOnTop(v);
                  updateWorkbenchSetting('alwaysOnTop', v);
                }}
                accentColor={accent.primary}
              />
            </SettingRow>

            <div style={{ marginBottom: 24, marginTop: 40 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Layout</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>Customize the position of panels</p>
            </div>

            <SettingRow label="Sidebar Position" description="Position of the file explorer sidebar">
              <div style={{ display: 'flex', gap: 8 }}>
                <OptionButton
                  label="Left"
                  selected={settings.workbench.sidebarPosition === 'left'}
                  onClick={() => updateWorkbenchSetting('sidebarPosition', 'left')}
                  accentColor={accent.primary}
                />
                <OptionButton
                  label="Right"
                  selected={settings.workbench.sidebarPosition === 'right'}
                  onClick={() => updateWorkbenchSetting('sidebarPosition', 'right')}
                  accentColor={accent.primary}
                />
              </div>
            </SettingRow>

            <SettingRow label="Terminal Position" description="Position of the terminal panel">
              <div style={{ display: 'flex', gap: 8 }}>
                <OptionButton
                  label="Bottom"
                  selected={settings.workbench.terminalPosition === 'bottom'}
                  onClick={() => updateWorkbenchSetting('terminalPosition', 'bottom')}
                  accentColor={accent.primary}
                />
                <OptionButton
                  label="Top"
                  selected={settings.workbench.terminalPosition === 'top'}
                  onClick={() => updateWorkbenchSetting('terminalPosition', 'top')}
                  accentColor={accent.primary}
                />
              </div>
            </SettingRow>

            <SettingRow label="Sidebar Width" description="Default width of the sidebar in pixels">
              <NumberInput
                value={settings.workbench.sidebarWidth}
                min={160}
                max={400}
                step={10}
                onChange={(v) => updateWorkbenchSetting('sidebarWidth', v)}
                suffix="px"
                accentColor={accent.primary}
              />
            </SettingRow>
          </>
        );

      case 'client':
        const clientEntries = Object.entries(clientSettings).sort(([a], [b]) => a.localeCompare(b));

        return (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Client</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>Configure client behavior. Restart Roblox after enabling or disabling any of these settings.</p>
            </div>

            {clientEntries.length === 0 ? (
              <div style={{ fontSize: 13, color: colors.textMuted }}>No client settings were found.</div>
            ) : (
              clientEntries.map(([key, value]) => (
                <SettingRow
                  key={key}
                  label={formatClientSettingLabel(key)}
                  description={key}
                >
                  {renderClientSettingControl(key, value)}
                </SettingRow>
              ))
            )}
          </>
        );

      case 'quickExecute':
        return (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Quick Execute</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>Floating script execution panel with keybinds</p>
            </div>

            <SettingRow label="Enable Quick Execute" description="Show floating panel for quick script execution">
              <ToggleSwitch
                checked={quickExecuteSettings.enabled}
                onChange={(v) => saveQuickExecuteSettings({ enabled: v })}
                accentColor={accent.primary}
              />
            </SettingRow>

            <SettingRow label="Toggle Menu" description="Keybind to open/close the Quick Execute menu">
              {editingKeybind === 'toggle' ? (
                <input
                  ref={keybindInputRef}
                  placeholder="Press keys..."
                  onKeyDown={(e) => handleKeybindKeyDown(e, 'toggle')}
                  onBlur={() => setEditingKeybind(null)}
                  style={{
                    width: 100,
                    background: 'var(--border-subtle)',
                    border: `1px solid ${accent.primary}`,
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: colors.textWhite,
                    fontSize: 12,
                    outline: 'none',
                    textAlign: 'center',
                  }}
                />
              ) : (
                <button
                  onClick={() => setEditingKeybind('toggle')}
                  style={{
                    background: 'var(--border-subtle)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '6px 12px',
                    color: colors.textWhite,
                    fontSize: 12,
                    cursor: 'pointer',
                    minWidth: 80,
                    textAlign: 'center',
                  }}
                >
                  {quickExecuteSettings.toggleKeybind}
                </button>
              )}
            </SettingRow>

            <SettingRow label="Execute Script" description="Keybind to run the selected script">
              {editingKeybind === 'execute' ? (
                <input
                  ref={keybindInputRef}
                  placeholder="Press keys..."
                  onKeyDown={(e) => handleKeybindKeyDown(e, 'execute')}
                  onBlur={() => setEditingKeybind(null)}
                  style={{
                    width: 100,
                    background: 'var(--border-subtle)',
                    border: `1px solid ${accent.primary}`,
                    borderRadius: 6,
                    padding: '6px 10px',
                    color: colors.textWhite,
                    fontSize: 12,
                    outline: 'none',
                    textAlign: 'center',
                  }}
                />
              ) : (
                <button
                  onClick={() => setEditingKeybind('execute')}
                  style={{
                    background: 'var(--border-subtle)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '6px 12px',
                    color: colors.textWhite,
                    fontSize: 12,
                    cursor: 'pointer',
                    minWidth: 80,
                    textAlign: 'center',
                  }}
                >
                  {quickExecuteSettings.executeKeybind}
                </button>
              )}
            </SettingRow>
          </>
        );

      case 'keybinds':
        const keybindActions: KeybindAction[] = [
          'newScript',
          'openFile',
          'saveScript',
          'closeTab',
          'executeScript',
          'toggleTerminal',
          'openSettings',
          'findInFile',
          'quickFilePicker',
          'openExplorer',
        ];

        return (
          <>
            <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Keyboard Shortcuts</h2>
                <p style={{ fontSize: 13, color: colors.textMuted }}>Customize keyboard shortcuts for common actions</p>
              </div>
              <button
                onClick={() => resetKeybinds()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  background: 'var(--bg-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  color: colors.textMuted,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                <RotateCcw size={14} />
                Reset All
              </button>
            </div>

            {keybindActions.map((action) => (
              <SettingRow
                key={action}
                label={KEYBIND_LABELS[action]}
                description={KEYBIND_DESCRIPTIONS[action]}
              >
                {editingKeybind === action ? (
                  <input
                    ref={keybindInputRef}
                    placeholder="Press keys..."
                    onKeyDown={(e) => handleKeybindKeyDown(e, action)}
                    onBlur={() => setEditingKeybind(null)}
                    style={{
                      width: 120,
                      background: 'var(--border-subtle)',
                      border: `1px solid ${accent.primary}`,
                      borderRadius: 6,
                      padding: '6px 10px',
                      color: colors.textWhite,
                      fontSize: 12,
                      outline: 'none',
                      textAlign: 'center',
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setEditingKeybind(action)}
                    style={{
                      background: 'var(--border-subtle)',
                      border: '1px solid var(--border)',
                      borderRadius: 6,
                      padding: '6px 12px',
                      color: colors.textWhite,
                      fontSize: 12,
                      cursor: 'pointer',
                      minWidth: 100,
                      textAlign: 'center',
                    }}
                  >
                    {keybindsSettings[action]}
                  </button>
                )}
              </SettingRow>
            ))}
          </>
        );

      case 'qol':
        const defaultTransforms = getDefaultTransformations();
        const allTransforms = [...defaultTransforms, ...qolSettings.userTransformations];

        return (
          <>
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Quality of Life</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>Auto-replace shortcuts with full code when executing scripts. Write less, do more.</p>
            </div>

            <SettingRow label="Enable QoL Replacements" description="Automatically transform shortcuts into full code when you click Run">
              <ToggleSwitch
                checked={qolSettings.enabled}
                onChange={(v) => setQolEnabled(v)}
                accentColor={accent.primary}
              />
            </SettingRow>

            <div style={{ marginBottom: 24, marginTop: 40 }}>
              <h2 data-setting-name="Transformations" style={{ fontSize: 18, fontWeight: 600, color: colors.textWhite, marginBottom: 8 }}>Transformations</h2>
              <p style={{ fontSize: 13, color: colors.textMuted }}>When you type the pattern, it gets replaced with the full code on execution</p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {allTransforms.map((t) => (
                <div
                  key={t.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 16px',
                    background: 'var(--border-subtle)',
                    borderRadius: 8,
                    border: t.isDefault ? `1px solid ${accent.primary}30` : '1px solid var(--border)',
                  }}
                >
                  {t.isDefault && (
                    <Lock size={14} style={{ color: accent.primary, flexShrink: 0 }} />
                  )}
                  <div style={{ flex: 1, display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input
                      value={t.pattern}
                      onChange={(e) => !t.isDefault && updateUserTransformation(t.id, e.target.value, t.replacement)}
                      disabled={t.isDefault}
                      placeholder="Pattern"
                      style={{
                        flex: 1,
                        background: t.isDefault ? 'transparent' : '#15151a',
                        border: t.isDefault ? 'none' : '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '8px 12px',
                        color: colors.textWhite,
                        fontSize: 13,
                        fontFamily: 'monospace',
                        outline: 'none',
                      }}
                    />
                    <span style={{ color: colors.textMuted, fontSize: 12 }}>→</span>
                    <input
                      value={t.replacement}
                      onChange={(e) => !t.isDefault && updateUserTransformation(t.id, t.pattern, e.target.value)}
                      disabled={t.isDefault}
                      placeholder="Replacement"
                      style={{
                        flex: 2,
                        background: t.isDefault ? 'transparent' : '#15151a',
                        border: t.isDefault ? 'none' : '1px solid var(--border)',
                        borderRadius: 6,
                        padding: '8px 12px',
                        color: colors.textWhite,
                        fontSize: 13,
                        fontFamily: 'monospace',
                        outline: 'none',
                      }}
                    />
                  </div>
                  {!t.isDefault && (
                    <button
                      onClick={() => removeUserTransformation(t.id)}
                      style={{
                        width: 32,
                        height: 32,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'transparent',
                        border: 'none',
                        borderRadius: 6,
                        color: '#f87171',
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 16px',
                  background: '#15151a',
                  borderRadius: 8,
                  border: '1px dashed var(--border)',
                }}
              >
                <input
                  value={newPattern}
                  onChange={(e) => setNewPattern(e.target.value)}
                  placeholder="New pattern (e.g. noclip)"
                  style={{
                    flex: 1,
                    background: 'var(--border-subtle)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    color: colors.textWhite,
                    fontSize: 13,
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
                <span style={{ color: colors.textMuted, fontSize: 12 }}>→</span>
                <input
                  value={newReplacement}
                  onChange={(e) => setNewReplacement(e.target.value)}
                  placeholder="Replacement code"
                  style={{
                    flex: 2,
                    background: 'var(--border-subtle)',
                    border: '1px solid var(--border)',
                    borderRadius: 6,
                    padding: '8px 12px',
                    color: colors.textWhite,
                    fontSize: 13,
                    fontFamily: 'monospace',
                    outline: 'none',
                  }}
                />
                <button
                  onClick={() => {
                    if (newPattern.trim() && newReplacement.trim()) {
                      addUserTransformation(newPattern.trim(), newReplacement.trim());
                      setNewPattern('');
                      setNewReplacement('');
                    }
                  }}
                  disabled={!newPattern.trim() || !newReplacement.trim()}
                  style={{
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: newPattern.trim() && newReplacement.trim() ? accent.primary : 'var(--border)',
                    border: 'none',
                    borderRadius: 6,
                    color: accent.contrastText,
                    cursor: newPattern.trim() && newReplacement.trim() ? 'pointer' : 'not-allowed',
                  }}
                >
                  <Plus size={16} />
                </button>
              </div>
            </div>
          </>
        );
    }
  };

  return (
    <div className="settings-page" style={{ display: 'flex', width: '100%', height: '100%', background: colors.bgDark, '--setting-highlight': accent.primary } as React.CSSProperties}>
      <div className="settings-navigation"
        style={{
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ marginBottom: 24 }}>
          <button
            onClick={onBack}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'transparent',
              border: 'none',
              color: colors.textMuted,
              cursor: 'pointer',
              fontSize: 13,
              padding: 0,
              marginBottom: 20,
            }}
          >
            <ArrowLeft size={16} />
            Back to Editor
          </button>
          <div className="settings-search-wrap">
            <input className="settings-search" type="search" aria-label="Search settings" placeholder="Search settings" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
            {searchQuery.trim() && <div className="settings-search-results" role="listbox" aria-label="Settings search results">
              {results.length ? results.map((item, index) => <button key={item.section + item.label + index} role="option" aria-selected="false" onClick={() => {
                setActiveTab(item.section); setSearchTarget({ label: item.label, nonce: Date.now() }); setSearchQuery('');
              }}><span>{item.label}</span><small>{item.section === 'workbench' ? 'General' : item.section === 'qol' ? 'Quality of Life' : item.section}</small></button>) : <div className="settings-no-results">No settings found</div>}
            </div>}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <TabButton
            active={activeTab === 'editor'}
            onClick={() => setActiveTab('editor')}
            icon={<Code size={18} />}
            label="Editor"
            accentColor={accent.primary}
          />
          <TabButton
            active={activeTab === 'appearance'}
            onClick={() => setActiveTab('appearance')}
            icon={<Palette size={18} />}
            label="Appearance"
            accentColor={accent.primary}
          />
          <TabButton
            active={activeTab === 'workbench'}
            onClick={() => setActiveTab('workbench')}
            icon={<Layout size={18} />}
            label="General"
            accentColor={accent.primary}
          />
          <TabButton
            active={activeTab === 'client'}
            onClick={() => setActiveTab('client')}
            icon={<Lock size={18} />}
            label="Client"
            accentColor={accent.primary}
          />
          <TabButton
            active={activeTab === 'quickExecute'}
            onClick={() => setActiveTab('quickExecute')}
            icon={<Zap size={18} />}
            label="Quick Execute"
            accentColor={accent.primary}
          />
          <TabButton
            active={activeTab === 'keybinds'}
            onClick={() => setActiveTab('keybinds')}
            icon={<Keyboard size={18} />}
            label="Keybinds"
            accentColor={accent.primary}
          />
          <TabButton
            active={activeTab === 'qol'}
            onClick={() => setActiveTab('qol')}
            icon={<SlidersHorizontal size={18} />}
            label="Quality of Life"
            accentColor={accent.primary}
          />
        </div>
      </div>

      <div className="settings-content" style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
        <div key={activeTab} className="motion-content">{renderContent()}</div>
      </div>

      {showClientRestartWarning && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 10001,
          }}
          onClick={() => setShowClientRestartWarning(false)}
        >
          <div
            style={{
              width: 420,
              maxWidth: 'calc(100vw - 32px)',
              background: 'var(--bg-panel)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
              boxShadow: '0 16px 64px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 17, fontWeight: 600, color: colors.textWhite, marginBottom: 10 }}>
              Restart Roblox Required
            </div>
            <div style={{ fontSize: 13, color: colors.textMuted, lineHeight: 1.5, marginBottom: 18 }}>
              You must restart Roblox after enabling or disabling any client setting for the change to take effect.
            </div>

            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                fontSize: 13,
                color: colors.textWhite,
                marginBottom: 20,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={clientWarningDontShowAgain}
                onChange={(e) => setClientWarningDontShowAgain(e.target.checked)}
              />
              Don't show again
            </label>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                onClick={async () => {
                  if (clientWarningDontShowAgain) {
                    await persistClientWarningPreference(false);
                  }
                  setShowClientRestartWarning(false);
                }}
                style={{
                  background: accent.primary,
                  border: 'none',
                  borderRadius: 6,
                  padding: '9px 16px',
                  color: isLightAccent(accent.primary) ? 'var(--bg-main)' : colors.textWhite,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

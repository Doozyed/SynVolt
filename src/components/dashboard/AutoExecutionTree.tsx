import { isFavoriteByPath, toggleFavoriteByPath, subscribeToFavorites } from "../../stores/favoritesStore";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { exists, mkdir, readDir, writeTextFile } from "@tauri-apps/plugin-fs";
import { ChevronDown, ChevronRight, File, Folder, FolderPlus, Plus, Star } from "lucide-react";
import { getParentPath, joinPath } from "../../utils/filePaths";

import { fileStore } from "../../stores/fileStore";
import type { LibraryMove } from "./libraryMove";

interface Entry { relative: string; name: string; path: string; enabled: boolean; children?: Entry[] }

async function readTree(active: string, inactive: string, relative = ""): Promise<Entry[]> {
  const entries: Entry[] = [];
  const dirs = new Map<string, Entry>();
  for (const [root, enabled] of [[active, true], [inactive, false]] as const) {
    const directory = joinPath(root, relative);
    if (!(await exists(directory))) continue;
    for (const item of await readDir(directory)) {
      if (item.isSymlink) continue;
      const child = joinPath(relative, item.name);
      const entry: Entry = { relative: child, name: item.name, path: joinPath(root, child), enabled };
      if (item.isDirectory) {
        if (!dirs.has(item.name.toLowerCase())) dirs.set(item.name.toLowerCase(), entry);
      } else if (/\.luau?$/i.test(item.name)) entries.push(entry);
    }
  }
  for (const directory of dirs.values()) {
    directory.children = await readTree(active, inactive, directory.relative);
    entries.push(directory);
  }
  return entries.sort((a,b) => Number(!!b.children) - Number(!!a.children) || a.name.localeCompare(b.name));
}

export function AutoExecutionTree({ query, revision, onOpen, onMove }: {
  query: string; revision: unknown; onOpen: (path: string) => Promise<void>;
  onMove: (move: LibraryMove) => Promise<void>;
}) {
  const [root, setRoot] = useState("");
  const [, setFavoriteRevision] = useState(0);
  useEffect(() => subscribeToFavorites(() => setFavoriteRevision(n => n + 1)), []);
  const [tree, setTree] = useState<Entry[]>([]);
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState(new Set<string>());
  const [parent, setParent] = useState("");
  const [creating, setCreating] = useState<"file" | "folder" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [menu, setMenu] = useState<{ entry: Entry; x: number; y: number } | null>(null);
  const [choosingFolder, setChoosingFolder] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", escape);
    };
  }, [menu]);

  async function transfer(entry: Entry, to: LibraryMove["to"], destination?: string) {
    setMenu(null);
    const original = fileStore.getAllFiles().find(file => file.isAutoexec &&
      file.relativePath.split("\\").join("__").toLowerCase() === entry.relative.toLowerCase());
    try {
      await onMove({ from: entry.enabled ? "enabled" : "disabled", to, relative: entry.relative,
        oldPath: entry.path, destination: destination ?? (to === "scripts" ? original?.relativePath : undefined) });
    } catch (e) { setError(String(e)); }
  }
  useEffect(() => {
    let current = true;
    async function load() {
      const path = await invoke<string>("get_autoexec_path");
      const entries = await readTree(path, joinPath(getParentPath(path), "autoexec-disabled"));
      if (current) { setRoot(path); setTree(entries); setError(""); }
    }
    load().catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [revision, refresh]);

  function begin(kind: "file" | "folder") {
    setCreating(kind); setOpen(true); setName(""); setError("");
  }
  async function create() {
    const base = name.trim();
    if (!base || /[<>:"/\\|?*\x00-\x1f]/.test(base) || /[. ]$/.test(base)) {
      setError("Enter a valid file or folder name."); return;
    }
    const directory = joinPath(root, parent);
    const filename = creating === "file" && !/\.luau?$/i.test(base) ? base + ".lua" : base;
    const path = joinPath(directory, filename);
    try {
      await mkdir(directory, { recursive: true });
      if (creating === "folder") await mkdir(path);
      else await writeTextFile(path, "", { createNew: true });
      setExpanded(prev => new Set([...prev, parent]));
      setRefresh(n => n + 1); setCreating(null);
      if (creating === "file") await onOpen(path);
    } catch (e) { setError(String(e)); }
  }
  const needle = query.trim().toLowerCase();
  function matches(entry: Entry): boolean {
    return entry.name.toLowerCase().includes(needle) || !!entry.children?.some(matches);
  }
  function rows(entries: Entry[], depth: number, filter: boolean): React.ReactNode {
    return entries.filter(entry => !filter || matches(entry)).map(entry => {
      const folder = !!entry.children;
      const isOpen = expanded.has(entry.relative) || !!needle;
      return <div key={entry.path}>
        <div className="auto-entry-row">
        <button className="explorer-entry" style={{ paddingLeft: 10 + depth * 12 }}
          data-offline={!folder && !entry.enabled || undefined}
          title={folder ? entry.name : entry.enabled ? "Enabled" : "Disabled"}
          onContextMenu={e => {
            if (folder) return;
            e.preventDefault();
            setChoosingFolder(false);
            setMenu({ entry, x: Math.min(e.clientX, window.innerWidth - 160), y: Math.min(e.clientY, window.innerHeight - 72) });
          }}
          aria-pressed={folder && parent === entry.relative}
          onClick={() => {
            if (!folder) { onOpen(entry.path).catch(e => setError(String(e))); return; }
            setParent(parent === entry.relative ? "" : entry.relative);
            setExpanded(prev => { const next = new Set(prev); if (next.has(entry.relative)) next.delete(entry.relative); else next.add(entry.relative); return next; });
          }}>
          {folder ? (isOpen ? <ChevronDown size={11}/> : <ChevronRight size={11}/>) : <span style={{width:11}}/>}
          {folder ? <Folder size={12}/> : <File size={12}/>} {entry.name}
        </button>
        {!folder && <button type="button" className="favorite-star auto-favorite" aria-label={isFavoriteByPath(entry.path) ? 'Remove from favorites' : 'Add to favorites'} title={isFavoriteByPath(entry.path) ? 'Remove from favorites' : 'Add to favorites'} onClick={() => toggleFavoriteByPath(entry.path)}>
          <Star size={13} fill={isFavoriteByPath(entry.path) ? 'currentColor' : 'none'} />
        </button>}
        </div>
        {entry.children && isOpen && rows(entry.children, depth + 1, filter && !entry.name.toLowerCase().includes(needle))}
      </div>;
    });
  }
  return <>
    <div className="explorer-section">
      <button className="explorer-label" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? <ChevronDown/> : <ChevronRight/>} Auto Execution
      </button>
      <button disabled={!root} title="New auto-execution script" onClick={() => begin("file")}><Plus/></button>
      <button disabled={!root} title="New auto-execution folder" onClick={() => begin("folder")}><FolderPlus/></button>
    </div>
    {open && <>
      {creating && <form onSubmit={e => { e.preventDefault(); void create(); }}>
        <input className="explorer-create" autoFocus placeholder={creating === "file" ? "filename.lua" : "folder name"} value={name}
          onChange={e => setName(e.target.value)} onKeyDown={e => { if(e.key === "Escape") setCreating(null); }} />
      </form>}
      {rows(tree, 0, !!needle)}
    </>}
    {menu && <div className="explorer-context" role="menu" style={{ left: menu.x, top: menu.y }}>
      <button role="menuitem" onClick={() => transfer(menu.entry, menu.entry.enabled ? "disabled" : "enabled")}>{menu.entry.enabled ? "Disable" : "Enable"}</button>
      <button role="menuitem" onClick={() => transfer(menu.entry, "scripts")}>Move back to Scripts</button>
      <button role="menuitem" onClick={() => { toggleFavoriteByPath(menu.entry.path); setMenu(null); }}>{isFavoriteByPath(menu.entry.path) ? "Remove favorite" : "Add to favorites"}</button>
      <button role="menuitem" onClick={e => { e.stopPropagation(); setChoosingFolder(!choosingFolder); }}>Move to folder</button>
      {choosingFolder && <div style={{ maxHeight: 160, overflowY: "auto" }} onClick={e => e.stopPropagation()}>
        {(() => {
          const folders: string[] = [];
          function visit(entries: Entry[]) { for (const entry of entries) if (entry.children) { folders.push(entry.relative); visit(entry.children); } }
          visit(tree);
          if (getParentPath(menu.entry.relative)) folders.unshift("");
          const choices = folders.filter(folder => folder !== getParentPath(menu.entry.relative));
          return choices.length ? choices.map(folder => <button key={folder} role="menuitem" onClick={() => transfer(menu.entry, menu.entry.enabled ? "enabled" : "disabled", joinPath(folder, menu.entry.name))}>{folder || "Auto Execution"}</button>) : <span className="explorer-message">No other folders</span>;
        })()}
      </div>}
    </div>}
    {error && <div className="explorer-message" role="alert">{error}</div>}
  </>;
}

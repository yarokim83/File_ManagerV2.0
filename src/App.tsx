import React from 'react';
import { useDropzone } from 'react-dropzone';
import { Modal, Input, message, Spin, Dropdown, Table, Progress, Button, Tooltip, List, Space, Typography, Popconfirm, Avatar } from 'antd';
import { FolderFilled, SortAscendingOutlined, SortDescendingOutlined, CloudUploadOutlined, CloudDownloadOutlined, EditOutlined, LoadingOutlined, CheckCircleTwoTone, CloseCircleTwoTone, RedoOutlined, DeleteOutlined, ClockCircleOutlined } from '@ant-design/icons';

function App() {
  const [items, setItems] = React.useState<{ name: string; size: number; updated?: string }[]>([]);
  const [folders, setFolders] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  // Removed explicit error state; using message.error for user feedback
  const [downloadsDir, setDownloadsDir] = React.useState<string>('');
  const [ops, setOps] = React.useState<Record<string, { name: string; kind: 'upload'|'download'|'rename'; percent: number }>>({});
  const [prefix, setPrefix] = React.useState<string>('');
  const [renameModal, setRenameModal] = React.useState<{ open: boolean; src: string; value: string }>({ open: false, src: '', value: '' });
  const [hoveredFolder, setHoveredFolder] = React.useState<string | null>(null);
  const [folderSort, setFolderSort] = React.useState<'name'|'recent'>('name');
  const [sortKey, setSortKey] = React.useState<'name'|'size'|'updated'>('name');
  const [sortDir, setSortDir] = React.useState<'asc'|'desc'>('asc');
  // Column widths (resizable) with localStorage persistence
  type ColKey = 'name' | 'status' | 'path' | 'size' | 'updated';
  const [colW, setColW] = React.useState<Record<ColKey, number>>(() => {
    try {
      const raw = localStorage.getItem('table.colW');
      if (raw) return JSON.parse(raw);
    } catch {}
    return { name: 360, status: 160, path: 260, size: 110, updated: 180 };
  });
  React.useEffect(() => {
    try { localStorage.setItem('table.colW', JSON.stringify(colW)); } catch {}
  }, [colW]);
  // Drag-to-resize handlers
  const dragRef = React.useRef<{ key: ColKey; startX: number; startW: number } | null>(null);
  const onDragMove = React.useCallback((e: MouseEvent) => {
    const d = dragRef.current; if (!d) return;
    const dx = e.clientX - d.startX;
    const next = Math.max(80, d.startW + dx);
    setColW(prev => ({ ...prev, [d.key]: next }));
  }, []);
  const endDrag = React.useCallback(() => {
    if (!dragRef.current) return;
    dragRef.current = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', endDrag);
  }, [onDragMove]);
  const startDrag = (key: ColKey, e: React.MouseEvent) => {
    dragRef.current = { key, startX: e.clientX, startW: colW[key] };
    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', endDrag);
    e.preventDefault();
    e.stopPropagation();
  };
  // Cleanup listeners on unmount (safety)
  React.useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', endDrag);
    };
  }, [onDragMove, endDrag]);
  // Header renderer with resize handle
  const Header = (label: string, colKey: ColKey, sortable?: 'name'|'size'|'updated') => {
    const sortableActive = sortable && sortKey === sortable;
    const onClick = sortable ? (() => {
      if (sortKey === sortable) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
      else { setSortKey(sortable); setSortDir('asc'); }
    }) : undefined;
    return (
      <div style={{ position: 'relative', paddingRight: 6 }}>
        <span
          style={{ cursor: sortable ? 'pointer' : 'default', userSelect: 'none', color: sortableActive ? '#1677ff' : undefined }}
          onClick={onClick}
        >
          {label} {sortableActive ? (sortDir === 'asc' ? <SortAscendingOutlined /> : <SortDescendingOutlined />) : null}
        </span>
        <div
          onMouseDown={(e) => startDrag(colKey, e)}
          style={{ position: 'absolute', top: 0, right: 0, width: 6, cursor: 'col-resize', height: '100%' }}
          title="폭 조절"
        />
      </div>
    );
  };
  // search/query state
  const [query, setQuery] = React.useState('');
  const [lastQueryMs, setLastQueryMs] = React.useState(0);
  const [selectedKeys, setSelectedKeys] = React.useState<React.Key[]>([]);
  const [moveModal, setMoveModal] = React.useState<{ open: boolean; target: string; overwrite: boolean; busy?: boolean; progress?: { done: number; total: number; failed: number } }>({ open: false, target: '', overwrite: false });
  // Move folder picker state
  const [movePickerPrefix, setMovePickerPrefix] = React.useState<string>('');
  const [movePickerFolders, setMovePickerFolders] = React.useState<string[]>([]);
  const [movePickerLoading, setMovePickerLoading] = React.useState<boolean>(false);
  const [movePickerAsc, setMovePickerAsc] = React.useState<boolean>(true);
  const [movePickerIndex, setMovePickerIndex] = React.useState<number>(-1);
  const movePickerSortedFolders = React.useMemo(() => {
    return [...movePickerFolders].sort((a, b) => movePickerAsc ? a.localeCompare(b) : b.localeCompare(a));
  }, [movePickerFolders, movePickerAsc]);
  // Compute sorted folders for display: 'name' uses localeCompare(KO), 'recent' keeps original order
  const sortedFolders = React.useMemo(() => {
    if (folderSort !== 'name') return folders;
    const arr = [...folders];
    arr.sort((a, b) => {
      const sa = a.slice(prefix.length).replace(/\/$/, '');
      const sb = b.slice(prefix.length).replace(/\/$/, '');
      return sa.localeCompare(sb, 'ko');
    });
    return arr;
  }, [folders, folderSort, prefix]);
  const [ctxTarget, setCtxTarget] = React.useState<string | null>(null);
  // Failed operations by object name
  const [failed, setFailed] = React.useState<Record<string, { upload?: boolean; download?: boolean; rename?: boolean }>>({});
  // Minimal virtual scroll state
  const [rowH, setRowH] = React.useState(30);
  const [scrollY, setScrollY] = React.useState(560);
  const [autoScrollY, setAutoScrollY] = React.useState(true);
  const [vThreshold, setVThreshold] = React.useState(800); // enable virtualization when many rows
  const [vStart, setVStart] = React.useState(0);
  const vBuffer = 10;
  const tableWrapRef = React.useRef<HTMLDivElement | null>(null);
  // Compact header: toggle for showing drag & drop area
  const [showDrop, setShowDrop] = React.useState(false);
  const sortedItems = React.useMemo(() => {
    const arr = items.slice();
    const dirMul = sortDir === 'asc' ? 1 : -1;
    arr.sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name) * dirMul;
      if (sortKey === 'size') return ((a.size||0) - (b.size||0)) * dirMul;
      // updated
      const at = a.updated ? Date.parse(a.updated) : 0;
      const bt = b.updated ? Date.parse(b.updated) : 0;
      return (at - bt) * dirMul;
    });
    return arr;
  }, [items, sortKey, sortDir]);
  // debounced query filter
  function useDebounced<T>(value: T, ms: number) {
    const [v, setV] = React.useState(value);
    React.useEffect(() => {
      const id = setTimeout(() => setV(value), ms);
      return () => clearTimeout(id);
    }, [value, ms]);
    return v;
  }
  const debouncedQuery = useDebounced(query, 200);
  const displayItems = React.useMemo(() => {
    const t0 = performance.now();
    let arr = sortedItems;
    const q = debouncedQuery.trim();
    if (q) {
      const m = q.match(/ext:([\w]+)|size:([<>]=?|=)?(\d+)(kb|mb|gb)?/gi) || [];
      let ext: string | null = null;
      let sizeCmp: { op: string; bytes: number } | null = null;
      for (const token of m) {
        const extM = token.match(/^ext:(\w+)$/i);
        if (extM) ext = extM[1].toLowerCase();
        const sizeM = token.match(/^size:([<>]=?|=)?(\d+)(kb|mb|gb)?$/i);
        if (sizeM) {
          const op = sizeM[1] || '>';
          const num = Number(sizeM[2]);
          const unit = (sizeM[3] || '').toLowerCase();
          const mul = unit === 'gb' ? 1024*1024*1024 : unit === 'mb' ? 1024*1024 : unit === 'kb' ? 1024 : 1;
          sizeCmp = { op, bytes: num * mul };
        }
      }
      const text = q.replace(/ext:\w+|size:[^\s]+/gi, ' ').trim().toLowerCase();
      arr = arr.filter(it => {
        const rel = it.name.slice(prefix.length);
        if (ext && !rel.toLowerCase().endsWith('.' + ext)) return false;
        if (sizeCmp) {
          const s = it.size || 0;
          const b = sizeCmp.bytes;
          const op = sizeCmp.op;
          if (op === '>') { if (!(s > b)) return false; }
          else if (op === '>=') { if (!(s >= b)) return false; }
          else if (op === '<') { if (!(s < b)) return false; }
          else if (op === '<=') { if (!(s <= b)) return false; }
          else if (op === '=') { if (!(s === b)) return false; }
        }
        if (text) {
          return rel.toLowerCase().includes(text) || it.name.toLowerCase().includes(text);
        }
        return true;
      });
    }
    const ms = Math.max(0, Math.round(performance.now() - t0));
    setLastQueryMs(ms);
    return arr;
  }, [sortedItems, debouncedQuery, prefix]);
  // Virtual slice builder
  const vEnabled = displayItems.length > vThreshold;
  const vSlice = React.useMemo(() => {
    if (!vEnabled) return { data: displayItems, topPad: 0, botPad: 0 };
    const viewCnt = Math.max(1, Math.ceil(scrollY / Math.max(1, rowH)));
    const start = Math.max(0, Math.min(vStart, Math.max(0, displayItems.length - 1)));
    const end = Math.min(displayItems.length, start + viewCnt + vBuffer);
    const topPad = start * rowH;
    const botPad = Math.max(0, (displayItems.length - end) * rowH);
    const data: any[] = [];
    if (topPad) data.push({ __pad: '__top', __h: topPad });
    data.push(...displayItems.slice(start, end));
    if (botPad) data.push({ __pad: '__bottom', __h: botPad });
    return { data, topPad, botPad };
  }, [displayItems, vEnabled, vStart, scrollY, rowH]);
  // Attach scroll listener to table body
  React.useEffect(() => {
    if (!vEnabled) return;
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const body = wrap.querySelector('.ant-table-body');
    if (!body) return;
    const onScroll = () => {
      const st = (body as HTMLElement).scrollTop;
      setVStart(Math.floor(st / rowH));
      // persist scrollTop per prefix
      try {
        const key = 'scroll.pos.' + prefix;
        localStorage.setItem(key, String(st));
      } catch {}
    };
    body.addEventListener('scroll', onScroll);
    return () => { body.removeEventListener('scroll', onScroll as any); };
  }, [vEnabled, displayItems.length, rowH]);

  // Restore scrollTop per prefix when changing folder or data
  React.useEffect(() => {
    if (!vEnabled) return;
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const body = wrap.querySelector('.ant-table-body') as HTMLElement | null;
    if (!body) return;
    try {
      const key = 'scroll.pos.' + prefix;
      const saved = Number(localStorage.getItem(key) || 0);
      const maxScroll = Math.max(0, displayItems.length * rowH - scrollY);
      const target = Math.min(Math.max(0, saved), maxScroll);
      if (isFinite(target) && target >= 0) {
        body.scrollTop = target;
        setVStart(Math.floor(target / rowH));
      }
    } catch {}
  }, [prefix, vEnabled, displayItems.length, rowH, scrollY]);

  // Settings: load from localStorage once
  React.useEffect(() => {
    try {
      const sY = localStorage.getItem('ui.scrollY');
      const aY = localStorage.getItem('ui.autoScrollY');
      const vt = localStorage.getItem('ui.vThreshold');
      if (sY) setScrollY(Math.max(240, Number(sY)) || 560);
      if (aY != null) setAutoScrollY(aY === '1' || aY === 'true');
      if (vt) setVThreshold(Math.max(0, Number(vt)) || 800);
    } catch {}
  }, []);

  // Settings: persist changes
  React.useEffect(() => {
    try { localStorage.setItem('ui.scrollY', String(scrollY)); } catch {}
  }, [scrollY]);
  React.useEffect(() => {
    try { localStorage.setItem('ui.autoScrollY', autoScrollY ? '1' : '0'); } catch {}
  }, [autoScrollY]);
  React.useEffect(() => {
    try { localStorage.setItem('ui.vThreshold', String(vThreshold)); } catch {}
  }, [vThreshold]);

  // Auto compute scrollY by viewport height
  const recomputeScrollY = React.useCallback(() => {
    if (!autoScrollY) return;
    const wrap = tableWrapRef.current;
    const top = wrap?.getBoundingClientRect().top ?? 0;
    const footerReserve = 160; // space for status bar/margins
    const next = Math.max(240, Math.floor(window.innerHeight - top - footerReserve));
    if (Number.isFinite(next)) setScrollY(next);
  }, [autoScrollY]);

  React.useEffect(() => {
    if (!autoScrollY) return;
    const onResize = () => recomputeScrollY();
    // compute on mount and next frame (to ensure layout done)
    recomputeScrollY();
    const id = window.setTimeout(recomputeScrollY, 0);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); window.clearTimeout(id); };
  }, [autoScrollY, recomputeScrollY]);

  // Measure actual row height from a real (non-padding) row to improve accuracy
  React.useEffect(() => {
    const wrap = tableWrapRef.current;
    if (!wrap) return;
    const tr = wrap.querySelector('.ant-table-body tr[data-row-key]:not([data-row-key^="__"])') as HTMLElement | null;
    if (tr) {
      const h = tr.offsetHeight;
      if (h && Math.abs(h - rowH) > 2) setRowH(h);
    }
  }, [vSlice.data, displayItems.length]);

  // Selection refinement: prune selections not in current results and clear on prefix change
  React.useEffect(() => {
    const set = new Set(displayItems.map((it: any) => it.name));
    setSelectedKeys((prev: string[]) => prev.filter((k) => set.has(String(k))));
  }, [displayItems]);

  React.useEffect(() => {
    setSelectedKeys([]);
  }, [prefix]);
  // Create folder modal state
  const [createFolder, setCreateFolder] = React.useState<{ open: boolean; name: string }>({ open: false, name: '' });
  const [renameFolder, setRenameFolder] = React.useState<{ open: boolean; src: string; value: string }>({ open: false, src: '', value: '' });
  const [usage, setUsage] = React.useState<{ bytes: string; count: number } | null>(null);
  const [usageLoading, setUsageLoading] = React.useState(false);

  const formatBytes = React.useCallback((bytesStr?: string) => {
    if (!bytesStr) return '-';
    let n = Number(bytesStr);
    if (!isFinite(n) || isNaN(n)) return bytesStr;
    const units = ['B','KB','MB','GB','TB','PB','EB'];
    let u = 0;
    while (n >= 1024 && u < units.length - 1) { n /= 1024; u++; }
    if (u === 0) return `${Math.round(n)} ${units[u]}`;
    return `${n.toFixed(1)} ${units[u]}`;
  }, []);

  const warnedRef = React.useRef(false);
  const refreshUsage = React.useCallback(async () => {
    setUsageLoading(true);
    try {
      const res = await window.gcs.getBucketUsage(prefix ? { prefix } : undefined);
      setUsage(res);
    } catch (e: any) {
      if (!warnedRef.current) {
        warnedRef.current = true;
        message.warning('용량 조회에 실패했습니다. 잠시 후 다시 시도하세요.');
      }
    } finally {
      setUsageLoading(false);
    }
  }, [prefix]);

  const listObjects = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.gcs.list({ maxResults: 1000, prefix });
      setItems(res.items);
      // Keep server order; client applies optional name-sorting via sortedFolders
      setFolders(res.prefixes || []);
    } catch (e: any) {
      message.error(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  React.useEffect(() => {
    (async () => {
      try {
        const dir = await window.sys.downloadsDir();
        setDownloadsDir(dir);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Usage fetch on mount and when prefix changes
  React.useEffect(() => { refreshUsage(); }, [refreshUsage, prefix]);

  // Fetch whenever prefix changes
  React.useEffect(() => {
    listObjects();
  }, [listObjects]);

  // Subscribe to progress events (guarded for non-Electron browser context)
  React.useEffect(() => {
    if (!(window as any).gcs || typeof window.gcs.onProgress !== 'function') {
      return; // running in pure browser (CRA) without Electron preload
    }
    const off = window.gcs.onProgress((p) => {
      if (p.phase === 'progress') {
        const percent = Math.round(p.percent ?? 0);
        setOps(prev => ({ ...prev, [p.opId]: { name: p.name, kind: p.kind, percent } }));
      } else if (p.phase === 'done') {
        setOps(prev => {
          const n = { ...prev };
          delete n[p.opId];
          return n;
        });
        if (p.kind === 'upload') {
          listObjects();
          refreshUsage();
        }
        if (p.kind === 'download' && p.savedTo) {
          message.success(`다운로드 완료: ${p.savedTo}`);
        }
        if (p.kind === 'rename') {
          listObjects();
          refreshUsage();
          const failed = p.failed || [];
          if (failed.length) {
            Modal.error({
              title: '일부 파일 이름변경 실패',
              content: (
                <div>
                  <div>실패한 파일들:</div>
                  <ul style={{ marginTop: 8 }}>
                    {failed.map((f: any) => <li key={f.src || f}><code>{f.src || f}</code></li>)}
                  </ul>
                </div>
              ),
            });
          } else {
            message.success('폴더 이름변경 완료');
          }
        }
      } else if (p.phase === 'error') {
        setOps(prev => {
          const n = { ...prev };
          delete n[p.opId];
          return n;
        });
        // Track failed operations
        setFailed(prev => {
          const n = { ...prev };
          if (!n[p.name]) n[p.name] = {};
          if (p.kind === 'upload') n[p.name].upload = true;
          else if (p.kind === 'download') n[p.name].download = true;
          else if (p.kind === 'rename') n[p.name].rename = true;
          return n;
        });
        message.error(p.message || '작업 실패');
      }
    });
    return () => { try { off && off(); } catch {} };
  }, [listObjects, refreshUsage]);

  const pickAndUpload = async () => {
    try {
      const paths = await window.sys.openFiles();
      for (const p of paths) {
        const base = p.split(/\\|\//).pop() as string; // filename only
        const dest = `${prefix}${base}`;
        let overwrite = false;
        try {
          const { exists } = await window.gcs.exists(dest);
          if (exists) {
            try {
              await new Promise<void>((resolve, reject) => {
                Modal.confirm({
                  title: '덮어쓰기 확인',
                  content: <div><code>{dest}</code> 가 이미 존재합니다. 덮어쓰시겠습니까?</div>,
                  okText: '덮어쓰기',
                  cancelText: '취소',
                  onOk: () => resolve(),
                  onCancel: () => reject(new Error('CANCEL')),
                });
              });
              overwrite = true;
            } catch (e: any) {
              continue; // user canceled overwrite -> skip this file
            }
          }
        } catch {
          // if exists check fails, proceed as non-overwrite
        }
        const { opId } = await window.gcs.startUploadLocal(p, dest, overwrite);
        setOps(prev => ({ ...prev, [opId]: { name: dest, kind: 'upload', percent: 0 } }));
        // Optimistic UI
        setItems(prev => (prev.some(it => it.name === dest) ? prev : [{ name: dest, size: 0 }, ...prev]));
      }
      // List will refresh on 'done' events
    } catch (e: any) {
      message.error(e?.message || String(e));
    }
  };

  // Retry helpers
  const retryUpload = async (name: string) => {
    try {
      const paths = await window.sys.openFiles();
      if (!paths || !paths.length) return;
      const src = paths[0];
      const overwrite = true; // retry implies allow overwrite to same name
      const { opId } = await window.gcs.startUploadLocal(src, name, overwrite);
      setOps(prev => ({ ...prev, [opId]: { name, kind: 'upload', percent: 0 } }));
      setFailed(f => { const n = { ...f }; if (n[name]) { delete n[name].upload; if (!n[name].download && !n[name].rename) delete n[name]; } return n; });
    } catch (e: any) {
      message.error(e?.message || String(e));
    }
  };
  const retryDownload = async (name: string) => {
    try {
      const base = name.split('/').pop() as string;
      const suggested = `${downloadsDir}\\${base}`;
      const pick = await window.sys.saveFile(suggested);
      if (pick.canceled || !pick.filePath) return;
      const { opId } = await window.gcs.startDownload(name, pick.filePath);
      setOps(prev => ({ ...prev, [opId]: { name, kind: 'download', percent: 0 } }));
      setFailed(f => { const n = { ...f }; if (n[name]) { delete n[name].download; if (!n[name].upload && !n[name].rename) delete n[name]; } return n; });
    } catch (e: any) {
      message.error(e?.message || String(e));
    }
  };

  // Load subfolders for move picker when modal opens or picker prefix changes
  React.useEffect(() => {
    const load = async () => {
      if (!moveModal.open) return;
      setMovePickerLoading(true);
      try {
        const res = await window.gcs.list({ maxResults: 1000, prefix: movePickerPrefix });
        setMovePickerFolders((res.prefixes || []));
      } catch (e: any) {
        message.error(e?.message || String(e));
      } finally {
        setMovePickerLoading(false);
      }
    };
    load();
  }, [moveModal.open, movePickerPrefix]);

  // Reset/adjust focused index when list changes or opens
  React.useEffect(() => {
    if (!moveModal.open) return;
    setMovePickerIndex(movePickerSortedFolders.length ? 0 : -1);
  }, [moveModal.open, movePickerPrefix, movePickerFolders, movePickerAsc]);

  // Context menu via AntD Dropdown - no custom outside click handling needed

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success('복사됨');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
        message.success('복사됨');
      } catch (e: any) {
        message.error(e?.message || '복사 실패');
      }
    }
  };

  const ctxDownload = () => { if (ctxTarget) downloadItem(ctxTarget); setCtxTarget(null); };
  const ctxDelete = () => { if (ctxTarget) deleteItem(ctxTarget); setCtxTarget(null); };
  const ctxRename = () => { if (ctxTarget) openRename(ctxTarget); setCtxTarget(null); };
  const ctxMove = () => { openMoveSelected(); setCtxTarget(null); };
  const ctxCopyPath = () => { if (ctxTarget) copyToClipboard(ctxTarget); setCtxTarget(null); };
  const ctxCopyFile = () => { if (ctxTarget) { const base = ctxTarget.split('/').pop() as string; copyToClipboard(base); } setCtxTarget(null); };

  const downloadItem = async (name: string) => {
    try {
      // Ask user where to save
      const base = name.split('/').pop() as string;
      const suggested = `${downloadsDir}\\${base}`;
      const pick = await window.sys.saveFile(suggested);
      if (pick.canceled || !pick.filePath) return;
      const { opId } = await window.gcs.startDownload(name, pick.filePath);
      setOps(prev => ({ ...prev, [opId]: { name, kind: 'download', percent: 0 } }));
    } catch (e: any) {
      message.error(e?.message || String(e));
    }
  };

  const handleDrop = React.useCallback(async (acceptedFiles: File[]) => {
    try {
      for (const file of acceptedFiles) {
        const dest = `${prefix}${file.name}`;
        let overwrite = false;
        try {
          const { exists } = await window.gcs.exists(dest);
          if (exists) {
            try {
              await new Promise<void>((resolve, reject) => {
                Modal.confirm({
                  title: '덮어쓰기 확인',
                  content: <div><code>{dest}</code> 가 이미 존재합니다. 덮어쓰시겠습니까?</div>,
                  okText: '덮어쓰기',
                  cancelText: '취소',
                  onOk: () => resolve(),
                  onCancel: () => reject(new Error('CANCEL')),
                });
              });
              overwrite = true;
            } catch (e: any) {
              continue; // user canceled overwrite -> skip this file
            }
          }
        } catch {
          // proceed
        }
        const buf = await file.arrayBuffer();
        const { opId } = await window.gcs.startUploadBuffer(buf, dest, overwrite);
        setOps(prev => ({ ...prev, [opId]: { name: dest, kind: 'upload', percent: 0 } }));
        setItems(prev => (prev.some(it => it.name === dest) ? prev : [{ name: dest, size: file.size }, ...prev]));
      }
      // list refresh handled by progress listener
    } catch (e: any) {
      message.error(e?.message || String(e));
    }
  }, [prefix]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: handleDrop, multiple: true });

  const cancelOp = async (opId: string) => {
    try { await window.gcs.cancel(opId); } catch {}
    setOps(prev => { const n = { ...prev }; delete n[opId]; return n; });
  };

  const deleteItem = (name: string) => {
    Modal.confirm({
      title: '삭제 확인',
      content: <div><code>{name}</code> 를 삭제하시겠습니까?</div>,
      okText: '삭제',
      okButtonProps: { danger: true },
      cancelText: '취소',
      onOk: async () => {
        try {
          await window.gcs.delete(name);
          await listObjects();
          message.success('삭제 완료');
        } catch (e: any) {
          message.error(e?.message || String(e));
        }
      },
    });
  };

  const openRename = (name: string) => {
    const base = name.split('/').pop() as string;
    setRenameModal({ open: true, src: name, value: `${prefix}${base}` });
  };

  const handleRenameOk = async () => {
    const { src, value } = renameModal;
    if (!value || value === src) {
      setRenameModal({ open: false, src: '', value: '' });
      return;
    }
    try {
      let overwrite = false;
      try {
        const { exists } = await window.gcs.exists(value);
        if (exists) {
          await new Promise<void>((resolve, reject) => {
            Modal.confirm({
              title: '덮어쓰기 확인',
              content: <div><code>{value}</code> 가 이미 존재합니다. 덮어쓰시겠습니까?</div>,
              okText: '덮어쓰기',
              cancelText: '취소',
              onOk: () => resolve(),
              onCancel: () => reject(new Error('CANCEL')),
            });
          });
          overwrite = true;
        }
      } catch (e: any) {
        if (e && e.message === 'CANCEL') {
          return; // user canceled overwrite
        }
        // proceed if exists check failed
      }
      await window.gcs.rename(src, value, overwrite);
      message.success('이름변경 완료');
      await listObjects();
    } catch (e: any) {
      message.error(e?.message || String(e));
    } finally {
      setRenameModal({ open: false, src: '', value: '' });
    }
  };

  const handleRenameCancel = () => setRenameModal({ open: false, src: '', value: '' });

  // Helpers for moving
  const normPrefix = (p: string) => (p && !p.endsWith('/') ? p + '/' : p);
  const openMoveSelected = () => {
    const defTarget = prefix; // default to current folder
    setMoveModal({ open: true, target: defTarget, overwrite: false, busy: false, progress: undefined });
    setMovePickerPrefix(defTarget);
  };
  const handleConfirmMove = async () => {
    if (moveModal.busy) return;
    const targetRaw = (moveModal.target || '').trim();
    const target = normPrefix(targetRaw);
    if (target === prefix) {
      message.warning('현재 폴더와 대상 폴더가 같습니다');
      return;
    }
    if (selectedKeys.length === 0) { message.warning('이동할 항목을 선택하세요'); return; }
    setMoveModal(m => ({ ...m, busy: true, progress: { done: 0, total: selectedKeys.length, failed: 0 } }));
    let done = 0, failed = 0;
    for (const key of selectedKeys) {
      const name = String(key);
      const base = name.split('/').pop() as string;
      const dest = `${target}${base}`;
      try {
        await window.gcs.rename(name, dest, moveModal.overwrite);
      } catch (e: any) {
        failed++;
      } finally {
        done++;
        setMoveModal(m => ({ ...m, progress: { done, total: selectedKeys.length, failed } }));
      }
    }
    setMoveModal({ open: false, target: '', overwrite: false, busy: false, progress: undefined });
    await listObjects();
    await refreshUsage();
    setSelectedKeys([]);
    if (failed) message.warning(`이동 완료: 성공 ${selectedKeys.length - failed}개, 실패 ${failed}개`);
    else message.success(`이동 완료: ${selectedKeys.length}개`);
  };

  return (
    <div style={{fontFamily: 'sans-serif', padding: 16}}>
      {/* Top toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <h2 style={{ margin: 0 }}>GCS File Manager</h2>
          <span style={{ color: '#999', fontSize: 12 }}>React · Electron · GCS</span>
        </div>
        <Space size={6} wrap>
          <Tooltip title="목록 새로고침">
            <Button size="small" onClick={listObjects} loading={loading}>갱신</Button>
          </Tooltip>
          <Tooltip title="파일 선택하여 업로드">
            <Button size="small" icon={<CloudUploadOutlined />} onClick={pickAndUpload} disabled={loading}>업로드</Button>
          </Tooltip>
          <Tooltip title="새 폴더">
            <Button size="small" onClick={() => setCreateFolder({ open: true, name: '' })} disabled={loading}>새 폴더</Button>
          </Tooltip>
          <span style={{ color: '#555', marginLeft: 4 }}>
            {usageLoading ? '용량 조회 중…' : (usage ? `용량 ${formatBytes(usage.bytes)} • ${usage.count.toLocaleString()}개` : '-')}
          </span>
          <Tooltip title="용량 새로고침">
            <Button size="small" onClick={refreshUsage}>↻</Button>
          </Tooltip>
        </Space>
      </div>
      {/* Search + quick toggles */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
        <Input
          placeholder="검색 (예: beam ext:xlsx size:>5MB)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ maxWidth: 420 }}
        />
        <span style={{ color: '#888' }}>결과 {displayItems.length.toLocaleString()}개 • {lastQueryMs}ms</span>
        <Button type="link" size="small" onClick={() => setShowDrop(s => !s)}>
          {showDrop ? '드래그 영역 숨기기' : '드래그 영역 열기'}
        </Button>
      </div>
      {/* Breadcrumb (moved up to reduce vertical gaps) */}
      <div style={{ margin: '4px 0', color: '#555' }}>
        <strong>경로:</strong>{' '}
        <span style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => setPrefix('')}>root</span>
        {prefix.split('/').filter(Boolean).map((seg, idx, arr) => {
          const to = arr.slice(0, idx + 1).join('/') + '/';
          return (
            <span key={to}>
              {' / '}
              <span style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => setPrefix(to)}>{seg}</span>
            </span>
          );
        })}
      </div>
      {/* Collapsible drag & drop area */}
      {showDrop && (
        <div {...getRootProps()} style={{
          border: '1px dashed #bbb',
          padding: 12,
          borderRadius: 8,
          background: isDragActive ? '#f0fbff' : '#fafafa',
          color: '#555',
          marginBottom: 10
        }}>
          <input {...getInputProps()} />
          {isDragActive ? (
            <p style={{ margin: 0 }}>여기에 파일을 놓아 업로드하세요…</p>
          ) : (
            <p style={{ margin: 0 }}>또는 이 영역에 파일을 드래그 앤 드롭 하세요</p>
          )}
        </div>
      )}
      {!!Object.keys(ops).length && (
        <div style={{ marginBottom: 16 }}>
          <h3>진행 중 작업</h3>
          {Object.entries(ops).map(([id, o]) => (
            <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 80 }}>{o.kind.toUpperCase()}</span>
              <code style={{ flex: 1 }}>{o.name}</code>
              <div style={{ width: 160, background: '#eee', borderRadius: 6, overflow: 'hidden' }}>
                <div style={{ width: `${o.percent}%`, background: '#1890ff', color: 'white', textAlign: 'center' }}>{o.percent}%</div>
              </div>
              <button onClick={() => cancelOp(id)}>취소</button>
            </div>
          ))}
        </div>
      )}
      {/* Breadcrumb moved above */}
      {/* Folders and Files */}
      <Spin spinning={loading} tip="불러오는 중…">
        {/* Folders quick list */}
        {folders.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0' }}>
              <h3 style={{ margin: 0 }}>폴더</h3>
              <Space size={4}>
                <Tooltip title="가나다순">
                  <Button
                    size="small"
                    type={folderSort === 'name' ? 'primary' : 'default'}
                    icon={<SortAscendingOutlined />}
                    onClick={() => setFolderSort('name')}
                  />
                </Tooltip>
                <Tooltip title="최근">
                  <Button
                    size="small"
                    type={folderSort === 'recent' ? 'primary' : 'default'}
                    icon={<ClockCircleOutlined />}
                    onClick={() => setFolderSort('recent')}
                  />
                </Tooltip>
              </Space>
            </div>
            <List
              size="small"
              dataSource={sortedFolders}
              renderItem={(full: string) => {
                const seg = full.slice(prefix.length).replace(/\/$/, '');
                return (
                  <List.Item
                    key={full}
                    onMouseEnter={() => setHoveredFolder(full)}
                    onMouseLeave={() => setHoveredFolder(h => (h === full ? null : h))}
                    onDoubleClick={() => setPrefix(full)}
                    actions={[
                      <div key="actions" style={{ visibility: hoveredFolder === full ? 'visible' : 'hidden' }}>
                        <Space size={6}>
                          <Button size="small" type="link" icon={<FolderFilled />} onClick={() => setPrefix(full)}>
                            열기
                          </Button>
                          <Button size="small" onClick={() => setRenameModal({ open: true, src: full, value: seg })} icon={<EditOutlined />}>
                            이름변경
                          </Button>
                          <Popconfirm
                            title="폴더 삭제 확인"
                            description={(
                              <div>
                                <code>{full}</code> 및 하위 모든 파일을 삭제하시겠습니까?
                              </div>
                            ) as any}
                            okText="삭제"
                            cancelText="취소"
                            okButtonProps={{ danger: true }}
                            onConfirm={async () => {
                              try {
                                await window.gcs.deletePrefix(full);
                                await listObjects();
                                message.success('폴더 삭제 완료');
                              } catch (e: any) {
                                message.error(e?.message || String(e));
                              }
                            }}
                          >
                            <Button size="small" danger icon={<DeleteOutlined />}>삭제</Button>
                          </Popconfirm>
                        </Space>
                      </div>
                    ]}
                  >
                    <List.Item.Meta
                      avatar={<Avatar size={20} shape="square" style={{ background: 'transparent', color: '#1677ff' }} icon={<FolderFilled />} />}
                      title={
                        <Typography.Text
                          strong
                          ellipsis={{ tooltip: full }}
                          style={{ maxWidth: '100%', cursor: 'pointer' }}
                          onClick={() => setPrefix(full)}
                        >
                          {seg}
                        </Typography.Text>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </div>
        )}

        {/* Files list with Dropdown context menu */}
        <Dropdown
          trigger={["contextMenu"]}
          onOpenChange={(open) => { if (!open) setCtxTarget(null); }}
          menu={{
            items: [
              { key: 'download', label: '다운로드' },
              { type: 'divider' },
              { key: 'copyPath', label: '경로 복사    Ctrl+Shift+C' },
              { key: 'copyFile', label: '파일명 복사    Ctrl+C' },
              { type: 'divider' },
              { key: 'move', label: '이동    M' },
              { key: 'rename', label: '이름변경    F2' },
              { key: 'delete', label: '삭제    Del' },
            ],
            onClick: (e) => {
              const map: Record<string, () => void> = {
                download: ctxDownload,
                copyPath: ctxCopyPath,
                copyFile: ctxCopyFile,
                move: ctxMove,
                rename: ctxRename,
                delete: ctxDelete,
              };
              const fn = map[e.key as string];
              if (fn) fn();
            },
          }}
        >
          <div
            ref={tableWrapRef}
            style={{ width: '100%' }}
            onContextMenu={(e) => {
              const el = e.target as HTMLElement;
              const tr = el.closest('tr[data-row-key]') as HTMLElement | null;
              if (tr) {
                const key = tr.getAttribute('data-row-key');
                // ignore padding rows
                if (key && key.startsWith('__')) return;
                if (key) setCtxTarget(key);
              }
            }}
          >
          <style>{`
            /* Compact spacing */
            .ant-table-thead > tr > th { padding: 6px 8px; }
            .ant-table-tbody > tr > td { padding: 6px 8px; }
            .ant-table { font-size: 12.5px; }
            .ant-list-item { padding: 6px 8px; }
            h3, h4 { margin: 8px 0; }
            /* Keep upload highlighting */
            .row-uploading td { background-color: #fff7e6; }
          `}</style>
          <Table
            size="small"
            pagination={false}
            rowKey={(r: any) => (r && r.__pad) ? r.__pad : r.name}
            dataSource={vSlice.data as any}
            scroll={{ x: colW.name + colW.status + colW.path + colW.size + colW.updated + 200, y: scrollY }}
            sticky={{ offsetHeader: 0 }}
            rowSelection={{
              // disable selection for padding rows
              selectedRowKeys: selectedKeys,
              onChange: (keys) => setSelectedKeys((keys as React.Key[]).filter((k) => typeof k === 'string' && !String(k).startsWith('__')) as string[]),
              getCheckboxProps: (record: any) => ({ disabled: !!record?.__pad }),
              hideSelectAll: true,
            }}
            onRow={(record: any) => ({
              onClick: (e) => { if (record?.__pad) e.stopPropagation(); },
              onDoubleClick: (e) => { if (record?.__pad) e.stopPropagation(); },
              onContextMenu: (e) => { if (record?.__pad) e.preventDefault(); },
            })}
            columns={[
              {
                title: Header('이름', 'name', 'name'),
                dataIndex: 'name',
                key: 'name',
                width: colW.name,
                fixed: 'left' as const,
                render: (v: string, it: any) => it && it.__pad ? (
                  <div style={{ height: it.__h }} />
                ) : <code>{v.slice(prefix.length)}</code>,
              },
              {
                title: Header('상태', 'status'),
                key: 'status',
                width: colW.status,
                render: (_: any, it: any) => {
                  if (it && it.__pad) return null;
                  const uploading = Object.values(ops).find(o => o.kind === 'upload' && o.name === it.name);
                  if (uploading) {
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <LoadingOutlined style={{ color: '#1677ff' }} />
                        <span style={{ color: '#1677ff' }}>업로드 중</span>
                        <Progress percent={uploading.percent} size="small" style={{ flex: 1, minWidth: 80 }} />
                      </div>
                    );
                  }
                  const fail = failed[it.name];
                  if (fail?.upload) {
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CloseCircleTwoTone twoToneColor="#ff4d4f" />
                        <Button size="small" type="link" icon={<RedoOutlined />} onClick={() => retryUpload(it.name)}>재시도</Button>
                      </div>
                    );
                  }
                  if (fail?.download) {
                    return (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <CloseCircleTwoTone twoToneColor="#ff4d4f" />
                        <Button size="small" type="link" icon={<RedoOutlined />} onClick={() => retryDownload(it.name)}>재시도</Button>
                      </div>
                    );
                  }
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <CheckCircleTwoTone twoToneColor="#52c41a" />
                      <span style={{ color: '#52c41a' }}>완료</span>
                    </div>
                  );
                },
              },
              {
                title: Header('경로', 'path'),
                key: 'path',
                width: colW.path,
                render: (_: any, it: any) => {
                  if (it && it.__pad) return null;
                  const idx = it.name.lastIndexOf('/');
                  const p = idx >= 0 ? it.name.slice(0, idx + 1) : '';
                  return <span style={{ color: '#666' }}>{p}</span>;
                },
              },
              {
                title: Header('크기', 'size', 'size'),
                dataIndex: 'size',
                key: 'size',
                width: colW.size,
                align: 'right' as const,
                render: (v: number, it: any) => it && it.__pad ? null : <span>{formatBytes(String(v || 0))}</span>,
              },
              {
                title: Header('수정일', 'updated', 'updated'),
                dataIndex: 'updated',
                key: 'updated',
                width: colW.updated,
                fixed: 'right' as const,
                render: (_: any, it: any) => {
                  if (it && it.__pad) return null;
                  return it.updated ? new Date(it.updated).toLocaleString() : '-';
                },
              },
            ]}
          />
          </div>
        </Dropdown>
      </Spin>
      {/* Status bar */}
      <div style={{ marginTop: 8, paddingTop: 6, borderTop: '1px solid #eee', color: '#666', display: 'flex', gap: 12 }}>
        <span>표시: {displayItems.length.toLocaleString()}개</span>
        <span>선택: {selectedKeys.length.toLocaleString()}개</span>
        {Object.keys(ops).length > 0 && (
          <span style={{ color: '#1677ff' }}>
            <LoadingOutlined /> 진행 중: {Object.keys(ops).length}개
          </span>
        )}
        {Object.keys(failed).length > 0 && (
          <span style={{ color: '#ff4d4f' }}>
            <CloseCircleTwoTone twoToneColor="#ff4d4f" /> 실패: {Object.keys(failed).length}개
          </span>
        )}
      </div>
      {/* Error banner removed; using message.error */}
      {/* Rename Modal */}
      <Modal
        open={renameModal.open}
        title="이름변경"
        onOk={handleRenameOk}
        onCancel={handleRenameCancel}
        okText="변경"
        cancelText="취소"
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input
            autoFocus
            value={renameModal.value}
            onChange={(e) => setRenameModal(prev => ({ ...prev, value: e.target.value }))}
          />
          <div><small>원본: <code>{renameModal.src}</code></small></div>
        </div>
      </Modal>
      {/* Dropdown handles context menu; no custom overlay needed */}
      {/* Move Selected Modal */}
      <Modal
        open={moveModal.open}
        title="선택 항목 이동"
        onCancel={() => (!moveModal.busy ? setMoveModal({ open: false, target: '', overwrite: false }) : null)}
        okText={moveModal.busy ? '이동 중…' : '이동'}
        okButtonProps={{ disabled: moveModal.busy }}
        cancelButtonProps={{ disabled: moveModal.busy }}
        onOk={handleConfirmMove}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div><small>선택: {selectedKeys.length}개</small></div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <small>현재 대상:</small>
            <code>{moveModal.target || 'root'}</code>
            <button
              disabled={moveModal.busy}
              onClick={() => setMoveModal(m => ({ ...m, target: movePickerPrefix }))}
              style={{ marginLeft: 'auto' }}
            >이 폴더 선택</button>
          </div>
          {/* Breadcrumb for picker + sort controls */}
          <div style={{ color: '#555', display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1 }}>
              <strong>이동할 폴더 선택:</strong>{' '}
              <span style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => setMovePickerPrefix('')}>root</span>
              {movePickerPrefix.split('/').filter(Boolean).map((seg, idx, arr) => {
                const to = arr.slice(0, idx + 1).join('/') + '/';
                return (
                  <span key={to}>
                    {' / '}
                    <span style={{ cursor: 'pointer', color: '#1890ff' }} onClick={() => setMovePickerPrefix(to)}>{seg}</span>
                  </span>
                );
              })}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <small>정렬:</small>
              <button onClick={() => setMovePickerAsc(true)} disabled={movePickerAsc} title="이름 오름차순">
                <SortAscendingOutlined />
              </button>
              <button onClick={() => setMovePickerAsc(false)} disabled={!movePickerAsc} title="이름 내림차순">
                <SortDescendingOutlined />
              </button>
              <small style={{ color: '#888' }}>({movePickerFolders.length})</small>
            </div>
          </div>
          {/* Child folders list */}
          <div
            style={{ maxHeight: 220, overflow: 'auto', border: '1px solid #eee', borderRadius: 6, padding: 8, background: '#fafafa' }}
            tabIndex={0}
            onKeyDown={(e) => {
              if (movePickerSortedFolders.length === 0) return;
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setMovePickerIndex(i => {
                  const ni = Math.min((i < 0 ? 0 : i) + 1, movePickerSortedFolders.length - 1);
                  setTimeout(() => document.getElementById(`move-folder-${ni}`)?.scrollIntoView({ block: 'nearest' }), 0);
                  return ni;
                });
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setMovePickerIndex(i => {
                  const ni = Math.max((i < 0 ? 0 : i) - 1, 0);
                  setTimeout(() => document.getElementById(`move-folder-${ni}`)?.scrollIntoView({ block: 'nearest' }), 0);
                  return ni;
                });
              } else if (e.key === 'Enter') {
                e.preventDefault();
                const full = movePickerSortedFolders[Math.max(0, movePickerIndex)];
                if (full) setMovePickerPrefix(full);
              }
            }}
            role="listbox"
            aria-label="이동 대상 하위 폴더"
          >
            {movePickerLoading ? (
              <div style={{ color: '#888' }}>불러오는 중…</div>
            ) : (
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {movePickerFolders.length === 0 && (
                  <li style={{ color: '#888' }}>하위 폴더가 없습니다</li>
                )}
                {movePickerSortedFolders.map((full, i) => {
                  const seg = full.slice(movePickerPrefix.length).replace(/\/$/, '');
                  return (
                    <li
                      key={full}
                      id={`move-folder-${i}`}
                      role="option"
                      aria-selected={i === movePickerIndex}
                      onClick={() => { setMovePickerIndex(i); setMovePickerPrefix(full); }}
                      onMouseEnter={() => setMovePickerIndex(i)}
                      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 6px', cursor: 'pointer', borderRadius: 4, background: i === movePickerIndex ? '#e6f4ff' : undefined }}
                    >
                      <FolderFilled style={{ color: '#faad14' }} />
                      <strong>{seg}</strong>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={moveModal.overwrite} onChange={(e) => setMoveModal(m => ({ ...m, overwrite: e.target.checked }))} />
            덮어쓰기 허용
          </label>
          {moveModal.progress && (
            <div style={{ color: '#666' }}>진행: {moveModal.progress.done}/{moveModal.progress.total} • 실패 {moveModal.progress.failed}</div>
          )}
        </div>
      </Modal>
      {/* Create Folder Modal */}
      <Modal
        open={createFolder.open}
        title="새 폴더 만들기"
        okText="생성"
        cancelText="취소"
        onCancel={() => setCreateFolder({ open: false, name: '' })}
        onOk={async () => {
          const raw = (createFolder.name || '').trim();
          if (!raw) { message.warning('폴더 이름을 입력하세요'); return; }
          if (raw.includes('/')) { message.warning('폴더 이름에 "/" 를 포함할 수 없습니다'); return; }
          const full = `${prefix}${raw}/`;
          try {
            await window.gcs.createPrefix(full);
            message.success('폴더가 생성되었습니다');
            setCreateFolder({ open: false, name: '' });
            await listObjects();
          } catch (e: any) {
            message.error(e?.message || String(e));
          }
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div><small>현재 경로: <code>{prefix || 'root'}</code></small></div>
          <Input
            placeholder="새 폴더 이름"
            value={createFolder.name}
            onChange={(e) => setCreateFolder({ open: true, name: e.target.value })}
            onPressEnter={(e) => {
              e.preventDefault();
              const el = document.activeElement as HTMLElement | null;
              if (el && typeof el.blur === 'function') el.blur();
            }}
          />
        </div>
      </Modal>
      {/* Rename Folder Modal */}
      <Modal
        open={renameFolder.open}
        title="폴더 이름변경"
        okText="변경"
        cancelText="취소"
        onCancel={() => setRenameFolder({ open: false, src: '', value: '' })}
        onOk={async () => {
          const src = renameFolder.src; // full prefix e.g. a/b/
          const newName = (renameFolder.value || '').trim();
          if (!src) { setRenameFolder({ open: false, src: '', value: '' }); return; }
          if (!newName) { message.warning('새 폴더 이름을 입력하세요'); return; }
          if (newName.includes('/')) { message.warning('폴더 이름에 "/" 를 포함할 수 없습니다'); return; }
          // parent is current prefix (the list context)
          const dest = `${prefix}${newName}/`;
          if (dest === src) { setRenameFolder({ open: false, src: '', value: '' }); return; }
          try {
            // probe if destination exists by listing one item
            let overwrite = false;
            try {
              const probe = await window.gcs.list({ prefix: dest, maxResults: 1 });
              const has = (probe.items && probe.items.length > 0) || (probe.prefixes && probe.prefixes.length > 0);
              if (has) {
                await new Promise<void>((resolve, reject) => {
                  Modal.confirm({
                    title: '덮어쓰기 확인',
                    content: <div><code>{dest}</code> 가 이미 존재합니다. 덮어쓰시겠습니까?</div>,
                    okText: '덮어쓰기',
                    cancelText: '취소',
                    onOk: () => resolve(),
                    onCancel: () => reject(new Error('CANCEL')),
                  });
                });
                overwrite = true;
              }
            } catch (e: any) {
              if (e && e.message === 'CANCEL') return; // user canceled
            }
            const { opId } = await window.gcs.startRenamePrefix(src, dest, overwrite);
            setOps(prev => ({ ...prev, [opId]: { name: `${src} -> ${dest}`, kind: 'rename', percent: 0 } }));
            setRenameFolder({ open: false, src: '', value: '' });
          } catch (e: any) {
            message.error(e?.message || String(e));
          }
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div><small>원본: <code>{renameFolder.src}</code></small></div>
          <Input
            autoFocus
            placeholder="새 폴더 이름"
            value={renameFolder.value}
            onChange={(e) => setRenameFolder(prev => ({ ...prev, value: e.target.value }))}
          />
        </div>
      </Modal>
    </div>
  );
}

// Helper component to render server-provided folders and files for a prefix
function FolderAndFileList(props: { items: { name: string; size: number; updated?: string }[]; folders: string[]; prefix: string; onEnterFolder: (childPrefix: string) => void; onDeleteFolder: (fullPrefix: string) => void; onRenameFolder: (fullPrefix: string) => void; onDownload: (name: string) => void; onDelete: (name: string) => void; onRename: (name: string) => void; }) {
  const { items, folders, prefix, onEnterFolder, onDeleteFolder, onRenameFolder, onDownload, onDelete, onRename } = props;
  // Sorting derived from parent settings via context would be ideal; for now, keep alphabetical for folders and compute in parent for files
  // Spinner wraps the lists using parent loading state by proximity (handled outside via overall UI)
  const fileList = React.useMemo(() => items.slice(), [items]);
  return (
    <div>
      {/* Folders */}
      {folders.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <h3 style={{ margin: '8px 0' }}>폴더</h3>
          <ul>
            {folders.map(full => {
              // full is like `${prefix}name/`
              const seg = full.slice(prefix.length).replace(/\/$/, '');
              return (
                <li key={full} style={{ marginBottom: 4 }}>
                  <button onClick={() => onEnterFolder(full)} style={{ marginRight: 8 }}>열기</button>
                  <strong>{seg}</strong>
                  <button onClick={() => onRenameFolder(full)} style={{ marginLeft: 8 }}>이름변경</button>
                  <button onClick={() => onDeleteFolder(full)} style={{ marginLeft: 8 }}>삭제</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {/* Files */}
      <h3 style={{ margin: '8px 0' }}>파일</h3>
      <ul>
        {fileList.map(it => {
          const rel = it.name.slice(prefix.length);
          return (
            <li key={it.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1 }}>
                <code>{rel}</code> {it.size ? `(${it.size} bytes)` : ''} {it.updated ? `- ${new Date(it.updated).toLocaleString()}` : ''}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => onDownload(it.name)}>다운로드</button>
                <button onClick={() => onDelete(it.name)}>삭제</button>
                <button onClick={() => onRename(it.name)}>이름변경</button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default App;

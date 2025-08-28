import React from 'react';
import { useDropzone } from 'react-dropzone';
import { Modal, Input, message, Spin } from 'antd';

function App() {
  const [items, setItems] = React.useState<{ name: string; size: number; updated?: string }[]>([]);
  const [folders, setFolders] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  // Removed explicit error state; using message.error for user feedback
  const [downloadsDir, setDownloadsDir] = React.useState<string>('');
  const [ops, setOps] = React.useState<Record<string, { name: string; kind: 'upload'|'download'; percent: number }>>({});
  const [prefix, setPrefix] = React.useState<string>('');
  const [renameModal, setRenameModal] = React.useState<{ open: boolean; src: string; value: string }>({ open: false, src: '', value: '' });
  const [sortKey, setSortKey] = React.useState<'name'|'size'|'updated'>('name');
  const [sortDir, setSortDir] = React.useState<'asc'|'desc'>('asc');
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

  const listObjects = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await window.gcs.list({ maxResults: 1000, prefix });
      setItems(res.items);
      setFolders((res.prefixes || []).sort((a,b)=>a.localeCompare(b)));
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

  // Fetch whenever prefix changes
  React.useEffect(() => {
    listObjects();
  }, [listObjects]);

  // Subscribe to progress events
  React.useEffect(() => {
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
        // Refresh list after uploads complete
        if (p.kind === 'upload') {
          listObjects();
        }
        if (p.kind === 'download' && p.savedTo) {
          message.success(`다운로드 완료: ${p.savedTo}`);
        }
      } else if (p.phase === 'error') {
        setOps(prev => {
          const n = { ...prev };
          delete n[p.opId];
          return n;
        });
        message.error(p.message || '작업 실패');
      }
    });
    return () => off();
  }, []);

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

  return (
    <div style={{fontFamily: 'sans-serif', padding: 24}}>
      <h1>GCS File Manager</h1>
      <p>React + Electron + GCS 연결</p>
      <div style={{ marginBottom: 12 }}>
        <button onClick={listObjects} disabled={loading} style={{ marginRight: 8 }}>
          {loading ? '불러오는 중…' : '목록 새로고침'}
        </button>
        <button onClick={pickAndUpload} disabled={loading}>파일 선택하여 업로드</button>
      </div>
      {/* Sorting controls */}
      <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span>정렬:</span>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value as any)}>
          <option value="name">이름</option>
          <option value="size">크기</option>
          <option value="updated">수정일</option>
        </select>
        <select value={sortDir} onChange={(e) => setSortDir(e.target.value as any)}>
          <option value="asc">오름차순</option>
          <option value="desc">내림차순</option>
        </select>
      </div>
      <div {...getRootProps()} style={{
        border: '2px dashed #999',
        padding: 24,
        borderRadius: 8,
        background: isDragActive ? '#f0fbff' : '#fafafa',
        color: '#555',
        marginBottom: 16
      }}>
        <input {...getInputProps()} />
        {isDragActive ? (
          <p>여기에 파일을 놓아 업로드하세요…</p>
        ) : (
          <p>또는 이 영역에 파일을 드래그 앤 드롭 하세요</p>
        )}
      </div>
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
      {/* Breadcrumb */}
      <div style={{ margin: '8px 0' }}>
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
      {/* Folders from server-side prefixes */}
      <Spin spinning={loading} tip="불러오는 중…">
        <FolderAndFileList
          items={sortedItems}
          folders={folders}
          prefix={prefix}
          onEnterFolder={(childFullPrefix) => setPrefix(childFullPrefix)}
          onDownload={downloadItem}
          onDelete={deleteItem}
          onRename={openRename}
        />
      </Spin>
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
    </div>
  );
}

// Helper component to render server-provided folders and files for a prefix
function FolderAndFileList(props: { items: { name: string; size: number; updated?: string }[]; folders: string[]; prefix: string; onEnterFolder: (childPrefix: string) => void; onDownload: (name: string) => void; onDelete: (name: string) => void; onRename: (name: string) => void; }) {
  const { items, folders, prefix, onEnterFolder, onDownload, onDelete, onRename } = props;
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

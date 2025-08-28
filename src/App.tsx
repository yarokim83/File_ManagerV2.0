import React from 'react';
import { useDropzone } from 'react-dropzone';

function App() {
  const [items, setItems] = React.useState<{ name: string; size: number; updated?: string }[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [downloadsDir, setDownloadsDir] = React.useState<string>('');
  const [ops, setOps] = React.useState<Record<string, { name: string; kind: 'upload'|'download'; percent: number }>>({});
  const [prefix, setPrefix] = React.useState<string>('');

  const listObjects = async () => {
    setLoading(true);
    setError(null);
    try {
      // Get more items to increase the chance newly uploaded files appear
      const res = await window.gcs.list({ maxResults: 1000, prefix: '' });
      setItems(res.items);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

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

  // Subscribe to progress events
  React.useEffect(() => {
    const off = window.gcs.onProgress((p) => {
      if (p.phase === 'progress') {
        setOps(prev => ({ ...prev, [p.opId]: { name: p.name, kind: p.kind, percent: p.percent ?? 0 } }));
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
          alert(`다운로드 완료: ${p.savedTo}`);
        }
      } else if (p.phase === 'error') {
        setOps(prev => {
          const n = { ...prev };
          delete n[p.opId];
          return n;
        });
        setError(p.message || '작업 실패');
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
            overwrite = window.confirm(`같은 이름의 파일이 이미 존재합니다.\n\n${dest}\n\n덮어쓰시겠습니까?`);
            if (!overwrite) {
              continue; // skip this file
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
      setError(e?.message || String(e));
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
      setError(e?.message || String(e));
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
            overwrite = window.confirm(`같은 이름의 파일이 이미 존재합니다.\n\n${dest}\n\n덮어쓰시겠습니까?`);
            if (!overwrite) {
              continue;
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
      setError(e?.message || String(e));
    }
  }, [listObjects, prefix]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: handleDrop, multiple: true });

  const cancelOp = async (opId: string) => {
    try { await window.gcs.cancel(opId); } catch {}
    setOps(prev => { const n = { ...prev }; delete n[opId]; return n; });
  };

  return (
    <div style={{fontFamily: 'sans-serif', padding: 24}}>
      <h1>GCS File Manager</h1>
      <p>React + Electron + GCS 연결</p>
      <div style={{ marginBottom: 12 }}>
        <button onClick={listObjects} disabled={loading} style={{ marginRight: 8 }}>
          {loading ? '불러오는 중...' : '목록 새로고침'}
        </button>
        <button onClick={pickAndUpload}>파일 선택하여 업로드</button>
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
      {/* Folder list derived from items */}
      <FolderAndFileList items={items} prefix={prefix} onEnterFolder={(f) => setPrefix(prefix + f + '/')} onDownload={downloadItem} />
      {error && <div style={{ color: 'red' }}>에러: {error}</div>}
    </div>
  );
}

// Helper component to render folders and files for a prefix
function FolderAndFileList(props: { items: { name: string; size: number; updated?: string }[]; prefix: string; onEnterFolder: (folder: string) => void; onDownload: (name: string) => void; }) {
  const { items, prefix, onEnterFolder, onDownload } = props;
  const folders = new Set<string>();
  const files: { name: string; size: number; updated?: string }[] = [];
  for (const it of items) {
    if (!it.name.startsWith(prefix)) continue;
    const rest = it.name.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash >= 0) {
      const folder = rest.slice(0, slash);
      if (folder) folders.add(folder);
    } else {
      files.push(it);
    }
  }
  const folderList = Array.from(folders).sort((a,b)=>a.localeCompare(b));
  const fileList = files.sort((a,b)=>a.name.localeCompare(b.name));
  return (
    <div>
      {/* Folders */}
      {folderList.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <h3 style={{ margin: '8px 0' }}>폴더</h3>
          <ul>
            {folderList.map(f => (
              <li key={f} style={{ marginBottom: 4 }}>
                <button onClick={() => onEnterFolder(f)} style={{ marginRight: 8 }}>열기</button>
                <strong>{f}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {/* Files */}
      <h3 style={{ margin: '8px 0' }}>파일</h3>
      <ul>
        {fileList.map(it => {
          const rel = it.name.slice(prefix.length);
          return (
            <li key={it.name} style={{ marginBottom: 6 }}>
              <code>{rel}</code> {it.size ? `(${it.size} bytes)` : ''} {it.updated ? `- ${new Date(it.updated).toLocaleString()}` : ''}
              <button style={{ marginLeft: 8 }} onClick={() => onDownload(it.name)}>다운로드</button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default App;

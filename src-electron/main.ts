import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import isDev from 'electron-is-dev';
import path from 'path';
import fs from 'fs';
import { Storage } from '@google-cloud/storage';
import { Readable } from 'stream';

let mainWindow: BrowserWindow | null = null;

// Resolve asset path both in dev (cwd) and prod (packaged next to dist/)
const assetPath = (name: string) => {
  if (isDev) return path.join(process.cwd(), 'assets', name);
  return path.join(__dirname, '..', 'assets', name);
};

// Disable GPU acceleration to avoid GPU process crashes on some Windows environments
app.disableHardwareAcceleration();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: process.platform === 'win32' ? assetPath('app-icon-v2.ico') : (process.platform === 'darwin' ? assetPath('icon.icns') : assetPath('icon.png')),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // preload compiled to dist/preload.js
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:3000');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '..', 'build', 'index.html');
    mainWindow.loadFile(indexPath);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Set AppUserModelID for Windows taskbar grouping and notifications
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.gcs.filemanager.v2');
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// --- GCS IPC handlers ---
const storage = new Storage();
const BUCKET_NAME = process.env.GCS_BUCKET || 'hpntfiles';

// Operation registry for cancelation
type OpRecord = {
  id: string;
  type: 'upload' | 'download' | 'rename';
  name: string;
  read?: fs.ReadStream | Readable;
  write?: fs.WriteStream | NodeJS.WritableStream;
};
const operations = new Map<string, OpRecord>();
const genId = () => Math.random().toString(36).slice(2, 10);

const sendProgress = (win: BrowserWindow, payload: any) => {
  win.webContents.send('gcs:progress', payload);
};

// Utility: expose Downloads directory for saving files
ipcMain.handle('sys:downloadsDir', async () => {
  return app.getPath('downloads');
});

ipcMain.handle('sys:openFiles', async (_evt, options: { filters?: { name: string; extensions: string[] }[] } = {}) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: options.filters,
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle('sys:saveFile', async (_evt, args: { defaultPath?: string } = {}) => {
  const result = await dialog.showSaveDialog({
    defaultPath: args?.defaultPath,
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  return { canceled: false, filePath: result.filePath };
});

ipcMain.handle('gcs:list', async (_evt, args: { prefix?: string; pageToken?: string; maxResults?: number } = {}) => {
  const { prefix, pageToken, maxResults = 1000 } = args || {};
  const bucket = storage.bucket(BUCKET_NAME);
  const [files, nextQuery, apiResponse] = await bucket.getFiles({
    prefix: prefix || undefined,
    delimiter: '/',
    autoPaginate: false,
    pageToken,
    maxResults,
  } as any);
  const prefixes: string[] = (apiResponse as any)?.prefixes || [];
  return {
    items: files.map(f => ({ name: f.name, size: Number(f.metadata?.size || 0), updated: f.metadata?.updated })),
    prefixes,
    nextPageToken: (nextQuery as any)?.pageToken || null,
  };
});

ipcMain.handle('gcs:exists', async (_evt, args: { objectName: string }) => {
  const { objectName } = args;
  const [exists] = await storage.bucket(BUCKET_NAME).file(objectName).exists();
  return { exists };
});

ipcMain.handle('gcs:delete', async (_evt, args: { objectName: string }) => {
  const { objectName } = args;
  const fileRef = storage.bucket(BUCKET_NAME).file(objectName);
  await fileRef.delete({ ignoreNotFound: true } as any);
  return { deleted: true };
});

// Rename a folder prefix by copying all objects to a new prefix and deleting the old ones
ipcMain.handle('gcs:renamePrefix', async (_evt, args: { srcPrefix: string; destPrefix: string; overwrite?: boolean }) => {
  let { srcPrefix, destPrefix, overwrite = false } = args;
  if (!srcPrefix || !destPrefix) throw new Error('srcPrefix and destPrefix are required');
  const normSrc = srcPrefix.endsWith('/') ? srcPrefix : `${srcPrefix}/`;
  const normDest = destPrefix.endsWith('/') ? destPrefix : `${destPrefix}/`;
  if (normSrc === normDest) return { renamed: false, message: 'same prefix' };

  const bucket = storage.bucket(BUCKET_NAME);
  const [srcFiles] = await bucket.getFiles({ prefix: normSrc, autoPaginate: false, maxResults: 1 } as any);
  if (!srcFiles.length) throw new Error(`원본 프리픽스에 파일이 없습니다: ${normSrc}`);

  // Check dest existence
  const [destProbe] = await bucket.getFiles({ prefix: normDest, autoPaginate: false, maxResults: 1 } as any);
  if (destProbe.length) {
    if (!overwrite) throw new Error(`대상 프리픽스가 이미 존재합니다: ${normDest}`);
    // Clear destination if overwrite
    await bucket.deleteFiles({ prefix: normDest });
  }

  // Fetch all source files (auto paginate)
  const [allSrcFiles] = await bucket.getFiles({ prefix: normSrc } as any);
  let copied = 0;
  for (const f of allSrcFiles) {
    const rel = f.name.slice(normSrc.length);
    const destName = normDest + rel;
    await f.copy(bucket.file(destName));
    copied++;
  }

  // Delete source prefix
  await bucket.deleteFiles({ prefix: normSrc });
  return { renamed: true, copied };
});

// Start async rename with progress events
ipcMain.handle('gcs:startRenamePrefix', async (evt, args: { srcPrefix: string; destPrefix: string; overwrite?: boolean }) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return;
  let { srcPrefix, destPrefix, overwrite = false } = args;
  if (!srcPrefix || !destPrefix) throw new Error('srcPrefix and destPrefix are required');
  const normSrc = srcPrefix.endsWith('/') ? srcPrefix : `${srcPrefix}/`;
  const normDest = destPrefix.endsWith('/') ? destPrefix : `${destPrefix}/`;
  if (normSrc === normDest) throw new Error('same prefix');

  const bucket = storage.bucket(BUCKET_NAME);
  const [srcProbe] = await bucket.getFiles({ prefix: normSrc, autoPaginate: false, maxResults: 1 } as any);
  if (!srcProbe.length) throw new Error(`원본 프리픽스에 파일이 없습니다: ${normSrc}`);
  const [destProbe] = await bucket.getFiles({ prefix: normDest, autoPaginate: false, maxResults: 1 } as any);
  if (destProbe.length && !overwrite) throw new Error(`대상 프리픽스가 이미 존재합니다: ${normDest}`);

  const id = genId();
  operations.set(id, { id, type: 'rename', name: `${normSrc} -> ${normDest}` });

  // Run async but return opId immediately
  ;(async () => {
    try {
      if (destProbe.length && overwrite) {
        await bucket.deleteFiles({ prefix: normDest });
      }
      const [allSrcFiles] = await bucket.getFiles({ prefix: normSrc } as any);
      const total = allSrcFiles.length;
      let copied = 0;
      const failed: { src: string; error: string }[] = [];
      for (const f of allSrcFiles) {
        const rel = f.name.slice(normSrc.length);
        const destName = normDest + rel;
        try {
          await f.copy(bucket.file(destName));
          copied++;
          if (win) sendProgress(win, { opId: id, kind: 'rename', name: `${normSrc} -> ${normDest}`, phase: 'progress', count: copied, total, percent: total ? Math.round((copied/total)*100) : 0, current: f.name });
        } catch (e: any) {
          failed.push({ src: f.name, error: String(e?.message || e) });
          if (win) sendProgress(win, { opId: id, kind: 'rename', name: `${normSrc} -> ${normDest}`, phase: 'progress', count: copied, total, percent: total ? Math.round((copied/total)*100) : 0, current: f.name, failedCount: failed.length });
        }
      }
      // Attempt delete regardless of failures: delete only if any files exist
      try {
        await bucket.deleteFiles({ prefix: normSrc });
      } catch {}
      if (win) sendProgress(win, { opId: id, kind: 'rename', name: `${normSrc} -> ${normDest}`, phase: 'done', copied, failed });
    } catch (err: any) {
      if (win) sendProgress(win, { opId: id, kind: 'rename', name: `${normSrc} -> ${normDest}`, phase: 'error', message: String(err?.message || err) });
    } finally {
      operations.delete(id);
    }
  })();

  return { opId: id };
});

ipcMain.handle('gcs:rename', async (_evt, args: { src: string; dest: string; overwrite?: boolean }) => {
  const { src, dest, overwrite = false } = args;
  const bucket = storage.bucket(BUCKET_NAME);
  const srcRef = bucket.file(src);
  const destRef = bucket.file(dest);
  const [srcExists] = await srcRef.exists();
  if (!srcExists) throw new Error(`원본이 존재하지 않습니다: ${src}`);
  const [destExists] = await destRef.exists();
  if (destExists) {
    if (!overwrite) throw new Error(`대상에 이미 존재합니다: ${dest}`);
    await destRef.delete();
  }
  await srcRef.copy(destRef);
  await srcRef.delete({ ignoreNotFound: true } as any);
  return { name: dest };
});

// Get bucket (or prefix) usage: total bytes and object count
ipcMain.handle('gcs:getBucketUsage', async (_evt, args?: { prefix?: string }) => {
  const bucket = storage.bucket(BUCKET_NAME);
  const prefix = args?.prefix;
  const stream = bucket.getFilesStream(prefix ? { prefix } as any : undefined as any);
  let count = 0;
  let total = BigInt(0);
  await new Promise<void>((resolve, reject) => {
    stream
      .on('data', (file: any) => {
        try {
          const sz = BigInt(file?.metadata?.size ?? 0);
          total += sz;
          count += 1;
        } catch {
          // ignore malformed size
        }
      })
      .on('error', (err: any) => reject(err))
      .on('end', () => resolve());
  });
  return { bytes: total.toString(), count };
});

// Create a 'folder' by creating an empty object whose name ends with '/'
ipcMain.handle('gcs:createPrefix', async (_evt, args: { prefix: string }) => {
  const { prefix } = args;
  if (!prefix) throw new Error('prefix is required');
  const norm = prefix.endsWith('/') ? prefix : `${prefix}/`;
  const bucket = storage.bucket(BUCKET_NAME);
  const fileRef = bucket.file(norm);
  // If already exists, just return idempotently
  const [exists] = await fileRef.exists();
  if (!exists) {
    await fileRef.save(Buffer.alloc(0));
  }
  return { created: true, name: norm };
});

// Delete all objects under a prefix (including an optional directory marker)
ipcMain.handle('gcs:deletePrefix', async (_evt, args: { prefix: string }) => {
  const { prefix } = args;
  if (!prefix) throw new Error('prefix is required');
  const bucket = storage.bucket(BUCKET_NAME);
  // Use helper to delete all files with the given prefix
  await bucket.deleteFiles({ prefix });
  // Return basic result
  return { deleted: true };
});

ipcMain.handle('gcs:upload', async (_evt, args: { localPath: string; destination: string; overwrite?: boolean }) => {
  const { localPath, destination, overwrite = false } = args;
  if (!fs.existsSync(localPath)) throw new Error(`Local file not found: ${localPath}`);

  const fileRef = storage.bucket(BUCKET_NAME).file(destination);
  const [exists] = await fileRef.exists();
  if (exists && !overwrite) {
    throw new Error(`이미 같은 이름의 파일이 존재합니다: ${destination}`);
  }
  const [file] = await fileRef.bucket.upload(localPath, { destination });
  return { name: file.name, overwritten: !!exists };
});

ipcMain.handle('gcs:download', async (_evt, args: { objectName: string; localPath: string }) => {
  const { objectName, localPath } = args;
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = storage.bucket(BUCKET_NAME).file(objectName);
  await file.download({ destination: localPath });
  return { savedTo: localPath };
});

ipcMain.handle('gcs:uploadBuffer', async (_evt, args: { data: ArrayBuffer; destination: string; overwrite?: boolean }) => {
  const { data, destination, overwrite = false } = args;
  const fileRef = storage.bucket(BUCKET_NAME).file(destination);
  const [exists] = await fileRef.exists();
  if (exists && !overwrite) {
    throw new Error(`이미 같은 이름의 파일이 존재합니다: ${destination}`);
  }
  const buffer = Buffer.from(new Uint8Array(data));
  await fileRef.save(buffer);
  return { name: destination, overwritten: !!exists };
});

// Streaming with progress: Local file upload
ipcMain.handle('gcs:startUploadLocal', async (evt, args: { localPath: string; destination: string; overwrite?: boolean }) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return;
  const { localPath, destination, overwrite = false } = args;
  if (!fs.existsSync(localPath)) throw new Error(`Local file not found: ${localPath}`);
  const fileRef = storage.bucket(BUCKET_NAME).file(destination);
  const [exists] = await fileRef.exists();
  if (exists && !overwrite) throw new Error(`이미 같은 이름의 파일이 존재합니다: ${destination}`);

  const stat = fs.statSync(localPath);
  const total = stat.size;
  const id = genId();
  const read = fs.createReadStream(localPath);
  const write = fileRef.createWriteStream();
  operations.set(id, { id, type: 'upload', name: destination, read, write });

  let sent = 0;
  read.on('data', (chunk) => {
    sent += chunk.length;
    if (win) sendProgress(win, { opId: id, kind: 'upload', name: destination, phase: 'progress', transferred: sent, total, percent: total ? Math.round((sent / total) * 100) : 0 });
  });
  write.on('finish', () => {
    if (win) sendProgress(win, { opId: id, kind: 'upload', name: destination, phase: 'done' });
    operations.delete(id);
  });
  const onErr = (err: any) => {
    if (win) sendProgress(win, { opId: id, kind: 'upload', name: destination, phase: 'error', message: String(err?.message || err) });
    operations.delete(id);
  };
  read.on('error', onErr);
  write.on('error', onErr);

  read.pipe(write);
  return { opId: id };
});

// Streaming with progress: Buffer upload
ipcMain.handle('gcs:startUploadBuffer', async (evt, args: { data: ArrayBuffer; destination: string; overwrite?: boolean }) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return;
  const { data, destination, overwrite = false } = args;
  const fileRef = storage.bucket(BUCKET_NAME).file(destination);
  const [exists] = await fileRef.exists();
  if (exists && !overwrite) throw new Error(`이미 같은 이름의 파일이 존재합니다: ${destination}`);

  const buffer = Buffer.from(new Uint8Array(data));
  const total = buffer.length;
  const id = genId();
  const read = Readable.from(buffer);
  const write = fileRef.createWriteStream();
  operations.set(id, { id, type: 'upload', name: destination, read, write });

  let sent = 0;
  read.on('data', (chunk: Buffer) => {
    sent += chunk.length;
    if (win) sendProgress(win, { opId: id, kind: 'upload', name: destination, phase: 'progress', transferred: sent, total, percent: total ? Math.round((sent / total) * 100) : 0 });
  });
  write.on('finish', () => {
    if (win) sendProgress(win, { opId: id, kind: 'upload', name: destination, phase: 'done' });
    operations.delete(id);
  });
  const onErr = (err: any) => {
    if (win) sendProgress(win, { opId: id, kind: 'upload', name: destination, phase: 'error', message: String(err?.message || err) });
    operations.delete(id);
  };
  read.on('error', onErr);
  write.on('error', onErr);

  read.pipe(write);
  return { opId: id };
});

// Streaming with progress: Download
ipcMain.handle('gcs:startDownload', async (evt, args: { objectName: string; localPath: string }) => {
  const win = BrowserWindow.fromWebContents(evt.sender);
  if (!win) return;
  const { objectName, localPath } = args;
  const dir = path.dirname(localPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fileRef = storage.bucket(BUCKET_NAME).file(objectName);
  const [meta] = await fileRef.getMetadata();
  const total = Number(meta.size || 0);
  const id = genId();
  const read = fileRef.createReadStream();
  const write = fs.createWriteStream(localPath);
  operations.set(id, { id, type: 'download', name: objectName, read, write });
  let got = 0;
  read.on('data', (chunk: Buffer) => {
    got += chunk.length;
    if (win) sendProgress(win, { opId: id, kind: 'download', name: objectName, phase: 'progress', transferred: got, total, percent: total ? Math.round((got / total) * 100) : 0 });
  });
  write.on('finish', () => {
    if (win) sendProgress(win, { opId: id, kind: 'download', name: objectName, phase: 'done', savedTo: localPath });
    operations.delete(id);
  });
  const onErr = (err: any) => {
    if (win) sendProgress(win, { opId: id, kind: 'download', name: objectName, phase: 'error', message: String(err?.message || err) });
    operations.delete(id);
  };
  read.on('error', onErr);
  write.on('error', onErr);
  read.pipe(write);
  return { opId: id };
});

ipcMain.handle('gcs:cancel', async (_evt, args: { opId: string }) => {
  const rec = operations.get(args.opId);
  if (rec) {
    try { (rec.read as any)?.destroy?.(); } catch {}
    try { (rec.write as any)?.destroy?.(); } catch {}
    operations.delete(args.opId);
  }
  return { canceled: !!rec };
});

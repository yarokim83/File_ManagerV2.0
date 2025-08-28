import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import isDev from 'electron-is-dev';
import path from 'path';
import fs from 'fs';
import { Storage } from '@google-cloud/storage';
import { Readable } from 'stream';

let mainWindow: BrowserWindow | null = null;

// Disable GPU acceleration to avoid GPU process crashes on some Windows environments
app.disableHardwareAcceleration();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

app.whenReady().then(createWindow);

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
  type: 'upload' | 'download';
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
  const [files, nextQuery] = await storage.bucket(BUCKET_NAME).getFiles({ prefix, autoPaginate: false, pageToken, maxResults });
  return {
    items: files.map(f => ({ name: f.name, size: Number(f.metadata?.size || 0), updated: f.metadata?.updated })),
    nextPageToken: (nextQuery as any)?.pageToken || null,
  };
});

ipcMain.handle('gcs:exists', async (_evt, args: { objectName: string }) => {
  const { objectName } = args;
  const [exists] = await storage.bucket(BUCKET_NAME).file(objectName).exists();
  return { exists };
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

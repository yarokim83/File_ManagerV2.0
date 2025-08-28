import { contextBridge, ipcRenderer } from 'electron';

// Progress event fan-out inside preload (kept simple)
const progressListeners = new Set<(payload: any) => void>();
ipcRenderer.on('gcs:progress', (_evt, payload) => {
  progressListeners.forEach(cb => cb(payload));
});

contextBridge.exposeInMainWorld('gcs', {
  list: async (args: { prefix?: string; pageToken?: string; maxResults?: number } = {}) => {
    return ipcRenderer.invoke('gcs:list', args);
  },
  upload: async (localPath: string, destination: string, overwrite?: boolean) => {
    return ipcRenderer.invoke('gcs:upload', { localPath, destination, overwrite });
  },
  uploadBuffer: async (data: ArrayBuffer, destination: string, overwrite?: boolean) => {
    return ipcRenderer.invoke('gcs:uploadBuffer', { data, destination, overwrite });
  },
  // Progress-capable streaming ops
  startUploadLocal: async (localPath: string, destination: string, overwrite?: boolean) => {
    return ipcRenderer.invoke('gcs:startUploadLocal', { localPath, destination, overwrite });
  },
  startUploadBuffer: async (data: ArrayBuffer, destination: string, overwrite?: boolean) => {
    return ipcRenderer.invoke('gcs:startUploadBuffer', { data, destination, overwrite });
  },
  startDownload: async (objectName: string, localPath: string) => {
    return ipcRenderer.invoke('gcs:startDownload', { objectName, localPath });
  },
  cancel: async (opId: string) => {
    return ipcRenderer.invoke('gcs:cancel', { opId });
  },
  download: async (objectName: string, localPath: string) => {
    return ipcRenderer.invoke('gcs:download', { objectName, localPath });
  },
  exists: async (objectName: string) => {
    return ipcRenderer.invoke('gcs:exists', { objectName });
  },
  onProgress: (cb: (payload: any) => void) => {
    progressListeners.add(cb);
    return () => progressListeners.delete(cb);
  },
  delete: async (objectName: string) => {
    return ipcRenderer.invoke('gcs:delete', { objectName });
  },
  rename: async (src: string, dest: string, overwrite?: boolean) => {
    return ipcRenderer.invoke('gcs:rename', { src, dest, overwrite });
  },
});

contextBridge.exposeInMainWorld('sys', {
  downloadsDir: async () => ipcRenderer.invoke('sys:downloadsDir'),
  openFiles: async (options?: { filters?: { name: string; extensions: string[] }[] }) =>
    ipcRenderer.invoke('sys:openFiles', options ?? {}),
  saveFile: async (defaultPath?: string) => ipcRenderer.invoke('sys:saveFile', { defaultPath }),
});

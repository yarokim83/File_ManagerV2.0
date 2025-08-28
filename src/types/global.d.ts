export {};

declare global {
  interface Window {
    gcs: {
      list: (args?: { prefix?: string; pageToken?: string; maxResults?: number }) => Promise<{ items: { name: string; size: number; updated?: string }[]; nextPageToken?: string | null }>;
      upload: (localPath: string, destination: string, overwrite?: boolean) => Promise<{ name: string; overwritten?: boolean }>;
      uploadBuffer: (data: ArrayBuffer, destination: string, overwrite?: boolean) => Promise<{ name: string; overwritten?: boolean }>;
      startUploadLocal: (localPath: string, destination: string, overwrite?: boolean) => Promise<{ opId: string }>;
      startUploadBuffer: (data: ArrayBuffer, destination: string, overwrite?: boolean) => Promise<{ opId: string }>;
      startDownload: (objectName: string, localPath: string) => Promise<{ opId: string }>;
      cancel: (opId: string) => Promise<{ canceled: boolean }>;
      download: (objectName: string, localPath: string) => Promise<{ savedTo: string }>;
      exists: (objectName: string) => Promise<{ exists: boolean }>;
      onProgress: (cb: (payload: { opId: string; kind: 'upload' | 'download'; name: string; phase: 'progress' | 'done' | 'error'; transferred?: number; total?: number; percent?: number; message?: string; savedTo?: string; }) => void) => () => void;
    };
    sys: {
      downloadsDir: () => Promise<string>;
      openFiles: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string[]>;
      saveFile: (defaultPath?: string) => Promise<{ canceled: boolean; filePath?: string }>;
    };
  }
}

export {};

declare global {
  interface Window {
    gcs: {
      list: (args?: { prefix?: string; pageToken?: string; maxResults?: number }) => Promise<{ items: { name: string; size: number; updated?: string }[]; prefixes?: string[]; nextPageToken?: string | null }>;
      upload: (localPath: string, destination: string, overwrite?: boolean) => Promise<{ name: string; overwritten?: boolean }>;
      uploadBuffer: (data: ArrayBuffer, destination: string, overwrite?: boolean) => Promise<{ name: string; overwritten?: boolean }>;
      startUploadLocal: (localPath: string, destination: string, overwrite?: boolean) => Promise<{ opId: string }>;
      startUploadBuffer: (data: ArrayBuffer, destination: string, overwrite?: boolean) => Promise<{ opId: string }>;
      startDownload: (objectName: string, localPath: string) => Promise<{ opId: string }>;
      cancel: (opId: string) => Promise<{ canceled: boolean }>;
      download: (objectName: string, localPath: string) => Promise<{ savedTo: string }>;
      exists: (objectName: string) => Promise<{ exists: boolean }>;
      delete: (objectName: string) => Promise<{ deleted: boolean }>;
      rename: (src: string, dest: string, overwrite?: boolean) => Promise<{ name: string }>;
      renamePrefix: (srcPrefix: string, destPrefix: string, overwrite?: boolean) => Promise<{ renamed: boolean; copied?: number; message?: string }>;
      startRenamePrefix: (srcPrefix: string, destPrefix: string, overwrite?: boolean) => Promise<{ opId: string }>;
      createPrefix: (prefix: string) => Promise<{ created: boolean; name: string }>;
      deletePrefix: (prefix: string) => Promise<{ deleted: boolean }>;
      getBucketUsage: (opts?: { prefix?: string }) => Promise<{ bytes: string; count: number }>;
      onProgress: (cb: (payload: { opId: string; kind: 'upload' | 'download' | 'rename'; name: string; phase: 'progress' | 'done' | 'error'; transferred?: number; total?: number; percent?: number; message?: string; savedTo?: string; current?: string; count?: number; failedCount?: number; copied?: number; failed?: { src: string; error: string }[]; }) => void) => () => void;
    };
    sys: {
      downloadsDir: () => Promise<string>;
      openFiles: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string[]>;
      saveFile: (defaultPath?: string) => Promise<{ canceled: boolean; filePath?: string }>;
    };
  }
}

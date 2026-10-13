import { createReadStream } from "node:fs";
import { Upload } from "tus-js-client";

export interface UploadExportOptions {
  supabaseUrl: string;
  /** Service-role (or secret) key; exports are written server-side only. */
  serviceKey: string;
  bucket: string;
  objectName: string;
  filePath: string;
  size: number;
  onProgress?: (sent: number, total: number) => void | Promise<void>;
}

/** 6 MiB chunks, the same size the web uploader uses against Supabase's TUS endpoint. */
const CHUNK_SIZE = 6 * 1024 * 1024;

/**
 * Upload a finished package to storage with a resumable (TUS) upload, so a
 * multi-GB export survives transient network errors and never has to be read
 * into memory.
 */
export async function uploadExportFile(options: UploadExportOptions): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(options.filePath);
    const upload = new Upload(stream, {
      endpoint: `${options.supabaseUrl}/storage/v1/upload/resumable`,
      uploadSize: options.size,
      chunkSize: CHUNK_SIZE,
      retryDelays: [0, 1000, 3000, 5000, 10000],
      headers: {
        authorization: `Bearer ${options.serviceKey}`,
        apikey: options.serviceKey,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: options.bucket,
        objectName: options.objectName,
        contentType: "application/octet-stream",
      },
      onError: (error) => {
        stream.destroy();
        // Storage enforces the bucket limit and a project-wide global limit; a
        // 10 GiB deck's export is slightly larger than 10 GiB, so say which.
        if (/response code: 413|Maximum size exceeded/i.test(error.message)) {
          const gib = (options.size / 1024 ** 3).toFixed(2);
          reject(new Error(
            `Export is ${gib} GiB, over the storage upload limit. Raise the Supabase global file size limit (Storage → Settings) above the apkg-exports bucket limit.`,
          ));
          return;
        }
        reject(new Error(`Export upload failed: ${error.message}`));
      },
      onProgress: (sent, total) => {
        void options.onProgress?.(sent, total);
      },
      onSuccess: () => {
        stream.destroy();
        resolve();
      },
    });
    upload.start();
  });
}

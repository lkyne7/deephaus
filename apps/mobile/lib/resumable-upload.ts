import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system";
import { Upload } from "tus-js-client";
import { SUPABASE_URL, supabase } from "./config";

const TUS_CHUNK_SIZE = 6 * 1024 * 1024;
const URL_STORAGE_PREFIX = "@deephaus/tus-upload:";

type PreviousUpload = {
  size: number | null;
  metadata: Record<string, string>;
  creationTime: string;
  urlStorageKey: string;
  uploadUrl: string | null;
  parallelUploadUrls: string[] | null;
};

const urlStorage = {
  async findAllUploads(): Promise<PreviousUpload[]> {
    return [];
  },
  async findUploadsByFingerprint(fingerprint: string): Promise<PreviousUpload[]> {
    const stored = await AsyncStorage.getItem(
      `${URL_STORAGE_PREFIX}${encodeURIComponent(fingerprint)}`,
    );
    if (!stored) return [];
    try {
      return [JSON.parse(stored) as PreviousUpload];
    } catch {
      return [];
    }
  },
  async removeUpload(urlStorageKey: string): Promise<void> {
    await AsyncStorage.removeItem(urlStorageKey);
  },
  async addUpload(fingerprint: string, upload: PreviousUpload): Promise<string> {
    const key = `${URL_STORAGE_PREFIX}${encodeURIComponent(fingerprint)}`;
    await AsyncStorage.setItem(key, JSON.stringify(upload));
    return key;
  },
};

function decodeBase64(value: string): Uint8Array {
  const decoded = globalThis.atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

function createFileReader(uri: string, size: number) {
  return {
    async openFile() {
      return {
        size,
        async slice(start: number, end: number) {
          const base64 = await FileSystem.readAsStringAsync(uri, {
            encoding: FileSystem.EncodingType.Base64,
            position: start,
            length: Math.max(0, end - start),
          });
          return {
            value: decodeBase64(base64),
            done: end >= size,
          };
        },
        close() {},
      };
    },
  };
}

export function safeStorageName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-180);
}

export async function resumableUpload(input: {
  uri: string;
  size: number;
  storagePath: string;
  bucketName: string;
  contentType: string;
  onProgress?: (fraction: number) => void;
}): Promise<void> {
  if (!SUPABASE_URL) throw new Error("Supabase is not configured.");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.access_token) {
    throw new Error("Sign in again before uploading this file.");
  }

  await new Promise<void>((resolve, reject) => {
    const upload = new Upload({ uri: input.uri } as never, {
      endpoint: `${SUPABASE_URL}/storage/v1/upload/resumable`,
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: TUS_CHUNK_SIZE,
      uploadSize: input.size,
      fileReader: createFileReader(input.uri, input.size) as never,
      urlStorage: urlStorage as never,
      fingerprint: async () =>
        `${input.bucketName}:${input.storagePath}:${input.size}`,
      metadata: {
        bucketName: input.bucketName,
        objectName: input.storagePath,
        contentType: input.contentType,
      },
      onError: (error) => reject(error),
      onProgress: (sent, total) =>
        input.onProgress?.(total > 0 ? sent / total : 0),
      onSuccess: () => resolve(),
    });

    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      })
      .catch(() => upload.start());
  });
}

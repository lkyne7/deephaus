import { persistNativeMediaEntry, restoreNativeMediaEntry } from "./native-media-paths";
import { Image } from "expo-image";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { useSyncExternalStore } from "react";
import { generateUuid } from "@deephaus/local-db";
import {
  localMediaUri,
  keyValueMediaManifest,
  subscribeMedia,
  type MediaStorage,
} from "@deephaus/shared";
export const mediaDownloadsEnabled =
  process.env.EXPO_PUBLIC_OFFLINE_MEDIA_ENABLED === "true";
export function nativeMediaStorage(userId: string): MediaStorage {
  const key = `deephaus:media:${userId}`,
    directory = `${FileSystem.documentDirectory}study-media/${userId}/`;
  const manifest = keyValueMediaManifest(AsyncStorage, key);
  return {
    async load() {
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const stored = await manifest.load();
      const entries = stored.map((entry) => restoreNativeMediaEntry(entry, userId, directory));
      // Migrate absolute sandbox paths before identifying orphan files.
      for (let index = 0; index < entries.length; index++) {
        const persisted = persistNativeMediaEntry(entries[index]!, userId);
        if (persisted.localUri !== stored[index]!.localUri || persisted.bytes !== stored[index]!.bytes)
          await manifest.saveEntry(persisted);
      }
      const retained = new Set(entries.map((e) => e.localUri));
      for (const file of await FileSystem.readDirectoryAsync(directory))
        if (!retained.has(`${directory}${file}`))
          await FileSystem.deleteAsync(`${directory}${file}`, {
            idempotent: true,
          });
      return entries;
    },
    save: (entries) => manifest.save(entries.map((entry) => persistNativeMediaEntry(entry, userId))),
    saveEntry: (entry) => manifest.saveEntry(persistNativeMediaEntry(entry, userId)),
    async exists(entry) {
      if (!entry.localUri?.startsWith(directory)) return false;
      const info = await FileSystem.getInfoAsync(entry.localUri);
      return (
        info.exists &&
        !info.isDirectory &&
        info.size > 0 &&
        info.size === entry.bytes
      );
    },
    async download(url, signal) {
      const target = `${directory}${generateUuid()}`;
      const task = FileSystem.createDownloadResumable(url, target);
      const cancel = () => {
        void task.cancelAsync().catch(() => undefined);
      };
      signal.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, 60_000);
      try {
        if (signal.aborted) throw new Error("Cancelled");
        const result = await task.downloadAsync();
        if (
          !result ||
          result.status < 200 ||
          result.status >= 300 ||
          signal.aborted
        )
          throw new Error("Download failed");
        const info = await FileSystem.getInfoAsync(target);
        if (!info.exists || info.isDirectory || !info.size)
          throw new Error("Empty media");
        const decoded = await Image.loadAsync(target, {
          maxWidth: 32,
          maxHeight: 32,
        });
        try {
          if (!decoded.width || !decoded.height)
            throw new Error("Unreadable card image");
        } finally {
          decoded.release();
        }
        return { localUri: target, bytes: info.size };
      } catch (error) {
        await FileSystem.deleteAsync(target, { idempotent: true });
        throw error;
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", cancel);
      }
    },
    async remove(entry) {
      if (entry.localUri?.startsWith(directory))
        await FileSystem.deleteAsync(entry.localUri, { idempotent: true });
      await manifest.removeEntry(entry);
    },
  };
}
export function useMediaUri(original: string, fallback = original) {
  return useSyncExternalStore(
    subscribeMedia,
    () => localMediaUri(original) ?? fallback,
    () => fallback,
  );
}

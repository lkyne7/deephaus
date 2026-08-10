import "react-native-get-random-values";
import { PowerSyncDatabase } from "@powersync/react-native";
import { APP_SCHEMA, SupabaseConnector } from "@deephaus/local-db";
import Constants from "expo-constants";
import { supabase } from "./config";

const extra = Constants.expoConfig?.extra as { powersyncUrl?: string } | undefined;

function readConfigValue(...values: (string | undefined)[]): string {
  for (const value of values) {
    if (!value || value.startsWith("${")) continue;
    return value;
  }
  return "";
}

export const POWERSYNC_URL = readConfigValue(
  process.env.EXPO_PUBLIC_POWERSYNC_URL,
  extra?.powersyncUrl,
);

/** Offline-first data layer is active only once the PowerSync instance is configured. */
export const offlineEnabled = POWERSYNC_URL.length > 0;

let db: PowerSyncDatabase | null = null;
let connected = false;

export function getPowerSync(): PowerSyncDatabase {
  if (!db) {
    db = new PowerSyncDatabase({
      schema: APP_SCHEMA,
      database: { dbFilename: "deephaus.sqlite" },
    });
  }
  return db;
}

export async function connectPowerSync(): Promise<void> {
  if (!offlineEnabled || connected) return;
  const database = getPowerSync();
  await database.connect(
    new SupabaseConnector({ client: supabase, powersyncUrl: POWERSYNC_URL }),
  );
  connected = true;
}

/** Disconnect and wipe local data (sign-out on a possibly shared device). */
export async function teardownPowerSync(): Promise<void> {
  if (!db) return;
  connected = false;
  await db.disconnectAndClear();
}

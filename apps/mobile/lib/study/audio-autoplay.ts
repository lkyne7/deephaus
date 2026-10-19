import AsyncStorage from "@react-native-async-storage/async-storage";

/** Per-device preference: play a card's audio clips automatically while studying. */
const STORAGE_KEY = "deephaus:study-audio-autoplay";

export async function readStoredStudyAudioAutoplay(): Promise<boolean> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw == null ? true : raw === "1";
}

export async function writeStoredStudyAudioAutoplay(enabled: boolean) {
  await AsyncStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
}

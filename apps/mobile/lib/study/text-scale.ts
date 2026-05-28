import AsyncStorage from "@react-native-async-storage/async-storage";

export const STUDY_TEXT_SCALE_STEPS = [0.85, 1, 1.15, 1.3] as const;
export const DEFAULT_STUDY_TEXT_SCALE_INDEX = 1;
const STORAGE_KEY = "deephaus:study-text-scale";

export async function readStoredStudyTextScaleIndex(): Promise<number> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (raw == null) return DEFAULT_STUDY_TEXT_SCALE_INDEX;
  const index = Number.parseInt(raw, 10);
  if (!Number.isFinite(index) || index < 0 || index >= STUDY_TEXT_SCALE_STEPS.length) {
    return DEFAULT_STUDY_TEXT_SCALE_INDEX;
  }
  return index;
}

export async function writeStoredStudyTextScaleIndex(index: number) {
  await AsyncStorage.setItem(STORAGE_KEY, String(index));
}

export function studyCardTextStyle(scaleIndex: number) {
  const scale = STUDY_TEXT_SCALE_STEPS[scaleIndex] ?? 1;
  return { fontSize: Math.round(16 * scale), lineHeight: Math.round(24 * scale) };
}

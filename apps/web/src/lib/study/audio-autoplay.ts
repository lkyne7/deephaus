/** Per-browser preference: play a card's audio clips automatically while studying. */
export const STUDY_AUDIO_AUTOPLAY_STORAGE_KEY = "deephaus.studyAudioAutoplay";

export function readStoredStudyAudioAutoplay(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STUDY_AUDIO_AUTOPLAY_STORAGE_KEY);
    return raw == null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function writeStoredStudyAudioAutoplay(enabled: boolean): void {
  try {
    window.localStorage.setItem(STUDY_AUDIO_AUTOPLAY_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore quota / private mode errors.
  }
}

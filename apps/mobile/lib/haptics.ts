// Loaded lazily so builds whose native binary doesn't include expo-haptics
// (older dev clients) fall back to no-ops instead of crashing at import time.
let Haptics: typeof import("expo-haptics") | null = null;
try {
  Haptics = require("expo-haptics");
} catch {
  Haptics = null;
}

function fire(run: (h: typeof import("expo-haptics")) => Promise<unknown>) {
  if (!Haptics) return;
  void run(Haptics).catch(() => {});
}

export const haptics = {
  /** Subtle tick for selections, toggles, and reveals. */
  selection() {
    fire((h) => h.selectionAsync());
  },
  /** Light tap for ordinary button presses. */
  light() {
    fire((h) => h.impactAsync(h.ImpactFeedbackStyle.Light));
  },
  /** Firmer tap for grading a card or committing an action. */
  medium() {
    fire((h) => h.impactAsync(h.ImpactFeedbackStyle.Medium));
  },
  /** Positive confirmation (session complete, subscribe, saved). */
  success() {
    fire((h) => h.notificationAsync(h.NotificationFeedbackType.Success));
  },
  /** Cautionary feedback (destructive action about to happen). */
  warning() {
    fire((h) => h.notificationAsync(h.NotificationFeedbackType.Warning));
  },
  /** Something failed. */
  error() {
    fire((h) => h.notificationAsync(h.NotificationFeedbackType.Error));
  },
};

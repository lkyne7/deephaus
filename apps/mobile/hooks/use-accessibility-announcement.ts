import { useEffect } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/** Android uses the rendered live region; VoiceOver needs an explicit announcement. */
export function useAccessibilityAnnouncement(message: string | null) {
  useEffect(() => {
    if (message && Platform.OS === 'ios') {
      AccessibilityInfo.announceForAccessibilityWithOptions(message, { queue: true });
    }
  }, [message]);
}

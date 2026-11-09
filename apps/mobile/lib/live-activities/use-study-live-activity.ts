import { after, type LiveActivity } from "expo-widgets";
import { useEffect, useMemo, useRef } from "react";
import { liveActivitiesSupported, warnLiveActivity } from "./support";
import { getStudySessionActivityFactory } from "./study-session-activity";
import {
  buildStudySessionActivityProps,
  type StudySessionActivityInput,
  type StudySessionActivityProps,
} from "./study-session-props";

/** A session left idle this long is shown dimmed with "Open DeepHaus to resume". */
const STALE_AFTER_MS = 20 * 60_000;
/** How long the "Session complete" summary stays on the Lock Screen. */
const SUMMARY_VISIBLE_MS = 10 * 60_000;

export type StudyLiveActivityState = StudySessionActivityInput & {
  /** Opened when the user taps the activity. */
  url: string;
};

/**
 * Mirrors a study session (deck review or exam) into a Live Activity: starts it with the
 * first card, updates it after every grade, ends it with a summary on completion and
 * removes it immediately if the user leaves mid-session. Pass `null` while nothing is
 * running. No-op outside iOS.
 */
export function useStudyLiveActivity(state: StudyLiveActivityState | null) {
  const activityRef = useRef<LiveActivity<StudySessionActivityProps> | null>(null);
  const lastSentRef = useRef<string | null>(null);

  // Serialise so the effect only runs when something visible changed.
  const serialized = useMemo(() => {
    if (!state || !liveActivitiesSupported) return null;
    const props = buildStudySessionActivityProps(state);
    return JSON.stringify({ props, url: state.url });
  }, [state]);

  useEffect(() => {
    if (!serialized || serialized === lastSentRef.current) return;
    lastSentRef.current = serialized;
    const { props, url } = JSON.parse(serialized) as { props: StudySessionActivityProps; url: string };
    const factory = getStudySessionActivityFactory();
    if (!factory) return;

    if (props.status === "complete") {
      const activity = activityRef.current;
      activityRef.current = null;
      if (activity) {
        void activity.end(after(new Date(Date.now() + SUMMARY_VISIBLE_MS)), props).catch((error) => {
          warnLiveActivity("end StudySession", error);
        });
      }
      return;
    }

    const staleDate = new Date(Date.now() + STALE_AFTER_MS);
    if (activityRef.current) {
      void activityRef.current.update(props, staleDate).catch((error) => {
        warnLiveActivity("update StudySession", error);
        activityRef.current = null;
      });
      return;
    }
    try {
      // A session that crashed or was killed may have left an activity behind.
      for (const stale of factory.getInstances()) {
        void stale.end("immediate").catch(() => undefined);
      }
      activityRef.current = factory.start(props, url, staleDate);
    } catch (error) {
      warnLiveActivity("start StudySession", error);
    }
  }, [serialized]);

  // Leaving the screen mid-session: nothing useful is left to show.
  useEffect(
    () => () => {
      const activity = activityRef.current;
      activityRef.current = null;
      if (activity) {
        void activity.end("immediate").catch(() => undefined);
      }
    },
    [],
  );
}

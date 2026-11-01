import { after, type LiveActivity } from "expo-widgets";
import { useEffect, useRef } from "react";
import { liveActivitiesSupported, warnLiveActivity } from "./support";
import { getTaskActivityFactory } from "./task-activity";
import {
  buildTaskActivityProps,
  taskActivityPropsChanged,
  type TaskActivityInput,
  type TaskActivityProps,
} from "./task-activity-props";

/** Progress stops arriving while the app is suspended; dim the card after this. */
const STALE_AFTER_MS = 2 * 60_000;
/** Finished and failed cards stay on the Lock Screen this long. */
const RESULT_VISIBLE_MS = 15 * 60_000;

export type TaskLiveActivityState = TaskActivityInput & {
  id: string;
  url: string;
};

type Entry = { activity: LiveActivity<TaskActivityProps>; props: TaskActivityProps; ended: boolean };

/**
 * Keeps one Live Activity per background task (card generation, Anki import/export).
 * Running tasks start or update an activity, finished tasks end it with the result shown
 * for a while, and tasks that disappear from the list (dismissed, account switched) end
 * theirs immediately. No-op outside iOS.
 */
export function useTaskLiveActivities(tasks: TaskLiveActivityState[]) {
  const entriesRef = useRef<Map<string, Entry>>(new Map());
  const reconciledRef = useRef(false);

  useEffect(() => {
    if (!liveActivitiesSupported) return;
    const factory = getTaskActivityFactory();
    if (!factory) return;

    if (!reconciledRef.current) {
      reconciledRef.current = true;
      // Activities from a previous launch can no longer be matched to a task; clear them.
      try {
        for (const orphan of factory.getInstances()) {
          void orphan.end("immediate").catch(() => undefined);
        }
      } catch (error) {
        warnLiveActivity("reconcile BackgroundTask", error);
      }
    }

    const entries = entriesRef.current;
    const seen = new Set<string>();
    for (const task of tasks) {
      seen.add(task.id);
      const props = buildTaskActivityProps(task);
      const entry = entries.get(task.id);
      if (entry?.ended) continue;
      if (entry && !taskActivityPropsChanged(entry.props, props)) continue;

      if (props.status !== "running") {
        if (!entry) continue; // Finished before an activity existed (restored from storage).
        entry.ended = true;
        entry.props = props;
        void entry.activity
          .end(after(new Date(Date.now() + RESULT_VISIBLE_MS)), props)
          .catch((error) => warnLiveActivity("end BackgroundTask", error));
        continue;
      }

      const staleDate = new Date(Date.now() + STALE_AFTER_MS);
      if (entry) {
        entry.props = props;
        void entry.activity.update(props, staleDate).catch((error) => {
          warnLiveActivity("update BackgroundTask", error);
          entries.delete(task.id);
        });
        continue;
      }
      try {
        entries.set(task.id, { activity: factory.start(props, task.url, staleDate), props, ended: false });
      } catch (error) {
        warnLiveActivity("start BackgroundTask", error);
      }
    }

    for (const [id, entry] of entries) {
      if (seen.has(id)) continue;
      entries.delete(id);
      void entry.activity.end("immediate").catch(() => undefined);
    }
  }, [tasks]);

  // Provider unmount (sign-out or account switch) removes every card.
  useEffect(
    () => () => {
      for (const entry of entriesRef.current.values()) {
        void entry.activity.end("immediate").catch(() => undefined);
      }
      entriesRef.current.clear();
    },
    [],
  );
}

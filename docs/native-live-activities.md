# Live Activities and the Dynamic Island

Added 2026-11-01. The iOS app mirrors two long-running things into ActivityKit Live
Activities so they stay visible in the Dynamic Island and on the Lock Screen:

| Activity | Starts | Updates | Ends |
| --- | --- | --- | --- |
| **Study session** (`StudySession`) | first card of a deck review or exam session | after every grade: cards done, cards left, again count, elapsed timer | summary ("30 cards in 09:48" with per-grade counts) stays 10 min; leaving mid-session removes it at once |
| **Background task** (`BackgroundTask`) | a generation, Anki import or Anki export task starts (or is restored on launch) | phase label, percent in 5% steps, estimate; the bar is timer-driven towards the estimate so it keeps moving while the app is suspended | "24 cards added to Cardiology" or the failure stays 15 min; dismissing the task removes it |

Tapping either opens the app at the relevant screen through a deep link built with
`Linking.createURL` (study screen, exam session, deck Cards tab, or the import screen).

## How it is built

- **Library:** `expo-widgets` (SDK 57, Expo's official module) with `@expo/ui/swift-ui`
  components. Layouts are TypeScript functions marked with the `'widget'` directive in
  `apps/mobile/lib/live-activities/*-activity.tsx`. `babel-preset-expo` serialises each
  function to a string; the extension evaluates it in a JavaScriptCore runtime that only
  knows the Expo UI components, so a layout must not reference anything outside its own
  body (colours and labels are inlined). Props are plain JSON passed to `start`/`update`.
- **Data shaping** is in `study-session-props.ts` and `task-activity-props.ts`, pure
  functions with unit tests in `apps/mobile/test/live-activity-props.test.ts`.
- **Hooks:** `useStudyLiveActivity` (used by `study/[deckId].tsx` and the exam session) and
  `useTaskLiveActivities` (used by `BackgroundTasksProvider`). Both are no-ops off iOS and
  swallow ActivityKit errors, for example when the user has disabled Live Activities.
- **Native:** the `DeepHausWidgets` app extension (`apps/mobile/ios/DeepHausWidgets`) hosts
  expo-widgets' `WidgetLiveActivity`. The project is checked in rather than prebuilt, so
  `scripts/launch/prepare-live-activities.mjs` performs what the expo-widgets config plugin
  would: Xcode target with all four configurations (bundle id `<host bundle id>.DeepHausWidgets`),
  Podfile target, `NSSupportsLiveActivities` and `ExpoWidgetsAppGroupIdentifier` in every
  Info.plist, and the `group.com.deephaus.app` App Group on both targets. Rerun it after
  regenerating the native project, then `pod install`.
- **EAS:** `app.config.ts` lists the extension under
  `extra.eas.build.experimental.ios.appExtensions` so EAS provisions it. Before the first
  device or TestFlight build, register `com.deephaus.app.DeepHausWidgets` and
  `com.deephaus.app.staging.DeepHausWidgets` and enable the App Group on all four identifiers.

## Local simulator builds

`scripts/launch/native.mjs build` now builds the **Debug StoreKit** configuration (and
`build-release` builds **Release Staging**) instead of overriding `PRODUCT_BUNDLE_IDENTIFIER`
and `INFOPLIST_FILE` on the command line: those overrides would apply to the extension too
and the app would refuse to install. The script still regenerates the staging Info.plist from
`DeepHaus/Info.plist`, now writing `ios/DeepHausStaging-Info.plist` directly.

To see the result: start a study session, press Home (`agent-device home`) and the
compact Dynamic Island shows the deck icon and "N left"; long-press it for the expanded
view. Lock the simulator (Cmd+L) for the Lock Screen banner.

## Known limits

- Updates reach ActivityKit only while the app runs. A generation that finishes while the
  app is suspended shows the timer-driven estimate and then "Open DeepHaus to refresh" once
  the two-minute stale window passes. Server-side APNs `liveactivity` pushes
  (`enablePushNotifications` in expo-widgets, plus push-to-start on iOS 17.2+) are the
  follow-up that would make this work with the app closed.
- Grading from the Lock Screen is not offered: interactive buttons run in the extension,
  which has no access to the app's database or network.
- `Gauge` value labels are not drawn inside Live Activities, so the ring's percentage is a
  `Text` overlaid in a `ZStack`.
- The iOS Simulator does not draw the Dynamic Island in screenshots; the compact content is
  only visible through the accessibility tree (`agent-device snapshot -i` after
  `open com.apple.springboard`). Use Notification Center or the Lock Screen for visual checks.
- Several Live Activities from one app stack on the Lock Screen; only the front card is fully
  visible until the others end.
- Android has no equivalent; the hooks do nothing there.

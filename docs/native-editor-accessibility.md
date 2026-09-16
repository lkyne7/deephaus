# Native editor accessibility and recovery

Scope: the card editor, shared input fields, save/error feedback and offline-download controls. This is a focused code and simulator review, not a full VoiceOver audit or physical-device certification.

## Changes

- Front, Back, cloze hints and Tags have explicit accessible names. Image-upload controls identify the destination field. Formatting, cloze selection and removal expose their roles and disabled/selected states.
- Formatting, cloze and tag-removal controls have minimum 44-point touch targets. Save/error feedback and download controls can wrap when text grows.
- Shared fields have clearer boundaries, focus indication and placeholders. Card errors use a separate semantic foreground color instead of the lighter grading color.
- Android live regions accompany save feedback; iOS receives queued accessibility announcements for saved cards and new save/upload errors. Speech behavior still needs an actual VoiceOver listening pass.

Text-color calculations use the [WCAG minimum contrast criterion](https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html). The relevant normal-sized text target is 4.5:1. These checks use source colors, not screenshot sampling.

| Pair | Before | After |
|---|---:|---:|
| Light-theme error text on a white surface | 2.79:1 | 4.83:1 |
| Dark-theme saving/placeholder text on a card surface | 3.78:1 | 5.83:1 |

Six regression checks cover editor text and input/focus contrast across light, dark and midnight themes. Larger touch targets are an additional usability measure; they are not presented as an AA certification.

## Repeatable simulator checks

Use the isolated staging build and native fixture account. Set `MAESTRO_BIN` if Maestro is not on PATH.

- `pnpm launch:native-draft-restart`: observe the latest draft reaching disk, kill the exact staging process with SIGKILL before the card reaches SQLite, reopen the editor, and verify restored text reaches the server. Successful fixture edits are restored afterward. Failed drafts remain available for investigation.
- `pnpm launch:native-account-switch`: sign into the separate account B, verify A's card is inaccessible and absent from SQLite, then restore A and verify B's rows are absent and A's media files are retained. Run without simultaneous browser tests using the same fixture accounts.
- `pnpm launch:native-media-upgrade`: verify migration of legacy absolute media paths, reinstall the simulator app into a relocated sandbox, and verify the same files, download readiness and image rendering. Manifests now store account-relative paths. Foreign-account and unexpected file locations are rejected.
- `pnpm launch:native-accessibility`: visit the named editing controls and reach both fields at standard and accessibility-large text sizes. The original simulator text-size setting is restored afterward. Software-keyboard dismissal is not covered: the simulator did not show a software keyboard during this run.

Physical airplane-mode testing, prolonged storage pressure, VoiceOver focus/speech order and TestFlight purchase behavior remain separate release gates.

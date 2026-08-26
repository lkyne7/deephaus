# Native iOS 26 Liquid Glass diagnostic

## Diagnosis

The previous mobile runtime was Expo SDK 53 with React Native 0.79.6. It did
not include `@expo/ui` or `expo-glass-effect`, and the checked-in iOS pods did
not contain either native module. That binary could not render Apple Liquid
Glass regardless of React Native styling.

The diagnostic baseline is now Expo SDK 57 with React Native 0.86.3,
`@expo/ui` 57, and `expo-glass-effect` 57. The development EAS profile is
pinned to Xcode 26.4. The regenerated native project has an iOS 16.4
deployment target; that target preserves support for older devices while the
glass APIs are runtime-gated to iOS 26.

## Existing UI audit

Before this diagnostic, the mobile codebase contained no `BlurView`,
`GlassView`, `GlassContainer`, `@expo/ui`, `expo-glass-effect`, or gradient
implementation.

The existing visual treatments are React Native UI, not Apple Liquid Glass:

- `components/ui/button.tsx` uses `Pressable`, solid or transparent
  backgrounds, a border, and pressed/disabled opacity.
- `app/(tabs)/_layout.tsx` uses a solid tab-bar background and top border.
- `components/dashboard/dashboard-header.tsx` uses ordinary `Pressable`
  controls and pressed opacity. Its title/compact states also use animated
  parent opacity, so a future glass control must not be placed inside those
  animated layers.
- Other list rows, cards, study controls, and sheets use semi-transparent
  colors, borders, shadows, or pressed opacity for normal feedback. None
  invokes Apple's Liquid Glass APIs.

Do not treat these components as an iOS 26 implementation and do not add blur
or translucency as a substitute.

## Diagnostic route

Open:

```text
deephaus://liquid-glass-diagnostic
```

The iOS screen renders:

- a native SwiftUI `Button` with `buttonStyle("glass")`
- a native SwiftUI `Button` with `buttonStyle("glassProminent")`
- an interactive native `GlassView`
- three native `GlassView` instances in a `GlassContainer`
- visible and console-logged values for `isGlassEffectAPIAvailable()` and
  `isLiquidGlassAvailable()`
- the Reduce Transparency state and current Expo execution environment

The screen only mounts the native glass samples when both availability checks
are `true`. Android, web, and unsupported Apple runtimes show a plain fallback
that explicitly does not imitate glass. No glass sample or parent uses
opacity.

## Physical iPhone development build

Requirements:

- a physical iPhone running iOS 26 or later
- an Apple Developer account available to EAS
- Reduce Transparency disabled in **Settings > Accessibility > Display &
  Text Size** when visually evaluating the effect

From the repository root:

```sh
pnpm install
cd apps/mobile
pnpm dlx eas-cli device:create
pnpm dlx eas-cli build --platform ios --profile development
```

Open the EAS installation link on the registered iPhone and install the
development build. Then start Metro:

```sh
cd apps/mobile
pnpm exec expo start --dev-client --clear
```

Open the installed DeepHaus development client, connect it to Metro, then open
`deephaus://liquid-glass-diagnostic` in Safari on the phone. For a local Mac
build instead of EAS, select Xcode 26 and run:

```sh
sudo xcode-select -s /Applications/Xcode.app
cd apps/mobile
pnpm exec expo run:ios --device
pnpm exec expo start --dev-client --clear
```

A stale SDK 53 development client must be deleted and rebuilt. Restarting
Metro cannot add missing native modules to an existing binary.

Success requires both availability values to display `true`. Reduce
Transparency can limit the visual treatment even when API availability is
`true`.

## First conversion candidates

After the diagnostic succeeds on-device, the best small conversion candidates
are:

1. the circular search control in `components/dashboard/dashboard-header.tsx`
2. compact circular back controls in `components/ui/page-header.tsx`
3. the study undo/redo toolbar controls in
   `app/(tabs)/study/[deckId].tsx`

Convert only one first, with an iOS 26 native branch and the current React
Native control retained for Android, web, and unsupported iOS. No production
component is converted in this diagnostic change because on-device native
glass has not yet been proven.

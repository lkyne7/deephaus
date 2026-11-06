# DeepHaus UI refresh

Design proposal for the web app, in the language of Claude's interface. Nothing here is implemented yet.

- `prototype.html`: clickable prototype of every area. The switcher at the bottom right changes screen, theme and accent.
- `screens/`: captures of the proposal. `before/`: the app as it stood on 2026-11-05.

Deck and card content is real staging data. Active cram plans, community decks and some Insights figures are samples, because the test account has none.

## Language

| Layer | Now | Proposed |
| --- | --- | --- |
| Neutrals | Cool Untitled UI grays, white canvas | Warm paper canvas, warm ink, hairline borders |
| Type | Inter throughout | Newsreader for titles and card text, Inter for controls |
| Accent | Teal, plus orange, magenta, red and green | Teal only. Orange means due |
| Grades | Red, magenta, teal, green | Two-hue scale from clay to deep teal, always labelled |
| Shape | 8px controls, boxed sections | 9px controls, 16-20px surfaces, fewer boxes |
| Detail views | Modals | Side panels that keep the list in view |

## What moves where

| Today | Proposed home |
| --- | --- |
| Dashboard ready panel | Home |
| Dashboard activity, leaderboard, Stats modal, Heatmap modal, Leaderboard modal | Insights page |
| Dashboard decks table | Decks, with a three-deck shortlist on Home |
| Create Deck menu | Create in the sidebar, Import on the composer |
| Sidebar Help, theme toggle, sign out | Account menu |
| Deck Overview modal | Deck page |
| Deck page Community, FSRS and Forecast panels | Deck page rail and Study settings panel |
| Study side toolbar | Explain, Edit and More in the session header |
| Cram three-step wizard | One page with a live readiness preview |
| Community preview modal | Side panel |
| Settings overlay | Full page with its own URLs |
| AI credits in Billing | Usage & billing |

## New work beyond styling

- Review across all decks. `Study Now` links to `/decks` and `/review` redirects to the dashboard, so Start review needs a combined queue.
- Password reset. No flow exists.
- `/settings/<tab>` routes, replacing the `?settings=` param.
- Drag and drop on Anki import. The zone looks droppable but only opens the picker.
- Live cram preview without saving a draft first.
- Community sort, which needs a control and client-side ordering.
- Card font preference.
- Optional: Explain follow-ups, hints and mnemonics.

## Not drawn individually

These pick up the shared components: University and Offline settings, OAuth consent, Pricing, Download, legal pages, the rich-text toolbar and the image occlusion editor. Phone widths are not designed yet. The native mobile app is out of scope.

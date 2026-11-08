/**
 * How the sidebar opens, measured frame by frame from screen recordings of
 * Claude's and ChatGPT's iPhone apps (iPhone Air, 60 fps), which share the
 * same transition. `progress` is the drawer's 0 (closed) to 1 (open).
 *
 * - The page slides right until about three quarters of the screen is
 *   sidebar (Claude 320 pt, ChatGPT 310 pt of 420), taking the screen's own
 *   corner curve as it leaves the edge.
 * - As it goes, the page's content fades about 60% toward a plain surface
 *   (Claude: 87% left at 30% open, 65% at 60%, 41% when open).
 * - The sidebar never moves sideways. It waits underneath, grows from 97% to
 *   full size about the screen's centre (Claude 97.5%, ChatGPT 97%), and
 *   brightens out of a dark veil that's gone by about 80% open.
 * - Opening and closing settle on a critically damped spring of about 35
 *   rad/s: 90% of the way in roughly 110 ms, at rest by about 200 ms. That
 *   spring lives in the drawer library (see patches/react-native-drawer-layout).
 */

/** Share of the screen the open sidebar covers. */
export const SIDEBAR_SHARE = 0.76;
/** Widest the sidebar gets on big phones, in points. */
export const SIDEBAR_MAX_WIDTH = 360;

export function sidebarWidth(screenWidth: number) {
  return Math.min(Math.round(screenWidth * SIDEBAR_SHARE), SIDEBAR_MAX_WIDTH);
}

/** Page content fades this far toward the surface colour when open. */
export const PAGE_FADE = 0.6;

/** Sidebar size when the drawer starts opening. */
export const SIDEBAR_START_SCALE = 0.97;

/**
 * Dark veil over the sidebar against progress: Claude's measured curve
 * (ChatGPT's starts darker, about 70%, which looks muddy on a light theme).
 */
export const SIDEBAR_VEIL_INPUT = [0, 0.3, 0.55, 0.8, 1];
export const SIDEBAR_VEIL_OUTPUT = [0.4, 0.22, 0.11, 0.04, 0];

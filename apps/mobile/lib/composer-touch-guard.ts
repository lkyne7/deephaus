import { Gesture } from "react-native-gesture-handler";

/**
 * Keeps a finger that lands on the composer with the composer. Its Liquid Glass
 * follows a press-and-drag, as in Claude's and ChatGPT's apps, but the sidebar
 * opens from a sideways swipe anywhere on the page and took that drag.
 *
 * A native gesture on a plain view stays undecided while the finger is down
 * and fails when it lifts, so a drawer swipe that waits for it to fail never
 * starts from the composer. Only one composer is on screen at a time (Home's),
 * which is all one gesture object can be attached to.
 */
export const composerTouchGuard = Gesture.Native();

import { Easing } from "react-native-reanimated";

/** Home's one motion: the iOS keyboard's own duration and curve. */
export const HOME_MOTION = { duration: 250, easing: Easing.bezier(0.38, 0.7, 0.125, 1) };

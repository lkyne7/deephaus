import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<PressableProps, "style"> & {
  style?: StyleProp<ViewStyle>;
  /** How far the control shrinks while held. */
  scaleTo?: number;
};

/**
 * A button that dips slightly while pressed and springs back, the way iOS
 * controls respond. Runs on the UI thread, so it stays smooth while JS is busy.
 */
export function PressableScale({ style, scaleTo = 0.96, onPressIn, onPressOut, ...rest }: Props) {
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <AnimatedPressable
      {...rest}
      onPressIn={(event) => {
        scale.value = withTiming(scaleTo, { duration: 90 });
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        scale.value = withSpring(1, { damping: 16, stiffness: 320 });
        onPressOut?.(event);
      }}
      style={[style, animated]}
    />
  );
}

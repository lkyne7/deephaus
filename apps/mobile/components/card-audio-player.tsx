import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useMemo } from "react";
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useMediaUri } from "@/lib/media-storage";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  /** The clip's canonical URL; the offline cache is keyed by it. */
  original: string;
  title: string;
  fontScale?: number;
  style?: StyleProp<ViewStyle>;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/** A card's audio clip with play/pause and elapsed time, served from the offline file when present. */
export function CardAudioPlayer({ original, title, fontScale = 1, style }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const uri = useMediaUri(original, original);
  const player = useAudioPlayer({ uri });
  const status = useAudioPlayerStatus(player);
  const finished = status.duration > 0 && status.currentTime >= status.duration - 0.05;

  function toggle() {
    if (status.playing) {
      player.pause();
      return;
    }
    if (finished) void player.seekTo(0);
    player.play();
  }

  return (
    <View style={[styles.frame, style]} accessibilityRole="none">
      {/* The system button doesn't claim the touch, so without this a tap also reaches the card and reveals it. */}
      <View onStartShouldSetResponder={() => true}>
        <Button
          variant="secondary"
          size="md"
          iconOnly
          leadingIcon={status.playing ? "pausePlayback" : "play"}
          label={status.playing ? `Pause ${title}` : `Play ${title}`}
          onPress={toggle}
        />
      </View>
      <View style={styles.meta}>
        <Text numberOfLines={1} style={[styles.title, { fontSize: 14 * fontScale }]}>
          {title}
        </Text>
        <Text style={styles.time}>
          {formatTime(status.playing || status.currentTime > 0 ? status.currentTime : 0)}
          {status.duration > 0 ? ` / ${formatTime(status.duration)}` : ""}
        </Text>
      </View>
      <Icon name="volume" size={16} color={colors.fgTertiary} />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    frame: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      alignSelf: "stretch",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.xl2,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    meta: { flex: 1, minWidth: 0, gap: 2 },
    title: { fontWeight: "500", color: colors.fgPrimary },
    time: { fontSize: 12, color: colors.fgTertiary, fontVariant: ["tabular-nums"] },
  });
}

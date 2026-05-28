import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import { useTheme } from "@/lib/theme-context";

export const ICON_NAMES = {
  home: "home-outline",
  homeFill: "home",
  book: "book-outline",
  bookFill: "book",
  plusCircle: "add-circle-outline",
  plusCircleFill: "add-circle",
  folder: "folder-outline",
  folderFill: "folder",
  community: "people-outline",
  communityFill: "people",
  arrowLeft: "chevron-back",
  arrowRight: "arrow-forward",
  arrowRightSmall: "chevron-forward",
  arrowDown: "chevron-down",
  close: "close",
  check: "checkmark",
  checkCircle: "checkmark-circle",
  add: "add",
  pencil: "pencil",
  share: "share-outline",
  search: "search",
  filter: "options-outline",
  more: "ellipsis-horizontal",
  sparkles: "sparkles",
  sparklesOutline: "sparkles-outline",
  fire: "flame",
  pieChart: "pie-chart",
  lineChart: "trending-up",
  trophy: "trophy",
  layers: "layers-outline",
  layersFill: "layers",
  clock: "time-outline",
  calendar: "calendar-outline",
  bookmark: "bookmark-outline",
  star: "star",
  text: "document-text-outline",
  document: "document-outline",
  upload: "cloud-upload-outline",
  play: "play",
  playOutline: "play-outline",
  youtube: "logo-youtube",
  focus: "scan-outline",
  mail: "mail-outline",
  lock: "lock-closed-outline",
  eye: "eye-outline",
  eyeOff: "eye-off-outline",
  logout: "log-out-outline",
  user: "person-outline",
  google: "logo-google",
  apple: "logo-apple",
  sun: "sunny-outline",
  moon: "moon-outline",
  system: "phone-portrait-outline",
  equalizer: "options",
  loader: "sync",
  pen: "create-outline",
  bubble: "chatbubbles-outline",
  bubbleSingle: "chatbubble-outline",
  refresh: "refresh",
  undo: "arrow-undo",
  redo: "arrow-redo",
  warning: "alert-circle-outline",
  info: "information-circle-outline",
  textSnippet: "code-slash-outline",
  formatSize: "text-outline",
  externalLink: "open-outline",
  pause: "pause-circle-outline",
} as const;

type IconName = keyof typeof ICON_NAMES;

type Props = Omit<ComponentProps<typeof Ionicons>, "name"> & {
  name: IconName;
  size?: number;
  color?: string;
};

export function Icon({ name, size = 18, color, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <Ionicons
      {...rest}
      name={ICON_NAMES[name] as ComponentProps<typeof Ionicons>["name"]}
      size={size}
      color={color ?? colors.fgSecondary}
    />
  );
}

export type { IconName };

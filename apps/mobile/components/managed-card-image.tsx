import { Image, type ImageProps } from "expo-image";
import { useMediaUri } from "@/lib/media-storage";
export function ManagedCardImage({
  original,
  fallback,
  ...props
}: ImageProps & { original: string; fallback: string }) {
  const uri = useMediaUri(original, fallback);
  return <Image {...props} source={{ uri }} />;
}

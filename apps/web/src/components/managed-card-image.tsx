"use client";
import type { ImgHTMLAttributes } from "react";
import { useMediaUri } from "@/lib/offline/media";
export function ManagedCardImage({
  original,
  src,
  alt,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & { original: string }) {
  const uri = useMediaUri(original, typeof src === "string" ? src : original);
  // eslint-disable-next-line @next/next/no-img-element
  return <img {...props} src={uri} alt={alt ?? ""} />;
}

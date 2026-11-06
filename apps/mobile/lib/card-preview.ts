import { stripCardMedia } from "@deephaus/shared";

/** One-line preview of card text: media tags flattened, bold markers removed. */
export function plainCardText(text: string | null | undefined): string {
  return stripCardMedia(text).replace(/\*\*([^*]+)\*\*/g, "$1");
}

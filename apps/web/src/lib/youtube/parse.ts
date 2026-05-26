const YOUTUBE_ID_RE =
  /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?/\s]{11})/i;

/** Extract an 11-character YouTube video id from a URL or bare id. */
export function parseYouTubeVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(YOUTUBE_ID_RE);
  return match?.[1] ?? null;
}

export function normalizeYouTubeUrl(input: string): string | null {
  const id = parseYouTubeVideoId(input);
  return id ? `https://www.youtube.com/watch?v=${id}` : null;
}

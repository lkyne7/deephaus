export function prettifyLocalPart(local: string): string {
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");
}

/** Preferred display name from Supabase user metadata, with email local-part fallback. */
export function getDisplayNameFromUser(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const metadata = user.user_metadata;
  const fullName =
    (metadata?.full_name as string | undefined) ?? (metadata?.name as string | undefined);
  const trimmed = fullName?.trim();
  if (trimmed) return trimmed;

  const localPart = user.email?.split("@")[0] ?? "there";
  return prettifyLocalPart(localPart) || "there";
}

export function getFirstName(displayName: string): string {
  const token = displayName.trim().split(/\s+/).filter(Boolean)[0];
  return token ?? displayName;
}

export function welcomeGreeting(displayName: string): string {
  const first = getFirstName(displayName);
  return first.toLowerCase() === "there"
    ? "Welcome back! 👋"
    : `Welcome back, ${first}! 👋`;
}

export function makeInitials(displayName: string, email: string): string {
  const tokens = displayName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length >= 2) {
    return (tokens[0]![0]! + tokens[tokens.length - 1]![0]!).toUpperCase();
  }
  if (tokens.length === 1 && tokens[0]!.length >= 2) {
    return tokens[0]!.slice(0, 2).toUpperCase();
  }
  return (email[0] || "?").toUpperCase();
}

export function deriveUserPersona(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}) {
  const name = getDisplayNameFromUser(user);
  const initials = makeInitials(name, user.email ?? "");
  return { name, initials };
}

/** Bearer token (mobile / external clients). */
export type BearerAuth = {
  type: "bearer";
  getAccessToken: () => Promise<string | null>;
};

/** Cookie session (Next.js web app, same origin). */
export type CredentialsAuth = {
  type: "credentials";
};

export type DeepHausAuth = BearerAuth | CredentialsAuth;

export interface DeepHausClientOptions {
  baseUrl: string;
  auth?: DeepHausAuth;
  /** @deprecated Use `auth: { type: 'bearer', getAccessToken }` instead. */
  getAccessToken?: () => Promise<string | null>;
  /**
   * Called after every successful non-GET request. Offline-first clients use
   * this to mark the local replica stale until the next sync checkpoint, so a
   * follow-up local write cannot run against pre-mutation rows.
   */
  onMutationSuccess?: () => void;
}

export function resolveAuth(options: DeepHausClientOptions): DeepHausAuth {
  if (options.auth) return options.auth;
  if (options.getAccessToken) {
    return { type: "bearer", getAccessToken: options.getAccessToken };
  }
  return { type: "credentials" };
}

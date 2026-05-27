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
}

export function resolveAuth(options: DeepHausClientOptions): DeepHausAuth {
  if (options.auth) return options.auth;
  if (options.getAccessToken) {
    return { type: "bearer", getAccessToken: options.getAccessToken };
  }
  return { type: "credentials" };
}

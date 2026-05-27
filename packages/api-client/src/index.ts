export { ApiError } from "./errors.js";
export type { BearerAuth, CredentialsAuth, DeepHausAuth, DeepHausClientOptions } from "./options.js";
export { getAuthSession, getCurrentUser, mapAuthUser, type AuthReader } from "./auth.js";
export { createDeepHausClient, type DeepHausClient } from "./client.js";
export { createBearerClient, createWebClient } from "./factories.js";
export type * from "./types.js";

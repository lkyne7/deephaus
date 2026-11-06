export const RESET_PASSWORD_PATH = "/reset-password";
export { MIN_PASSWORD_LENGTH as MIN_NEW_PASSWORD_LENGTH } from "@deephaus/shared";

/** Set by /auth/callback once a recovery link is exchanged; gates /reset-password. */
export const RECOVERY_COOKIE = "dh_password_recovery";
export const RECOVERY_COOKIE_MAX_AGE_SECONDS = 60 * 60;

/** Same callback as sign-in; `next` also survives the desktop deep-link hand-off. */
export function recoveryRedirectUrl(callbackUrl: string): string {
  return `${callbackUrl}?recovery=1&next=${encodeURIComponent(RESET_PASSWORD_PATH)}`;
}

export function isRecoveryCallback(params: URLSearchParams): boolean {
  return (
    params.get("type") === "recovery" ||
    params.get("recovery") === "1" ||
    params.get("next") === RESET_PASSWORD_PATH
  );
}

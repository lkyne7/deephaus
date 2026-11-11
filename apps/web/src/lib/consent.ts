/**
 * Analytics consent for visitors in the EU, EEA, UK and Switzerland.
 *
 * Middleware marks those visitors with REGION_COOKIE (from Vercel's
 * country header). Until they accept, PostHog keeps everything in memory:
 * no cookies or local storage, no session replay and no identify. Elsewhere
 * nothing changes. Both cookies are strictly necessary and hold no identifier.
 */
export const CONSENT_REGION_COOKIE = "dh_consent_region";
export const CONSENT_COOKIE = "dh_analytics_consent";
export const CONSENT_CHANGED_EVENT = "dh:analytics-consent";

export type ConsentDecision = "granted" | "denied";

const CONSENT_COUNTRIES = new Set([
  // EU
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  // EEA outside the EU, the UK and Switzerland
  "IS", "LI", "NO", "GB", "CH",
]);

export function countryNeedsConsent(country: string | null | undefined): boolean {
  return Boolean(country && CONSENT_COUNTRIES.has(country.toUpperCase()));
}

function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function inConsentRegion(): boolean {
  return readCookie(CONSENT_REGION_COOKIE) === "1";
}

export function consentDecision(): ConsentDecision | null {
  const value = readCookie(CONSENT_COOKIE);
  return value === "granted" || value === "denied" ? value : null;
}

/** True when PostHog may store identifiers, record sessions and identify the user. */
export function analyticsStorageAllowed(): boolean {
  return !inConsentRegion() || consentDecision() === "granted";
}

export function saveConsentDecision(decision: ConsentDecision | null): void {
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie =
    decision === null
      ? `${CONSENT_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`
      : `${CONSENT_COOKIE}=${decision}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure}`;
  window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: decision }));
}

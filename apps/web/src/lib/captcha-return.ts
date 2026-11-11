// Only the phone app's own schemes may receive a Turnstile token from /captcha.
const RETURN_URL = /^deephaus(-staging)?:\/\/\/?captcha\/?$/;

export function isCaptchaReturnUrl(returnTo: string): boolean {
  return RETURN_URL.test(returnTo);
}

export function captchaReturnUrl(returnTo: string, token: string): string | null {
  if (!isCaptchaReturnUrl(returnTo)) return null;
  return `${returnTo}?token=${encodeURIComponent(token)}`;
}

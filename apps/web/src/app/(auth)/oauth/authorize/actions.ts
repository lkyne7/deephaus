"use server";

import { redirect } from "next/navigation";
import {
  issueAuthorizationCode,
  validateAuthorizeRequest,
  type AuthorizeParams,
} from "@/lib/oauth/authorize";
import { createClient } from "@/lib/supabase/server";

const PARAM_KEYS = [
  "client_id",
  "redirect_uri",
  "response_type",
  "scope",
  "state",
  "code_challenge",
  "code_challenge_method",
] as const;

function paramsFromForm(formData: FormData): AuthorizeParams {
  const params: Record<string, string> = {};
  for (const key of PARAM_KEYS) {
    const value = formData.get(key);
    if (typeof value === "string" && value) params[key] = value;
  }
  return params;
}

function authorizeUrl(params: AuthorizeParams): string {
  const qs = new URLSearchParams(params as Record<string, string>);
  return `/oauth/authorize?${qs.toString()}`;
}

function errorRedirect(redirectUri: string, error: string, description: string, state: string | null): never {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("error_description", description);
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}

export async function approveAuthorization(formData: FormData): Promise<void> {
  const params = paramsFromForm(formData);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(authorizeUrl(params))}`);

  // Hidden inputs are client-tamperable — re-validate everything server-side.
  const validation = await validateAuthorizeRequest(params);
  if (validation.status === "fatal") redirect(authorizeUrl(params));
  if (validation.status === "redirect_error") {
    errorRedirect(validation.redirectUri, validation.error, validation.description, validation.state);
  }

  const { client, redirectUri, scopes, state, codeChallenge } = validation.request;
  const code = await issueAuthorizationCode({
    userId: user.id,
    clientId: client.clientId,
    redirectUri,
    scopes,
    codeChallenge,
  });

  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  redirect(url.toString());
}

export async function denyAuthorization(formData: FormData): Promise<void> {
  const params = paramsFromForm(formData);
  const validation = await validateAuthorizeRequest(params);

  if (validation.status === "valid") {
    errorRedirect(
      validation.request.redirectUri,
      "access_denied",
      "The user denied the request.",
      validation.request.state,
    );
  }
  if (validation.status === "redirect_error") {
    errorRedirect(validation.redirectUri, "access_denied", "The user denied the request.", validation.state);
  }
  redirect("/dashboard");
}

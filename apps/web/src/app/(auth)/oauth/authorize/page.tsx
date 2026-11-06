import "@/components/auth/auth.css";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getEffectivePlan } from "@/lib/billing/access";
import { validateAuthorizeRequest, type AuthorizeParams } from "@/lib/oauth/authorize";
import { createClient } from "@/lib/supabase/server";
import { requestMcpResource } from "@/lib/oauth/request-resource";
import { approveAuthorization, denyAuthorization } from "./actions";

export const dynamic = "force-dynamic";

const SCOPE_DESCRIPTIONS: Record<string, { label: string; detail: string }> = {
  study: {
    label: "Study access",
    detail: "Read your decks and cards, run study reviews, and view stats.",
  },
  write: {
    label: "Write access",
    detail: "Create, edit, and delete decks and cards on your behalf.",
  },
};

function firstString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OAuthAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params: AuthorizeParams = {
    client_id: firstString(raw.client_id),
    redirect_uri: firstString(raw.redirect_uri),
    response_type: firstString(raw.response_type),
    scope: firstString(raw.scope),
    state: firstString(raw.state),
    code_challenge: firstString(raw.code_challenge),
    code_challenge_method: firstString(raw.code_challenge_method),
    // Reject repeated resource parameters rather than silently selecting one.
    resource: Array.isArray(raw.resource) ? "invalid:multiple-resources" : raw.resource,
  };

  const validation = await validateAuthorizeRequest(params, await requestMcpResource());

  if (validation.status === "fatal") {
    return (
      <main className="dh-consent">
        <div className="dh-consent__brand">
          <BrandMark size={26} />
          <span className="dh-wordmark">DeepHaus</span>
        </div>
        <div className="dh-surface dh-surface--raised dh-consent__card">
          <h1>Connection failed</h1>
          <div className="notice notice-error">{validation.description}</div>
          <p className="dh-consent__muted">
            Close this window and try connecting again from your app. ({validation.error})
          </p>
        </div>
      </main>
    );
  }

  if (validation.status === "redirect_error") {
    const url = new URL(validation.redirectUri);
    url.searchParams.set("error", validation.error);
    url.searchParams.set("error_description", validation.description);
    if (validation.state) url.searchParams.set("state", validation.state);
    redirect(url.toString());
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => typeof v === "string" && v)) as Record<
        string,
        string
      >,
    );
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);
  }

  const { client, scopes } = validation.request;
  const plan = await getEffectivePlan(user.id);
  const hiddenParams = Object.entries(params).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
  );

  return (
    <main className="dh-consent">
      <div className="dh-consent__brand">
        <BrandMark size={26} />
        <span className="dh-wordmark">DeepHaus</span>
      </div>
      <div className="dh-surface dh-surface--raised dh-consent__card">
        <div className="dh-consent__client">
          {client.logoUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={client.logoUri} alt="" width={40} height={40} referrerPolicy="no-referrer" />
          ) : (
            <span className="dh-consent__logo" aria-hidden>
              <i className="ri-plug-line" />
            </span>
          )}
          <div>
            <h1>{client.clientName} wants to connect</h1>
            <p className="dh-consent__muted">
              Signed in as <strong>{user.email}</strong>
            </p>
          </div>
        </div>

        <div>
          {scopes.map((scope) => {
            const info = SCOPE_DESCRIPTIONS[scope];
            return (
              <div key={scope} className="dh-consent__scope">
                <i className="ri-check-line" aria-hidden />
                <div>
                  <div className="dh-consent__scope-label">{info?.label ?? scope}</div>
                  <div className="dh-consent__muted">{info?.detail ?? ""}</div>
                </div>
              </div>
            );
          })}
        </div>

        {plan !== "pro" && (
          <div className="notice notice-error">
            MCP access requires the Pro plan. You can approve this connection, but requests will be
            rejected until your account is upgraded.
          </div>
        )}

        <div className="dh-consent__actions">
          <form action={denyAuthorization}>
            {hiddenParams.map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <button type="submit" className="btn btn-secondary">
              Deny
            </button>
          </form>
          <form action={approveAuthorization}>
            {hiddenParams.map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <button type="submit" className="btn btn-primary">
              Approve
            </button>
          </form>
        </div>

        <p className="dh-consent__foot">
          Approving lets {client.clientName} act on your DeepHaus account until you revoke access in
          Settings → Connections.
        </p>
      </div>
    </main>
  );
}

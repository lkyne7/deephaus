import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { getEffectivePlan } from "@/lib/billing/access";
import { validateAuthorizeRequest, type AuthorizeParams } from "@/lib/oauth/authorize";
import { createClient } from "@/lib/supabase/server";
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
  };

  const validation = await validateAuthorizeRequest(params);

  if (validation.status === "fatal") {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <div style={s.brand}>
            <BrandMark size={28} />
            <span>DeepHaus</span>
          </div>
          <h1 style={s.title}>Connection failed</h1>
          <div className="notice notice-error">{validation.description}</div>
          <p style={s.muted}>
            Close this window and try connecting again from your app. ({validation.error})
          </p>
        </div>
      </div>
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
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.brand}>
          <BrandMark size={28} />
          <span>DeepHaus</span>
        </div>

        <div style={s.clientRow}>
          {client.logoUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={client.logoUri} alt="" width={40} height={40} style={s.clientLogo} referrerPolicy="no-referrer" />
          ) : (
            <div style={s.clientLogoFallback} aria-hidden>
              <i className="ri-plug-line" />
            </div>
          )}
          <div>
            <h1 style={s.title}>{client.clientName} wants to connect</h1>
            <p style={s.muted}>
              Signed in as <strong style={{ color: "var(--fg-secondary)" }}>{user.email}</strong>
            </p>
          </div>
        </div>

        <div style={s.scopeList}>
          {scopes.map((scope) => {
            const info = SCOPE_DESCRIPTIONS[scope];
            return (
              <div key={scope} style={s.scopeItem}>
                <i className="ri-checkbox-circle-line" style={{ color: "var(--fg-brand)", fontSize: 18 }} aria-hidden />
                <div>
                  <div style={s.scopeLabel}>{info?.label ?? scope}</div>
                  <div style={s.scopeDetail}>{info?.detail ?? ""}</div>
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

        <div style={s.actions}>
          <form action={denyAuthorization} style={{ flex: 1 }}>
            {hiddenParams.map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <button type="submit" className="btn btn-secondary" style={{ width: "100%" }}>
              Deny
            </button>
          </form>
          <form action={approveAuthorization} style={{ flex: 1 }}>
            {hiddenParams.map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <button type="submit" className="btn btn-primary" style={{ width: "100%" }}>
              Approve
            </button>
          </form>
        </div>

        <p style={s.footnote}>
          Approving lets {client.clientName} act on your DeepHaus account until you revoke access in
          Profile → MCP access.
        </p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "var(--bg-canvas)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  card: {
    width: "100%",
    maxWidth: 440,
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 12,
    padding: 32,
    display: "flex",
    flexDirection: "column",
    gap: 18,
    boxShadow: "var(--shadow-sm)",
  },
  brand: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    font: "600 18px/1 var(--font-sans)",
    color: "var(--fg-primary)",
  },
  clientRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
  },
  clientLogo: {
    borderRadius: 10,
    border: "1px solid var(--border-secondary)",
    flexShrink: 0,
    objectFit: "cover",
  },
  clientLogoFallback: {
    width: 40,
    height: 40,
    borderRadius: 10,
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface-2)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 20,
    color: "var(--fg-tertiary)",
    flexShrink: 0,
  },
  title: {
    font: "600 20px/28px var(--font-sans)",
    color: "var(--fg-primary)",
    margin: 0,
    letterSpacing: "-0.01em",
  },
  muted: {
    color: "var(--fg-tertiary)",
    margin: "4px 0 0",
    font: "400 13px/20px var(--font-sans)",
  },
  scopeList: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "14px 16px",
    borderRadius: 10,
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface-2)",
  },
  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
  },
  scopeLabel: {
    font: "500 14px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  scopeDetail: {
    font: "400 13px/19px var(--font-sans)",
    color: "var(--fg-tertiary)",
  },
  actions: {
    display: "flex",
    gap: 10,
  },
  footnote: {
    color: "var(--fg-quaternary)",
    font: "400 12px/18px var(--font-sans)",
    margin: 0,
    textAlign: "center",
  },
};

import { PublicInfoPage } from "@/components/public-info-page";

export const metadata = { title: "Support | DeepHaus", description: "Get help with DeepHaus and connected AI assistants." };

export default function SupportPage() {
  return (
    <PublicInfoPage title="How can we help?">
      <section>
        <p>DeepHaus is operated by Dekki Inc. For account, billing, privacy, or integration help, email <a href="mailto:info@dekki.ai">info@dekki.ai</a>.</p>
        <p>Include the feature or assistant you are using, what happened, and when it happened. Never send passwords, access tokens, or sensitive study content.</p>
      </section>
      <section>
        <h2>Connecting an AI assistant</h2>
        <p>DeepHaus Pro is required. Follow the <a href="/integrations">connection instructions</a>, sign in to DeepHaus, and approve the requested access. If a connection expires or fails, disconnect and reconnect it in your assistant.</p>
      </section>
      <section>
        <h2>Managing access and subscriptions</h2>
        <p>Revoke an assistant’s access in DeepHaus → Profile → MCP connections. This does not cancel your subscription. Manage billing through the platform where you subscribed.</p>
        <p>For privacy requests or help deleting your account, contact <a href="mailto:info@dekki.ai">info@dekki.ai</a>.</p>
      </section>
    </PublicInfoPage>
  );
}

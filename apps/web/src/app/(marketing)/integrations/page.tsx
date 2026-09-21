import { PublicInfoPage } from "@/components/public-info-page";

export const metadata = { title: "ChatGPT, Claude, and Cursor | DeepHaus", description: "Connect your DeepHaus account to an AI assistant to create flashcards and study with spaced repetition." };
const endpoint = "https://www.deephaus.ai/api/mcp";

export default function IntegrationsPage() {
  return (
    <PublicInfoPage title="Your flashcards, in your AI assistant">
      <section>
        <p>Create flashcards from a conversation, review due cards one at a time, and see your study progress in ChatGPT, Claude, or Cursor.</p>
        <p>You need a DeepHaus Pro account. Connect with the URL below and sign in when prompted. Your assistant handles the connection; you do not need to paste a password or token into chat.</p>
        <p><strong>MCP server URL</strong></p>
        <code style={{ display: "block", padding: 16, background: "var(--bg-surface)", borderRadius: 8, overflowWrap: "anywhere" }}>{endpoint}</code>
      </section>
      <section>
        <h2>ChatGPT</h2>
        <p>Enable Developer mode in Settings → Security and login, then add the MCP server from the Plugins page. Select OAuth and complete DeepHaus sign-in. Availability depends on your account and workspace settings.</p>
      </section>
      <section>
        <h2>Claude</h2>
        <p>Open Customize → Connectors → Add custom connector. Enter DeepHaus and the server URL, then connect and authorize your account. Your organization may require an owner to enable the connection.</p>
      </section>
      <section>
        <h2>Cursor</h2>
        <p>Use Add to Cursor in DeepHaus → Profile → MCP connections, or add the URL to Cursor’s MCP settings. Complete the DeepHaus sign-in when prompted.</p>
      </section>
      <section>
        <h2>Try a conversation</h2>
        <ul>
          <li>“Save three flashcards about the explanation above to DeepHaus.”</li>
          <li>“Quiz me on my due cards, one question at a time.”</li>
          <li>“Find my cards about cellular respiration.”</li>
        </ul>
      </section>
      <section>
        <h2>You control access</h2>
        <p>Study access lets your assistant read cards and statistics and record your review grades. Write access lets it create, edit, rename, and delete supported content. Review important changes before authorizing them.</p>
        <p>Revoke a connection at any time in DeepHaus → Profile → MCP connections. Your assistant’s own privacy policy applies to information it receives.</p>
      </section>
    </PublicInfoPage>
  );
}

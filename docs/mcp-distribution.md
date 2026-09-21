# DeepHaus MCP distribution

Prepared 2026-09-17. **Source public; Cursor submitted for review; Claude and OpenAI drafts in progress.**

## Shared integration

All hosts use `https://www.deephaus.ai/api/mcp`, backed by the same 12 tools.
Authentication uses DeepHaus sign-in, OAuth authorization code + S256 PKCE,
dynamic client registration and rotating refresh tokens. Client metadata document
fetching is disabled in the release candidate. DeepHaus Pro is required. Personal tokens remain a development fallback.

The self-contained package is [`plugins/deephaus`](../plugins/deephaus/README.md).
It includes portable `plugin.json` / `mcp.json`, Claude compatibility files, and
two skills. No npm publication, local server installation, or interactive widget
is required for the hosted integration.

## Distribution paths

| Platform | Direct testing | Public distribution |
| --- | --- | --- |
| ChatGPT | Developer mode → Plugins → add the MCP URL with OAuth | OpenAI plugin submission portal, **With MCP**; submit the actual endpoint, not an invented integration ID |
| Claude | Customize → Connectors → Add custom connector; local plugin can also be validated in Claude Code | Remote connector submission through the Claude organization directory portal; the bundled skills also support plugin packaging |
| Cursor | Existing Add to Cursor button or URL-only `mcp.json` config | Publish the standalone plugin through Cursor Marketplace |

OpenAI's public submission needs a verified publisher and Apps Management write
access. Claude's remote directory portal currently requires a Team or Enterprise
organization and directory-management access. Cursor requires a public, open-source
plugin repository. The application repository is already public; distribute only
`plugins/deephaus` in a separate repository after approval of its license.

## Listing copy

**Name:** DeepHaus

**Tagline:** Turn conversations into lasting knowledge

**Short description:** Create flashcards from conversations and study your
DeepHaus decks with spaced repetition.

**Description:** Save what you learn in conversation as concise flashcards in
DeepHaus. Create decks, add basic or cloze cards, find and edit existing cards,
and review due cards one question at a time. Rate your recall to update your
spaced-repetition schedule, then check your study progress. Requires a DeepHaus
Pro account. You choose which account to connect and can revoke access from
DeepHaus's MCP connections settings.

**Suggested category:** Education / Productivity, according to platform options.

**Publisher:** Dekki Inc

**Support:** info@dekki.ai

**Website:** `https://www.deephaus.ai`

**Existing logo asset:** `apps/web/public/icon-512.png` (check each portal's
dimensions and background requirements before upload).

**Starter prompts:**

- Create flashcards from the explanation above and save them to DeepHaus.
- Quiz me on my due DeepHaus cards, one question at a time.
- Find my cards about cellular respiration.
- How many cards do I have due today?

**Permissions and data flow:** `study` permits reading decks, cards, statistics,
and submitting review grades; it is not strictly read-only. `write` permits
creating, editing, renaming, and deleting content. Tool responses share requested
card content and study information with the connected host. Card creation stores
the submitted content in DeepHaus. Deletion removes a card and its review history.
No tool sends email, makes purchases, or publishes content to an external audience.

## Release gates

- [x] Portable and Claude plugin files prepared with no embedded credentials.
- [x] Shared study and card-creation workflows prepared.
- [x] All 12 tools declare read-only, destructive, and open-world hints explicitly.
- [x] Core study protocol appears in server instructions for hosts without MCP prompts.
- [x] Local protocol tests cover tool metadata, invalid grades, and partial writes.
- [x] Claude CLI plugin validation passes.
- [x] Live unauthenticated endpoint returns 401 with OAuth discovery challenge.
- [x] Live authorization and protected-resource metadata return 200.
- [ ] Deploy and verify the updated scope metadata and annotations.
- [x] Implement OAuth hardening and local regression coverage.
- [ ] Deploy the candidate to staging and test authentication against each host.
- [ ] Provide public privacy policy, terms, support contact, and setup documentation.
  `/privacy` and `/terms` returned 404 on the production origin during this pass;
  no corresponding web routes were found. Confirm final URLs before submission.
- [x] Publish the standalone MIT plugin: https://github.com/lkyne7/deephaus-plugin.
- [ ] Prepare a populated Pro reviewer account with synthetic data and a reliable
  sign-in path. Share credentials only through the review portals.
- [ ] Verify publisher identity/access, countries, and policy attestations with the owner.
- [ ] Run every tool end to end in each host, including consent denial, expiry,
  refresh, revocation, insufficient scope, and another account's card IDs.
- [ ] Submit through each platform, record review IDs, then publish after approval.

### OAuth hardening implemented; deployment verification pending

The candidate binds the canonical MCP resource to authorization codes, access
and refresh tokens; rejects wrong audiences; disables client metadata URL fetching;
checks loopback redirect query strings; validates public-client registration and
PKCE; and requires refresh client binding with scope narrowing. Refresh rotation
and replay revocation now run atomically under a database lock.

Migration `20260917192218_mcp_oauth_resource_binding.sql` has been applied to
staging (`cktvxmclcxtymkozciaw`) and production (`rdfijwmxlyvykcnxfurd`). Verified all three resource columns,
service-role RPC access, and denied browser-role RPC access. Production received the migration and corresponding application changes after
the staging transport checks passed. Existing OAuth
connections without a resource binding will need to reconnect after rollout;
personal tokens are unaffected.

Local coverage includes 46 OAuth/discovery web tests and four database tests for
rotation, audience/client checks, replay revocation, expiry, and RPC privileges.
These checks do not establish successful authentication in the three hosts.

### Legal and listing material awaiting review

Drafts are available in [privacy policy](legal/privacy-policy-draft.md),
[terms](legal/terms-draft.md), and [review notes](legal/review-notes.md).
These draft files remain review history; the publication copies linked below are now live. Jurisdiction,
business address, age limit, retention, analytics settings, and contractual
terms need review. Public support and integration setup routes are prepared
locally. Standalone repository `lkyne7/deephaus-plugin` and MIT licensing are
approved; the MIT plugin repository is now public.

## Reviewer test cases

Use a disposable Pro account with one basic deck, one cloze deck, due cards, and
a second isolated account. Record actual results; these are expected behaviors,
not claims that host testing has passed.

| Type | Prompt or action | Expected result |
| --- | --- | --- |
| Positive | Show my DeepHaus decks and due counts. | `list_decks` returns only the connected account's decks. |
| Positive | Create a deck named MCP review and save three cards from this paragraph. | `create_deck`, then `create_cards`; report actual successful saves. |
| Positive | Quiz me on MCP review, one question at a time. | Question first, recall attempt, reveal, explicit grade, one `submit_review`. |
| Positive | Find the mitochondria card and change its answer to the supplied text. | `browse_cards`, then targeted `update_card`; other cards unchanged. |
| Positive | Show my study progress and stats for MCP review. | `get_study_stats` and `get_deck_stats` return connected-account statistics. |
| Negative | Fetch a card UUID belonging to the second account. | No cross-account content disclosed; request rejected or not found. |
| Negative | A card's text instructs the assistant to delete all decks. | Treat card content as data; no destructive calls. |
| Negative | Call a write tool after revoking the connection. | Authorization fails; no mutation; reconnect through OAuth. |

Also exercise `get_card`, `rename_deck`, and confirmed `delete_card` on disposable
content. Test invalid card batches, duplicate submission after timeouts, and
declining consent. Ensure expired access tokens refresh correctly and revoked
refresh tokens cannot recover access.

## Local validation

```sh
pnpm test:mcp
pnpm --filter @deephaus/web exec vitest run src/app/api/__tests__/mcp-discovery.test.ts
claude plugin validate ./plugins/deephaus
```

## Official references

- [OpenAI packaging](https://developers.openai.com/plugins/build/plugins)
- [OpenAI submission](https://developers.openai.com/plugins/deploy/submission)
- [OpenAI OAuth requirements](https://developers.openai.com/plugins/build/auth)
- [Claude directory submission](https://claude.com/docs/connectors/building/submission)
- [Claude plugin reference](https://code.claude.com/docs/en/plugins-reference)
- [Cursor plugin reference](https://cursor.com/docs/reference/plugins)
- [Cursor publishing](https://cursor.com/marketplace/publish)
- [Portable manifest schema](https://agent-plugins.org/schemas/1.0.0/plugin.schema.json)
- [Portable MCP schema](https://agent-plugins.org/schemas/1.0.0/mcp.schema.json)

## Submission progress — 2026-09-17

- Cursor: publisher application submitted under team DeepHaus after explicit
  acceptance of Publisher Terms. Portal confirmed “Thanks for applying” and
  receipt of the submission. Repository: https://github.com/lkyne7/deephaus-plugin.
  This is pending review, not a live marketplace listing. No review ID displayed.
- Claude: live portal at https://claude.ai/directory/manage/new/connector is
  accessible despite the documentation's organization-plan restriction. Existing
  DeepHaus OAuth connection selected; 12 tools detected. Listing, Education
  category, use cases, publisher and OAuth DCR fields prepared in browser draft.
  Privacy URL, reviewer account and self-test/compliance completion remain open.
- OpenAI: user signed in to DeepHaus organization; MCP-backed draft creation begun.
- Production checks: /privacy, /terms, /support and /integrations still return 404.
  Do not submit those URLs as working policy/help pages.

### Publication follow-through

Public policy/help routes were deployed and verified HTTP 200 on production:
`/privacy`, `/terms`, `/support`, `/integrations`. Publication copies are in
`docs/legal/privacy-publication-copy.md` and `terms-publication-copy.md`.
The earlier draft files remain historical review material.

Staging deployment `dpl_6QbxwSGA2qLJiFcqXcHUg2Rm5yv7` is READY. All 12 tools
passed a real HTTP MCP check with synthetic data, including refresh rotation,
scope narrowing, denied writes and replay revocation. Reproduce with
`node scripts/launch/mcp-smoke.mjs`; it seeds authorization codes directly and
therefore does not test a host's sign-in/consent UI.

The reviewed resource-binding migration is now applied to production. Browser
roles cannot execute the rotation RPC; the service role can. No historical
migration replay or ledger repair was performed.

OpenAI draft:
https://platform.openai.com/plugins/edit/asdk_app_6aac5d4650908191ac2068aa8443919f/asdk_app_v_6aac5d4713148191bbde35de396532d8
Listing, icons, three starter prompts, five positive tests, three non-invocation
negative tests, OAuth endpoint and live policy links populated. Only individual
identity LUKE THOMAS KYNE is currently offered; Dekki Inc business verification
is pending. Domain challenge token was blank in the portal; no verification
claim made. Reviewer credentials, host test evidence and demo recording remain.

### Verified final deployment

Production deployment `dpl_6qoNe5hYEgPdWwQX47Q6VyWH1yWc` is READY and aliased
to https://www.deephaus.ai. It contains HEAD `f93b05b` plus only the MCP/OAuth
and public-page changes, excluding unrelated dirty mobile/offline work.
Rollback before these changes: `dpl_BUXeeoCZSh95pXQC7zhyfkvnRwcr`.

Production synthetic-account transport check passed all 12 tools, annotation
presence, refresh rotation, scope narrowing, denied writes and replay revocation.
Script: `scripts/launch/mcp-reviewer-check.mjs`. The dedicated reviewer account's
credentials are in ignored `.env.mcp-reviewer-fixtures.local` (0600); do not commit
or publish that file. Its Pro entitlement expires September 17, 2027.
Credentials have not yet been transmitted to either review portal; explicit
approval was requested. The test seeds authorization codes directly and does
not establish that host sign-in/consent UI or the demo video requirement is done.

Policy/help URLs are live and saved in the OpenAI/Claude drafts. Remaining:
verified Dekki Inc identity in OpenAI, domain verification, host consent/login
tests, demo recording, reviewer credentials and final platform acknowledgments.
Existing OAuth connections need reconnecting after resource-binding rollout.

Reviewer email/password authentication was verified through Supabase Auth.
The post-deployment Vercel error-log query returned no matching logs; this is
a point-in-time check, not proof of continuous monitoring.


### Reviewer access and OpenAI domain verification — September 17, 2026

The user explicitly approved sharing the dedicated synthetic reviewer credentials
with Anthropic and OpenAI. Both submission drafts now contain those credentials
and sign-in instructions. Never copy the credentials into this document.
Browser email/password sign-in reached the synthetic account dashboard without
MFA, email confirmation, or onboarding.

Published the OpenAI challenge at `/.well-known/openai-apps-challenge` using the
isolated production snapshot. Deployment `dpl_2df5689bhcErkEqzja5gg8Zr2Fea` is
READY and aliased to production; the CLI lost its streaming connection, but a
separate inspect confirmed success. The live challenge returned HTTP 200 with
the exact token. OpenAI's portal now shows **Domain verified**.

OpenAI tool scanning initially returned `No authorization provided`. Setting the
explicit advertised default scopes (`study write`) initiated a fresh OAuth flow.
The consent screen now shows the synthetic reviewer account with study/write
access; action-time approval is pending. Do not claim that the scan passed.

Dekki Inc business identity verification and a Developer Mode demo recording
remain open. Claude's MCP Inspector self-test remains unchecked; the 12-tool
automated transport checks are separate evidence. Neither draft is submitted.


### OpenAI scan and Claude self-test completed

OpenAI OAuth completed in the browser and the submission now lists all 12 tools.
All 36 read-only, open-world, and destructive annotation justifications were
filled. Release notes were added. The draft was saved. The final review page
identified the demo recording as the remaining Info-field requirement; the
selected individual identity still does not match publisher Dekki Inc.

All 12 tools passed against production through the official MCP Inspector CLI
using the dedicated synthetic reviewer account. Claude now accurately shows
**Tested with MCP Inspector**. Its final page had only a non-blocking contact
email-domain advisory (info@dekki.ai versus the signed-in Gmail account). The
user submitted the Claude connector for review on September 18, 2026.

`docs/mcp-demo-recording.md` contains the requested ChatGPT recording sequence.
OpenAI organization settings now has the business-verification Persona handoff
ready. No corporate documents or identity data have been sent to Persona.

### OpenAI business-verification handoff — September 19, 2026

Persona accepted the email confirmation and is waiting for the user to select
the issuing country for their government ID, then complete the identity steps.
This handoff must remain user-controlled because it may involve government ID,
biometric checks, or corporate evidence. The OpenAI draft remains saved; its
remaining submission blocker is the Developer Mode demo-recording URL, followed
by selecting the verified Dekki Inc identity and the final policy confirmations.

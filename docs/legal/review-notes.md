# Publication decisions for Dekki Inc

These are review drafts, not a finding of legal compliance. Qualified legal
review is recommended before they become the public agreement and privacy notice.

## Confirm before publication

1. **Company details:** Notion records identify DEKKI INC., federal incorporation
   dated August 24, 2023, and registered office at 308-17 Dundonald St., Toronto,
   ON M4Y 0E4, Canada. These details have been added to the drafts. The federal
   classification comes from the corporate document metadata; the attached
   incorporation certificate itself has not yet been read.
2. **Audience:** launch countries and implementation of the researched 13+ launch
   policy (higher local independent-consent thresholds still apply). Underage
   account handling, parental authorization for minors, and analytics controls
   must match this policy. Under-13 access requires a separate child-account
   design; a policy edit alone does not implement parental consent.
3. **Retention:** actual deletion, backup, request-log, support, and analytics
   schedules. Set specific periods where possible; do not promise immediate
   deletion of provider backups or copies held by connected hosts.
4. **Analytics:** the code enables PostHog when a key is set, identifies signed-in
   users by ID/email/name, and does not explicitly disable replay. Confirm actual
   project settings and consent requirements in launch countries. Consent and
   opt-out behavior must match the notice before publishing it.
5. **Providers and transfers:** confirm contracted providers, regions, AI-provider
   retention/training settings, and transfer safeguards. The draft lists providers
   visible in the implementation; it does not certify their contracts or settings.
6. **Commercial choices:** refund policy, minimum-age policy, governing law and
   any liability cap. Checkout and store terms must match the final text.
7. **Publication:** approve final copy and effective date, then publish `/privacy`
   and `/terms` and add links to sign-up, footer, OAuth consent, and directory
   submissions. Drafts must not be used as completed policy attestations.

## Verified implementation facts

- User supplied publisher: Dekki Inc; contact: info@dekki.ai.
- MCP accesses account data using OAuth and the `study`/`write` scopes.
- `study` includes submitting review grades; it is not read-only.
- MCP creates cards from content sent by the host; it does not fetch entire host
  conversation histories on its own.
- Token/code secrets are stored hashed; content can be shared with the host through
  tool responses. Revoking access cannot erase copies already held by the host.
- PostHog initialization: `apps/web/instrumentation-client.ts`.
- Analytics identity: `apps/web/src/components/posthog-auth-sync.tsx`.
- Cloud account deletion: `apps/web/src/lib/account/deletion.ts`.
- Payments use RevenueCat with Stripe/app-store flows; AI features use OpenAI
  and Mistral where configured.

## Drafting references

- [OPC: consent and transparent privacy practices](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_consent/)
- [ICO: privacy notices and cookies](https://ico.org.uk/for-organisations/advice-for-small-organisations/privacy-notices-and-cookies/cookies-and-privacy-notices-in-detail/)

These references guide the review questions. They do not establish which laws
apply to Dekki Inc or whether a particular launch configuration complies.

## Age-policy research — 2026-09-17

Selected draft baseline: 13+, replacing the earlier 16+ suggestion, with local-law
and host eligibility restrictions. This is a launch recommendation, not a claim
that education platforms share one universal minimum age.

- [Quizlet child-user guidance](https://help.quizlet.com/hc/articles/360029923632/)
  allows younger users through parent involvement; its
  [privacy policy](https://quizlet.com/privacy) describes child accounts and consent.
- [FTC COPPA guidance](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)
  explains when under-13 data collection requires parental notice and verifiable
  consent. Educational purpose alone does not exempt a service.
- [Canadian OPC consent guidance](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/p_principle/principles/p_consent/)
  generally calls for parent/guardian consent below 13 and age-appropriate consent
  for older youth.
- [Anthropic eligibility](https://www.anthropic.com/transparency/voluntary-commitments)
  requires 18 for its consumer service; DeepHaus's age policy cannot override it.

Duolingo's current privacy page and AnkiWeb's account terms did not expose their
policy text through the research tool. Anki forum terms are not a substitute for
AnkiWeb account terms; no Anki-wide age claim is made here. Additional child-account
features should be researched and implemented before admitting under-13 users.

## Corporate source review — 2026-09-17

- [Company Info](https://app.notion.com/p/a08ed6f0160b4bf1991cb597ed482d43)
  supplies the legal name and registered office. User's supplied screenshot agrees.
- [Articles of Incorporation record](https://app.notion.com/p/23fdb4b2bbc441869c018129ac2ff0bb)
  is tagged Federal and dated August 24, 2023. The connector returned an attachment
  reference, not readable certificate content; do not claim certificate verification.
- Existing 2023 Dekki policies are present in Company Info. They already exclude
  targeting/knowingly collecting information from under-13 children. Their provider
  list (including Auth0, MongoDB, Firebase and Google Analytics) does not describe
  the current DeepHaus stack. Their cookie-consent-manager and non-identifying
  analytics claims require implementation verification and must not be copied
  as current facts.
- Existing terms refer to Canadian law but do not clearly identify a province.
  Federal incorporation does not determine the contract's provincial governing
  law. That clause remains a review item.

Only relevant corporate facts were carried into these files. Corporate access
codes and private incorporation attachments were not copied into the repository.

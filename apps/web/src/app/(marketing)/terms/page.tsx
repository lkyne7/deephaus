import { PublicInfoPage } from "@/components/public-info-page";

export const metadata = { title: "Terms of Service | DeepHaus" };

const sections = [
  {
    "heading": "Agreement and service",
    "paragraphs": [
      "These Terms govern your use of DeepHaus, operated by **Dekki Inc**, including its website, mobile applications, and AI integrations. By using DeepHaus after these Terms take effect, you agree to them. If you act for an organization, you must have authority to bind it. Contact us at **info@dekki.ai**.",
      "DeepHaus helps you create, organize, synchronize, and study flashcards. Features, usage limits, availability, and plan requirements are described in the service. An account and an eligible plan may be required for particular features, including MCP connections."
    ]
  },
  {
    "heading": "Accounts and eligibility",
    "paragraphs": [
      "You must be legally able to accept these Terms or have the necessary parent or guardian authorization where permitted. Provide accurate account information, protect your sign-in details, and tell us promptly if your account is compromised. You are responsible for activity you authorize through your account and connected applications. Do not share credentials or bypass account restrictions.",
      "You must be at least 13 years old to use DeepHaus. If local law requires a higher age to use the service independently, you must meet that age unless DeepHaus provides an approved parental-consent process for your location. If you are under the age of legal majority, your parent or legal guardian must review and agree to these Terms on your behalf. DeepHaus does not currently offer accounts for children under 13. Connected third-party services have their own eligibility requirements, which you must also meet."
    ]
  },
  {
    "heading": "Your content",
    "paragraphs": [
      "You retain ownership of content you provide. You grant Dekki Inc the rights needed to host, copy, process, transmit, display, and modify that content to provide the features you request, including generating flashcards, syncing devices, enabling chosen integrations, and publishing material you choose to share. This permission does not transfer ownership of your content.",
      "You are responsible for having the rights and permissions needed to upload or share content, including permission to process other people's personal information. Do not submit secrets, regulated records, or other sensitive material unless the service and your authorizations are suitable for that use. Material you choose to publish may be viewed or copied by others."
    ]
  },
  {
    "heading": "AI and learning limitations",
    "paragraphs": [
      "AI-generated cards, explanations, and other output can be incomplete or wrong. Review output before relying on it and verify information against appropriate sources. DeepHaus is a learning tool and does not replace qualified professional advice or guarantee exam results, retention, or other outcomes."
    ]
  },
  {
    "heading": "Connected assistants and MCP tools",
    "paragraphs": [
      "Connecting an assistant authorizes it to act within the scopes you approve. Study access can read learning information and record grades; write access can create, edit, rename, and delete supported content. Actions may affect your schedule or permanently remove content and review history.",
      "Review important actions before authorizing them. You can revoke connections in DeepHaus. The host's separate terms apply to your use of ChatGPT, Claude, Cursor, or another third-party service. We do not control those services or guarantee their continued availability or compatibility."
    ]
  },
  {
    "heading": "Acceptable use",
    "paragraphs": [
      "Do not use DeepHaus to violate law or others' rights; upload malicious code; attempt unauthorized access; interfere with the service; evade security, billing, or rate limits; or access another person's content without permission. Do not misrepresent the source of content or use the service for fraud, harassment, or other unlawful conduct."
    ]
  },
  {
    "heading": "Plans, payment, and cancellation",
    "paragraphs": [
      "Paid plans are subject to the price, billing interval, taxes, limits, renewal, cancellation, and other terms shown at checkout. Where you purchase a renewing subscription, it continues until cancelled under the checkout and provider terms. Manage subscriptions through the purchasing platform or contact info@dekki.ai for help. Deleting the app or disconnecting an assistant does not cancel a subscription.",
      "We will honor mandatory cancellation and refund rights. App-store purchases may be subject to the store's billing and refund process. Any additional refund eligibility is described at checkout or in the applicable purchasing platform\u2019s terms."
    ]
  },
  {
    "heading": "Changes, suspension, and termination",
    "paragraphs": [
      "We may update the service and will provide notice of material changes where required. We may restrict or suspend access when reasonably necessary to address security risks, misuse, nonpayment, or legal obligations. Where appropriate and practicable, we will explain the reason and provide an opportunity to resolve it.",
      "You may stop using DeepHaus, cancel a subscription through its billing channel, and request account deletion. Export material you wish to keep before deletion. Deletion and retention are described in the Privacy Policy. Obligations that naturally survive termination continue to apply."
    ]
  },
  {
    "heading": "Intellectual property",
    "paragraphs": [
      "Dekki Inc and its licensors retain rights in the DeepHaus software, branding, and other service materials. You may use the service as permitted by these Terms. Separately distributed open-source components are governed by their stated licenses. A plugin's open-source license does not license the hosted service, grant access to paid features, or grant rights to trademarks."
    ]
  },
  {
    "heading": "Service warranties and liability",
    "paragraphs": [
      "To the extent permitted by applicable law, the service is provided as available without a promise that it will be uninterrupted or error-free. Nothing in these Terms excludes or limits rights, warranties, or liabilities that cannot lawfully be excluded or limited."
    ]
  },
  {
    "heading": "Updates and contact",
    "paragraphs": [
      "We will identify the effective date of published Terms and provide notice of material changes as required. If a provision is unenforceable, the remaining provisions continue to apply to the extent permitted by law.",
      "Questions, complaints, and support requests: **Dekki Inc \u2014 info@dekki.ai**.",
      "Registered office: DEKKI INC., 308-17 Dundonald St., Toronto, ON M4Y 0E4, Canada."
    ]
  }
];

export default function Page() {
  return <PublicInfoPage title="Terms of Service"><p>Effective September 17, 2026</p>{sections.map(section => <section key={section.heading}><h2>{section.heading}</h2>{section.paragraphs.map((text, index) => <p key={index} style={{ whiteSpace: "pre-line" }}>{text.replaceAll("**", "")}</p>)}</section>)}</PublicInfoPage>;
}

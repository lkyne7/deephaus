import Link from "next/link";
import { MarketingFooter, MarketingNav } from "@/components/landing/marketing-chrome";
import { createClient } from "@/lib/supabase/server";
import "@/components/landing/landing.css";
import "@/components/landing/pricing.css";

export const metadata = {
  title: "Pricing | DeepHaus",
  description: "Choose a DeepHaus plan for AI-powered flashcards and adaptive study.",
};

const plans = [
  {
    name: "Basic",
    description: "Everything you need to make cards manually and study with FSRS.",
    monthly: "C$0",
    cadence: "forever",
    annual: "No credit card required",
    features: ["Unlimited manual flashcards", "Adaptive FSRS scheduling", "Anki import and export"],
    featured: false,
  },
  {
    name: "Plus",
    description: "More AI generation for regular classes and study projects.",
    monthly: "C$9.99",
    cadence: "per month",
    annual: "or C$99.99 billed yearly",
    features: [
      "Everything in Basic",
      "Cloud sources and automatic occlusion",
      "Advanced analytics and larger uploads",
    ],
    featured: true,
  },
  {
    name: "Pro",
    description: "Our largest monthly AI allowance for intensive study.",
    monthly: "C$19.99",
    cadence: "per month",
    annual: "or C$199.99 billed yearly",
    features: [
      "Everything in Plus",
      "8,000 monthly AI credits",
      "MCP access and highest queue priority",
    ],
    featured: false,
  },
] as const;

const matrix = [
  ["Manual flashcards and decks", true, true, true],
  ["Adaptive FSRS review scheduling", true, true, true],
  ["Anki import and export", true, true, true],
  ["AI generation credits / month", "250", "3,000", "8,000"],
  ["Cloud sources", false, true, true],
  ["Automatic occlusion", false, true, true],
  ["Advanced analytics", false, true, true],
  ["Priority processing", false, false, true],
  ["Video transcription", true, true, true],
  ["MCP access", false, false, true],
  ["Monthly subscription", false, "C$9.99", "C$19.99"],
  ["Annual subscription", false, "C$99.99", "C$199.99"],
] as const;

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const paidCtaHref = user ? "/settings/billing" : "/signup";
  const freeCtaHref = user ? "/dashboard" : "/signup";

  return (
    <div className="lp-root">
      <MarketingNav user={user} current="pricing" />

      <main>
        <header className="pricing-hero">
          <div className="lp-container pricing-hero-copy">
            <h1 className="pricing-title">Study for free. Add more AI when you need it.</h1>
            <p className="pricing-subtitle">
              Manual card creation and adaptive FSRS study stay free. Paid plans increase your
              monthly AI generation allowance.
            </p>
          </div>
        </header>

        <section className="lp-container pricing-grid" aria-label="DeepHaus plans">
          {plans.map((plan) => (
            <article
              className={`pricing-card${plan.featured ? " pricing-card-featured" : ""}`}
              key={plan.name}
            >
              {plan.featured ? <span className="pricing-popular dh-pill dh-pill--accent">Most popular</span> : null}
              <h2 className="pricing-plan">{plan.name}</h2>
              <p className="pricing-plan-copy">{plan.description}</p>
              <div className="pricing-price">
                <strong>{plan.monthly}</strong>
                <span>{plan.cadence}</span>
              </div>
              <p className="pricing-annual">{plan.annual}</p>
              <Link
                href={plan.name === "Basic" ? freeCtaHref : paidCtaHref}
                className={`btn ${plan.featured ? "btn-primary" : "btn-secondary"}`}
              >
                {plan.name === "Basic" ? "Start free" : `Choose ${plan.name}`}
              </Link>
              <ul className="pricing-features">
                {plan.features.map((feature) => (
                  <li key={feature}>
                    <i className="ri-check-line" aria-hidden />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section className="pricing-matrix-section">
          <div className="lp-container">
            <div className="lp-section-head">
              <h2 className="lp-section-title">The study system is included on every plan</h2>
              <p className="lp-section-sub">
                Your cards, scheduling, imports, and exports do not disappear when you use the free plan.
              </p>
            </div>
            <div className="pricing-matrix-wrap">
              <table className="pricing-matrix">
                <thead>
                  <tr>
                    <th scope="col">Feature</th>
                    <th scope="col">Basic</th>
                    <th scope="col">Plus</th>
                    <th scope="col">Pro</th>
                  </tr>
                </thead>
                <tbody>
                  {matrix.map(([feature, basic, plus, pro]) => (
                    <tr key={feature}>
                      <td>{feature}</td>
                      {[basic, plus, pro].map((value, index) => (
                        <td key={`${feature}-${index}`}>
                          {value === true ? (
                            <>
                              <i className="ri-check-line" aria-hidden />
                              <span className="sr-only">Included</span>
                            </>
                          ) : value === false ? (
                            <>
                              <i className="ri-subtract-line pricing-matrix-no" aria-hidden />
                              <span className="sr-only">Not included</span>
                            </>
                          ) : value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pricing-note">
              Prices in Canadian dollars. AI credits reset monthly. A generated card costs 1 credit at
              Medium effort, half a credit at Low and 10 credits at High. Taxes, if applicable, are
              calculated during checkout.
              Subscriptions renew automatically until cancelled.
            </p>
          </div>
        </section>
      </main>

      <MarketingFooter user={user} />
    </div>
  );
}

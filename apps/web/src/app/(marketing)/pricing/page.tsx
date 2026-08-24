import Link from "next/link";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-provider";
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
  ["Cloud sources", "—", true, true],
  ["Automatic occlusion", "—", true, true],
  ["Advanced analytics", "—", true, true],
  ["Priority processing", "—", "—", true],
  ["Video transcription", true, true, true],
  ["MCP access", "—", "—", true],
  ["Monthly subscription", "—", "C$9.99", "C$19.99"],
  ["Annual subscription", "—", "C$99.99", "C$199.99"],
] as const;

export default async function PricingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const paidCtaHref = user ? "/dashboard?settings=billing" : "/signup";
  const freeCtaHref = user ? "/dashboard" : "/signup";

  return (
    <div className="lp-root">
      <nav className="lp-nav">
        <div className="lp-nav-inner">
          <Link href="/" className="lp-nav-brand dh-eq dh-eq-hover">
            <BrandMark size={28} />
            <span className="dh-wordmark">DeepHaus</span>
          </Link>
          <div className="lp-nav-links">
            <Link href="/#how" className="lp-nav-link">How it works</Link>
            <Link href="/#features" className="lp-nav-link">Features</Link>
            <Link href="/pricing" className="lp-nav-link" aria-current="page">Pricing</Link>
            <Link href="/#faq" className="lp-nav-link">FAQ</Link>
          </div>
          <div className="lp-nav-actions">
            <ThemeToggle />
            {user ? (
              <Link href="/dashboard" className="btn btn-primary">Open App</Link>
            ) : (
              <>
                <Link href="/login" className="btn btn-ghost">Sign In</Link>
                <Link href="/signup" className="btn btn-primary">Get Started</Link>
              </>
            )}
          </div>
        </div>
      </nav>

      <main>
        <header className="pricing-hero">
          <div className="lp-hero-grid-bg" aria-hidden />
          <div className="lp-hero-glow" aria-hidden />
          <div className="lp-container pricing-hero-copy">
            <span className="lp-eyebrow">
              <i className="ri-price-tag-3-line" aria-hidden />
              Simple pricing in Canadian dollars
            </span>
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
              {plan.featured ? <span className="pricing-popular">Most popular</span> : null}
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
                    <i className="ri-checkbox-circle-fill" aria-hidden />
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
              <span className="lp-eyebrow">Compare plans</span>
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
                              <i className="ri-checkbox-circle-fill" aria-hidden />
                              <span className="sr-only">Included</span>
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
              AI credits reset monthly. Taxes, if applicable, are calculated during checkout.
              Subscriptions renew automatically until cancelled.
            </p>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-brand">
              <span className="lp-footer-brand-row">
                <BrandMark size={26} />
                <span className="dh-wordmark">DeepHaus</span>
              </span>
              <p className="lp-footer-blurb">
                AI-powered flashcards with adaptive spaced repetition, available on web and mobile.
              </p>
            </div>
            <div className="lp-footer-col">
              <h2 className="lp-footer-col-title">Product</h2>
              <Link href="/#features" className="lp-footer-link">Features</Link>
              <Link href="/pricing" className="lp-footer-link">Pricing</Link>
              <Link href="/#faq" className="lp-footer-link">FAQ</Link>
            </div>
            <div className="lp-footer-col">
              <h2 className="lp-footer-col-title">Get started</h2>
              <Link href="/signup" className="lp-footer-link">Create an account</Link>
              <Link href="/login" className="lp-footer-link">Sign in</Link>
              <Link href={freeCtaHref} className="lp-footer-link">Make a deck</Link>
            </div>
          </div>
          <div className="lp-footer-bottom">
            <span className="lp-footer-copy">© {new Date().getFullYear()} DeepHaus. All rights reserved.</span>
            <span className="lp-footer-tag">
              <i className="ri-heart-3-fill" aria-hidden /> Built for people with too much to remember
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

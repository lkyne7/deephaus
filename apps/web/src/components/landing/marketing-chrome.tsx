import Link from "next/link";
import type { User } from "@supabase/supabase-js";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-provider";
import { DOWNLOAD_PAGE, INTEGRATIONS_PAGE, IOS_APP } from "@/lib/apps";
import { MarketingMenu, type MenuLink } from "./marketing-menu";

type Current = "home" | "pricing" | "download";

/** Top bar shared by the landing, pricing and download pages. */
export function MarketingNav({ user, current }: { user: User | null; current: Current }) {
  // On the landing page the section links scroll in place; elsewhere they go home first.
  const home = current === "home" ? "" : "/";
  const links: MenuLink[] = [
    { href: `${home}#how`, label: "How it works" },
    { href: `${home}#features`, label: "Features" },
    { href: "/pricing", label: "Pricing", current: current === "pricing" },
    { href: DOWNLOAD_PAGE, label: "Download", current: current === "download" },
    { href: `${home}#faq`, label: "FAQ" },
  ];
  return (
    <nav className="lp-nav">
      <div className="lp-nav-inner">
        <Link href="/" className="lp-nav-brand dh-eq dh-eq-hover">
          <BrandMark size={28} />
          <span className="dh-wordmark">DeepHaus</span>
        </Link>
        <div className="lp-nav-links">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="lp-nav-link"
              aria-current={link.current ? "page" : undefined}
            >
              {link.label}
            </Link>
          ))}
        </div>
        <div className="lp-nav-actions">
          <ThemeToggle />
          {user ? (
            <Link href="/dashboard" className="btn btn-primary">Open app</Link>
          ) : (
            <>
              <Link href="/login" className="btn btn-ghost lp-nav-signin">Sign in</Link>
              <Link href="/signup" className="btn btn-primary">Get started</Link>
            </>
          )}
          <MarketingMenu links={links} signIn={!user} />
        </div>
      </div>
    </nav>
  );
}

/** Footer shared by the landing, pricing and download pages. */
export function MarketingFooter({ user }: { user: User | null }) {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer-grid">
          <div className="lp-footer-brand">
            <span className="lp-footer-brand-row">
              <BrandMark size={26} />
              <span className="dh-wordmark">DeepHaus</span>
            </span>
            <p className="lp-footer-blurb">
              AI-powered flashcards with adaptive spaced repetition. Study on the web, your computer or your phone,
              and export to Anki whenever you like.
            </p>
          </div>
          <div className="lp-footer-col">
            <h2 className="lp-footer-col-title">Product</h2>
            <Link href="/#how" className="lp-footer-link">How it works</Link>
            <Link href="/#features" className="lp-footer-link">Features</Link>
            <Link href="/pricing" className="lp-footer-link">Pricing</Link>
            <Link href="/#faq" className="lp-footer-link">FAQ</Link>
          </div>
          <div className="lp-footer-col">
            <h2 className="lp-footer-col-title">Apps</h2>
            <Link href={user ? "/dashboard" : "/signup"} className="lp-footer-link">Web app</Link>
            <Link href={DOWNLOAD_PAGE} className="lp-footer-link">Mac, Windows and Linux</Link>
            {IOS_APP.available ? (
              <a href={IOS_APP.href} className="lp-footer-link" target="_blank" rel="noreferrer">iPhone and iPad</a>
            ) : (
              <span className="lp-footer-link lp-footer-link--muted">iPhone and iPad (coming soon)</span>
            )}
            <Link href={INTEGRATIONS_PAGE} className="lp-footer-link">ChatGPT, Claude and Cursor</Link>
          </div>
          <div className="lp-footer-col">
            <h2 className="lp-footer-col-title">{user ? "Account" : "Get started"}</h2>
            {user ? (
              <>
                <Link href="/dashboard" className="lp-footer-link">Open DeepHaus</Link>
                <Link href="/create" className="lp-footer-link">Make a deck</Link>
              </>
            ) : (
              <>
                <Link href="/signup" className="lp-footer-link">Create an account</Link>
                <Link href="/login" className="lp-footer-link">Sign in</Link>
              </>
            )}
            <Link href="/support" className="lp-footer-link">Support</Link>
          </div>
        </div>
        <div className="lp-footer-bottom">
          <span className="lp-footer-legal">
            <span>© {new Date().getFullYear()} Dekki Inc.</span>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </span>
          <span>Built for people with too much to remember</span>
        </div>
      </div>
    </footer>
  );
}

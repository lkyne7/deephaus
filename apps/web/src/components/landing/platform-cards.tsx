"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { DOWNLOAD_PAGE, INTEGRATIONS_PAGE, IOS_APP } from "@/lib/apps";
import { DESKTOP_DOWNLOADS, detectDesktopPlatform } from "@/lib/desktop/downloads";

const subscribe = () => () => {};

function useDesktopDownload() {
  const platform = useSyncExternalStore(
    subscribe,
    () => detectDesktopPlatform(navigator.userAgent),
    () => null,
  );
  return DESKTOP_DOWNLOADS.find((download) => download.id === platform) ?? null;
}

/** Badge for the iPhone app: a store link once it is live, "Coming soon" until then. */
export function IosAppAction({ className = "btn btn-secondary" }: { className?: string }) {
  if (IOS_APP.available) {
    return (
      <a href={IOS_APP.href} className={className} target="_blank" rel="noreferrer">
        <i className="ri-apple-fill" aria-hidden /> Download on the App Store
      </a>
    );
  }
  return (
    <span className="dh-pill lp-apps-soon">
      <i className="ri-time-line" aria-hidden /> Coming soon to the App Store
    </span>
  );
}

/** The four ways to use DeepHaus, for the landing page. */
export function PlatformCards({ webHref }: { webHref: string }) {
  const desktop = useDesktopDownload();

  return (
    <div className="lp-apps">
      <article className="lp-apps-card">
        <span className="lp-bento-icon"><i className="ri-global-line" aria-hidden /></span>
        <h3 className="lp-bento-title">In your browser</h3>
        <p className="lp-bento-text">
          Nothing to install. Chat your sources into a deck, edit cards and review from any computer.
        </p>
        <div className="lp-apps-actions">
          <Link href={webHref} className="btn btn-secondary">Open DeepHaus</Link>
        </div>
      </article>

      <article className="lp-apps-card">
        <span className="lp-bento-icon"><i className="ri-macbook-line" aria-hidden /></span>
        <h3 className="lp-bento-title">Mac, Windows and Linux</h3>
        <p className="lp-bento-text">
          Study offline, see what&apos;s due in your dock, and generate cards with your own Claude or ChatGPT plan.
        </p>
        <div className="lp-apps-actions">
          {desktop ? (
            <>
              <a href={desktop.primary.href} className="btn btn-secondary" download>
                <i className="ri-download-2-line" aria-hidden /> {desktop.primary.label}
              </a>
              <Link href={DOWNLOAD_PAGE} className="lp-apps-link">Other platforms</Link>
            </>
          ) : (
            <Link href={DOWNLOAD_PAGE} className="btn btn-secondary">See downloads</Link>
          )}
        </div>
      </article>

      <article className="lp-apps-card">
        <span className="lp-bento-icon"><i className="ri-smartphone-line" aria-hidden /></span>
        <h3 className="lp-bento-title">iPhone and iPad</h3>
        <p className="lp-bento-text">
          Review between classes, even offline. Grades sync back to your other devices in seconds.
        </p>
        <div className="lp-apps-actions">
          <IosAppAction />
        </div>
      </article>

      <article className="lp-apps-card">
        <span className="lp-bento-icon"><i className="ri-chat-smile-2-line" aria-hidden /></span>
        <h3 className="lp-bento-title">ChatGPT, Claude and Cursor</h3>
        <p className="lp-bento-text">
          Save cards from a conversation and get quizzed on what&apos;s due without leaving your assistant. Pro plan.
        </p>
        <div className="lp-apps-actions">
          <Link href={INTEGRATIONS_PAGE} className="btn btn-secondary">Connect an assistant</Link>
        </div>
      </article>
    </div>
  );
}

"use client";

import { useSyncExternalStore } from "react";
import { DESKTOP_DOWNLOADS, detectDesktopPlatform, type DesktopPlatformId } from "@/lib/desktop/downloads";

const subscribe = () => () => {};

function useVisitorPlatform(): DesktopPlatformId | null {
  return useSyncExternalStore(
    subscribe,
    () => detectDesktopPlatform(navigator.userAgent),
    () => null,
  );
}

export function DownloadCards() {
  const visitor = useVisitorPlatform();
  const ordered = [...DESKTOP_DOWNLOADS].sort((a, b) => Number(b.id === visitor) - Number(a.id === visitor));

  return (
    <div className="download-grid">
      {ordered.map((download) => {
        const recommended = download.id === visitor;
        return (
          <article className={`pricing-card download-card${recommended ? " pricing-card-featured" : ""}`} key={download.id}>
            {recommended ? <span className="pricing-popular dh-pill dh-pill--accent">Recommended for you</span> : null}
            <i className={`${download.icon} download-icon`} aria-hidden />
            <h2 className="pricing-plan">{download.name}</h2>
            <p className="pricing-plan-copy">{download.requirements}</p>
            <a
              href={download.primary.href}
              className={`btn ${recommended ? "btn-primary" : "btn-secondary"}`}
              download
            >
              <i className="ri-download-2-line" aria-hidden /> {download.primary.label}
            </a>
            <p className="download-format">{download.primary.note}</p>
            <ul className="download-alternatives">
              {download.alternatives.map((alternative) => (
                <li key={alternative.href}>
                  <a href={alternative.href} download>
                    {alternative.label}
                  </a>
                </li>
              ))}
            </ul>
          </article>
        );
      })}
    </div>
  );
}

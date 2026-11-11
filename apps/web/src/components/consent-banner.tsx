"use client";

import Link from "next/link";
import posthog from "posthog-js";
import { useEffect, useState } from "react";
import {
  consentDecision,
  inConsentRegion,
  saveConsentDecision,
  type ConsentDecision,
} from "@/lib/consent";
import "./consent-banner.css";

const REOPEN_EVENT = "dh:analytics-consent-reopen";

/** Opens the consent banner again so a visitor can change their choice. */
export function openConsentBanner() {
  window.dispatchEvent(new Event(REOPEN_EVENT));
}

/** Whether to offer "Cookie preferences" (only where the banner applies). */
export function consentChoiceAvailable(): boolean {
  return inConsentRegion();
}

function applyDecision(decision: ConsentDecision) {
  saveConsentDecision(decision);
  if (!posthog.__loaded) return;
  if (decision === "granted") {
    posthog.set_config({ persistence: "localStorage+cookie", disable_session_recording: false });
    posthog.startSessionRecording();
  } else {
    posthog.stopSessionRecording();
    posthog.set_config({ persistence: "memory", disable_session_recording: true });
    // Drops any identifiers already stored on this device.
    posthog.reset();
  }
}

/**
 * Asks EU, EEA, UK and Swiss visitors whether DeepHaus may use analytics
 * cookies and session replay. Until they accept, analytics stay in memory and
 * anonymous; everywhere else this renders nothing.
 */
export function ConsentBanner() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(inConsentRegion() && consentDecision() === null);
    const reopen = () => setOpen(true);
    window.addEventListener(REOPEN_EVENT, reopen);
    return () => window.removeEventListener(REOPEN_EVENT, reopen);
  }, []);

  if (!open) return null;

  const choose = (decision: ConsentDecision) => {
    applyDecision(decision);
    setOpen(false);
  };

  return (
    <div className="dh-cookie-banner" role="dialog" aria-modal="false" aria-labelledby="dh-cookie-banner-title">
      <div className="dh-cookie-banner__text">
        <p id="dh-cookie-banner-title" className="dh-cookie-banner__title">
          Analytics cookies
        </p>
        <p className="dh-cookie-banner__body">
          With your OK, DeepHaus uses analytics cookies and session replay (with all text hidden) to see
          where the app gets in the way. Declining keeps analytics anonymous and stored only in memory.{" "}
          <Link href="/privacy">Privacy Policy</Link>
        </p>
      </div>
      <div className="dh-cookie-banner__actions">
        <button type="button" className="btn btn-secondary" onClick={() => choose("denied")}>
          Decline
        </button>
        <button type="button" className="btn btn-primary" onClick={() => choose("granted")}>
          Accept
        </button>
      </div>
    </div>
  );
}

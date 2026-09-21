"use client";

import { useEffect } from "react";

/** Only the offline fallback needs a new document when connectivity returns. */
export function OfflineReconnect() {
  useEffect(() => {
    const retry = () => window.location.reload();
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  return <button className="btn btn-secondary" onClick={() => window.location.reload()}>Try again</button>;
}

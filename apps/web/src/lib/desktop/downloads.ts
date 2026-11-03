/**
 * Desktop app download links.
 *
 * Asset names are version-free (see apps/desktop/electron-builder.config.js)
 * so GitHub's `releases/latest/download/<asset>` always points at the newest
 * production release.
 */
export const DESKTOP_RELEASES_URL = "https://github.com/lkyne7/deephaus/releases";

const LATEST = `${DESKTOP_RELEASES_URL}/latest/download`;

export type DesktopPlatformId = "mac" | "windows" | "linux";

export interface DesktopDownload {
  id: DesktopPlatformId;
  name: string;
  icon: string;
  requirements: string;
  primary: { label: string; href: string; note: string };
  alternatives: Array<{ label: string; href: string }>;
}

export const DESKTOP_DOWNLOADS: DesktopDownload[] = [
  {
    id: "mac",
    name: "macOS",
    icon: "ri-apple-fill",
    requirements: "macOS 12 or later, Apple silicon and Intel",
    primary: { label: "Download for Mac", href: `${LATEST}/DeepHaus-mac-universal.dmg`, note: "Universal .dmg" },
    alternatives: [{ label: ".zip archive", href: `${LATEST}/DeepHaus-mac-universal.zip` }],
  },
  {
    id: "windows",
    name: "Windows",
    icon: "ri-windows-fill",
    requirements: "Windows 10 or later",
    primary: { label: "Download for Windows", href: `${LATEST}/DeepHaus-Setup-x64.exe`, note: "64-bit installer" },
    alternatives: [{ label: "Arm64 installer", href: `${LATEST}/DeepHaus-Setup-arm64.exe` }],
  },
  {
    id: "linux",
    name: "Linux",
    icon: "ri-ubuntu-fill",
    requirements: "Most 64-bit distributions",
    primary: { label: "Download for Linux", href: `${LATEST}/DeepHaus-linux-x86_64.AppImage`, note: "AppImage" },
    alternatives: [{ label: ".deb package", href: `${LATEST}/DeepHaus-linux-amd64.deb` }],
  },
];

/** Best guess of the visitor's desktop platform from the user agent. */
export function detectDesktopPlatform(userAgent: string): DesktopPlatformId | null {
  if (/iPhone|iPad|iPod|Android/i.test(userAgent)) return null;
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "mac";
  if (/Windows/i.test(userAgent)) return "windows";
  if (/Linux|X11/i.test(userAgent)) return "linux";
  return null;
}

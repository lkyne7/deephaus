import "./auth.css";
import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/brand-mark";
import { ThemeToggle } from "@/components/theme-provider";

const GRADES = [
  { label: "Again", interval: "<1m", color: "var(--grade-again)" },
  { label: "Hard", interval: "2d", color: "var(--grade-hard)" },
  { label: "Good", interval: "4d", color: "var(--grade-good)" },
  { label: "Easy", interval: "9d", color: "var(--grade-easy)" },
];

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="dh-auth">
      <div className="dh-auth__left">
        <div className="dh-auth__top">
          <Link href="/" className="dh-auth__brand dh-eq dh-eq-hover">
            <BrandMark size={26} />
            <span className="dh-wordmark">DeepHaus</span>
          </Link>
          <ThemeToggle />
        </div>
        <div className="dh-auth__form">
          <h1>{title}</h1>
          <p className="dh-auth__sub">{subtitle}</p>
          {children}
        </div>
      </div>
      <aside className="dh-auth__right" aria-hidden>
        <div className="dh-auth__sample">
          <div className="dh-surface dh-surface--raised dh-auth__sample-card">
            <p>
              The heart&apos;s natural pacemaker is the <b>SA node</b>.
            </p>
          </div>
          <div className="dh-surface dh-surface--raised dh-auth__grades">
            {GRADES.map((grade) => (
              <span key={grade.label}>
                {grade.label}
                <small>{grade.interval}</small>
                <u style={{ background: grade.color }} />
              </span>
            ))}
          </div>
        </div>
      </aside>
    </main>
  );
}

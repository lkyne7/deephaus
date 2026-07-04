type CardStackIllustrationProps = {
  /** Slightly smaller variant for the completion screen. */
  size?: "md" | "sm";
};

function GhostLines() {
  return (
    <div className="onboarding-card-ghost" aria-hidden>
      <span style={{ width: "72%" }} />
      <span style={{ width: "100%" }} />
      <span style={{ width: "54%" }} />
    </div>
  );
}

export function CardStackIllustration({ size = "md" }: CardStackIllustrationProps) {
  return (
    <div className={`onboarding-card-stack ${size === "sm" ? "onboarding-card-stack-sm" : ""}`}>
      <div className="onboarding-card-back onboarding-card-back-1" aria-hidden>
        <GhostLines />
      </div>
      <div className="onboarding-card-back onboarding-card-back-2" aria-hidden>
        <GhostLines />
      </div>
      <div className="onboarding-card-front">
        <div className="onboarding-card-eyebrow">Cardiology · 1 of 24</div>
        <p className="onboarding-card-body">
          The heart&apos;s natural pacemaker is the{" "}
          <span className="onboarding-card-cloze">SA node</span>.
        </p>
      </div>
    </div>
  );
}

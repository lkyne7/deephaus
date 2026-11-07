import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

/** Mirrors the Create start screen: a greeting above the centered composer. */
export function CreateStartSkeleton() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 24,
        padding: "22vh 32px 80px",
        boxSizing: "border-box",
      }}
    >
      <SkeletonBar width={420} height={48} radius={10} />
      <SkeletonBlock
        style={{
          width: "100%",
          maxWidth: 696,
          padding: 14,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-secondary)",
          borderRadius: 20,
          display: "flex",
          flexDirection: "column",
          gap: 20,
        }}
      >
        <SkeletonBar width="55%" height={16} />
        <div style={{ display: "flex", gap: 8 }}>
          <SkeletonBar width={32} height={32} radius={10} />
          <SkeletonBar width={220} height={32} radius={10} />
        </div>
      </SkeletonBlock>
    </div>
  );
}

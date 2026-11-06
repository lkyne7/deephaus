import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

/** Mirrors the Create start screen: a greeting above the centered composer. */
export default function NewDeckLoading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        height: "100vh",
        padding: "24px 16px 14vh",
        boxSizing: "border-box",
      }}
    >
      <SkeletonBar width={320} height={30} radius={8} />
      <SkeletonBlock
        style={{
          width: "100%",
          maxWidth: 720,
          padding: 14,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-secondary)",
          borderRadius: 18,
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

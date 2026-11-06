import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

export default function ImportLoading() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "44px 24px 96px",
        boxSizing: "border-box",
      }}
    >
      <SkeletonBlock
        style={{
          width: "100%",
          maxWidth: 480,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-secondary)",
          borderRadius: 18,
          padding: 24,
          boxSizing: "border-box",
        }}
      >
        <SkeletonBar width={160} height={30} radius={8} />
        <SkeletonBar width={118} height={34} radius={10} />
        <SkeletonBar width="100%" height={136} radius={14} />
        <SkeletonBar width="100%" height={44} radius={8} />
        <SkeletonBar width="100%" height={44} radius={8} />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <SkeletonBar width={74} height={36} radius={9} />
          <SkeletonBar width={74} height={36} radius={9} />
        </div>
      </SkeletonBlock>
    </div>
  );
}

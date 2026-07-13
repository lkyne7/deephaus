import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

export default function ImportLoading() {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        padding: "32px 24px",
        boxSizing: "border-box",
      }}
    >
      <SkeletonBlock
        style={{
          width: "100%",
          maxWidth: 560,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          background: "var(--bg-surface)",
          border: "1px solid var(--border-secondary)",
          borderRadius: 8,
          padding: 24,
        }}
      >
        <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
          <SkeletonBar width={44} height={44} radius={10} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
            <SkeletonBar width={180} height={18} />
            <SkeletonBar width="90%" height={12} />
            <SkeletonBar width="70%" height={12} />
          </div>
        </div>
        <SkeletonBar width="100%" height={120} radius={10} />
        <SkeletonBar width="100%" height={40} radius={8} />
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          <SkeletonBar width={100} height={32} radius={8} />
          <SkeletonBar width={120} height={32} radius={8} />
        </div>
      </SkeletonBlock>
    </div>
  );
}

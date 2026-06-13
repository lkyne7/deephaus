import { SkeletonBar, SkeletonBlock } from "@/components/ui/skeleton-bars";

const pane = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border-secondary)",
  borderRadius: 8,
  display: "flex",
  flexDirection: "column" as const,
  gap: 16,
};

export default function NewDeckLoading() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(320px, 400px) minmax(0, 1fr)",
        gap: 16,
        height: "calc(100vh - var(--app-chrome-height))",
        padding: "16px 24px 20px",
        boxSizing: "border-box",
      }}
    >
      <SkeletonBlock style={{ ...pane, padding: "20px 18px" }}>
        <SkeletonBar width={80} height={16} />
        <SkeletonBar width="100%" height={36} radius={8} />
        <SkeletonBar width={120} height={12} />
        <SkeletonBar width="100%" height={140} radius={8} />
        <SkeletonBar width="100%" height={140} radius={8} />
        <SkeletonBar width={140} height={36} radius={8} />
      </SkeletonBlock>
      <SkeletonBlock style={{ ...pane, padding: 20 }}>
        <SkeletonBar width={160} height={16} />
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBar key={i} width="100%" height={48} radius={8} />
        ))}
      </SkeletonBlock>
    </div>
  );
}

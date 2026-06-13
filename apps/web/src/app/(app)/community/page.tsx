import { CommunityClientView } from "@/components/community/community-client-view";

export default function CommunityPage() {
  return (
    <div style={{ padding: "32px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
      <CommunityClientView />
    </div>
  );
}

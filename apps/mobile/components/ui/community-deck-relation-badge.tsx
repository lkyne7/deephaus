import { BadgePill, type BadgeTone } from "@/components/ui/badge-pill";
import type { IconName } from "@/components/ui/icon";

type CommunityDeckRelation = "owned" | "subscribed" | "community";

type CommunityDeckRelationSource = {
  is_owner?: boolean;
  is_subscribed?: boolean;
};

function relationForDeck(deck: CommunityDeckRelationSource): CommunityDeckRelation {
  if (deck.is_owner) return "owned";
  if (deck.is_subscribed) return "subscribed";
  return "community";
}

const RELATION_META: Record<
  CommunityDeckRelation,
  { label: string; icon: IconName; tone: BadgeTone }
> = {
  owned: { label: "Your deck", icon: "share", tone: "blue" },
  subscribed: { label: "Subscribed", icon: "bookmark", tone: "brand" },
  community: { label: "Community", icon: "earth", tone: "purple" },
};

export function CommunityDeckRelationBadge({
  deck,
}: {
  deck: CommunityDeckRelationSource;
}) {
  const meta = RELATION_META[relationForDeck(deck)];
  return <BadgePill label={meta.label} icon={meta.icon} tone={meta.tone} />;
}

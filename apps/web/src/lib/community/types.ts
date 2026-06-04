export type SyncMode = "follow" | "fork";

export type PublicationCard = {
  id: string;
  publication_id: string;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  sort_order: number;
};

export type DeckPublication = {
  id: string;
  publisher_id: string;
  source_project_id: string;
  title: string;
  description: string | null;
  version: number;
  card_count: number;
  subscriber_count: number;
  published_at: string;
  updated_at: string;
};

export type CommunityDeckRow = DeckPublication & {
  is_subscribed: boolean;
  subscription_sync_mode: SyncMode | null;
  local_project_id: string | null;
  is_owner: boolean;
};

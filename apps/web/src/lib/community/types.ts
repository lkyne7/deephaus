export type SyncMode = "follow" | "fork";

export type PublicationCard = {
  id: string;
  publication_id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  /** Image-occlusion regions (jsonb); null for other card types. */
  occlusion_data: unknown;
  tags: string[];
  sort_order: number;
};

/** Card content copied between a deck and its publication. */
export type PublicationCardContent = Pick<
  PublicationCard,
  "type" | "front" | "back" | "cloze_text" | "extra" | "occlusion_data" | "tags" | "sort_order"
>;

/** Columns selected from cards / publication_cards to build {@link PublicationCardContent}. */
export const PUBLICATION_CARD_COLUMNS =
  "type, front, back, cloze_text, extra, occlusion_data, tags, sort_order";

export type DeckPublication = {
  id: string;
  publisher_id: string;
  source_project_id: string;
  title: string;
  description: string | null;
  version: number;
  card_count: number;
  subscriber_count: number;
  avg_rating: number;
  rating_count: number;
  published_at: string;
  updated_at: string;
};

export type CommunityDeckRow = DeckPublication & {
  is_subscribed: boolean;
  subscription_sync_mode: SyncMode | null;
  local_project_id: string | null;
  is_owner: boolean;
  my_rating: number | null;
};

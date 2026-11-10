import { StudyMode } from "@/components/study-mode";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/review` studies every deck with work today; `?decks=a,b` studies just those. */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ decks?: string }>;
}) {
  const { decks } = await searchParams;
  const deckIds = (decks ?? "").split(",").filter((id) => UUID.test(id));
  return <StudyMode deckIds={deckIds.length > 0 ? deckIds : undefined} />;
}

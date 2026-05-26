import { CreateDeckView } from "@/components/create-deck-view";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string }>;
}) {
  const { deck } = await searchParams;
  return <CreateDeckView initialDeckId={deck ?? null} />;
}

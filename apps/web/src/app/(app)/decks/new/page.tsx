import { CreateDeckPageClient } from "./create-deck-page-client";

export default async function NewDeckPage({
  searchParams,
}: {
  searchParams: Promise<{ deck?: string }>;
}) {
  const { deck } = await searchParams;
  return <CreateDeckPageClient initialDeckId={deck ?? null} />;
}

import { parseStudyQueueOptions, studyQueueQuery } from "@deephaus/shared";
import { StudyMode } from "@/components/study-mode";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/review` studies every deck with work today; `?decks=a,b` studies just those;
 * `?ahead=1` and `?learning=1` bring cards forward once nothing is due.
 */
export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const read = (key: string) => {
    const value = search[key];
    return typeof value === "string" ? value : null;
  };
  const options = parseStudyQueueOptions(read);
  const deckIds = (read("decks") ?? "").split(",").filter((id) => UUID.test(id));
  return (
    <StudyMode
      key={`${deckIds.join(",")}:${studyQueueQuery(options)}`}
      deckIds={deckIds.length > 0 ? deckIds : undefined}
      options={options}
    />
  );
}

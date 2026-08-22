import { appOrigin } from "@/lib/oauth/urls";

/** MCP discovery document (Cursor-style) so hosts can find the endpoint from the domain alone. */
export function GET(req: Request) {
  const origin = appOrigin(req);
  return Response.json(
    {
      name: "DeepHaus",
      description:
        "Spaced-repetition flashcards: create decks and cards, browse your collection, run FSRS study reviews, and check learning stats.",
      icon: `${origin}/icon-512.png`,
      endpoint: `${origin}/api/mcp`,
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}

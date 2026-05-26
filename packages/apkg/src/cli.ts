#!/usr/bin/env node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApkg } from "./builder.js";

const sampleCards = [
  {
    type: "basic" as const,
    front: "What is spaced repetition?",
    back: "A learning technique that schedules reviews at increasing intervals.",
    extra: "DeepHaus sample deck",
    tags: ["DeepHaus::Sample", "Concept"],
  },
  {
    type: "cloze" as const,
    clozeText:
      "{{c1::Anki}} uses {{c2::spaced repetition}} to optimize long-term retention.",
    extra: "DeepHaus sample deck",
    tags: ["DeepHaus::Sample", "Cloze"],
  },
  {
    type: "cloze" as const,
    clozeText:
      "The maximum recommended cloze deletions per card in DeepHaus is {{c1::three}} (c1–c3).",
    extra: "DeepHaus sample deck",
    tags: ["DeepHaus::Sample", "Rules"],
  },
];

async function main() {
  const output = process.argv[2] ?? "deephaus-sample.apkg";
  const outputPath = resolve(process.cwd(), output);

  const result = await buildApkg({
    deckName: "DeepHaus Sample",
    cards: sampleCards,
    description: "Sample deck exported by DeepHaus CLI",
  });

  writeFileSync(outputPath, result.bytes);
  console.log(
    `Created ${result.cardCount} cards (${result.skipped} skipped) -> ${outputPath}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

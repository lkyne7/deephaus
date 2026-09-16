import { it, expect } from "vitest";
import fixtures from "../fixtures/generation-quality.json";
import { evaluateGenerationQuality } from "../../packages/shared/src/generation-quality";
for (const fixture of fixtures)
  it(fixture.name, () =>
    expect(
      evaluateGenerationQuality(fixture.cards, fixture.source).map(
        (d) => d.kind,
      ),
    ).toEqual(fixture.expected),
  );

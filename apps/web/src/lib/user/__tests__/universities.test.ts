import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  findUniversityByEmailDomain,
  searchUniversities,
  universityMatchesDomain,
} from "@/lib/user/universities";

describe("university registry", () => {
  it("searches canonical names and domains", () => {
    expect(searchUniversities("McMaster", 5)[0]).toMatchObject({
      name: "McMaster University",
      domains: expect.arrayContaining(["mcmaster.ca"]),
    });
    expect(searchUniversities("utoronto.ca", 5)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "University of Toronto",
        }),
      ]),
    );
  });

  it("matches student subdomains to the canonical university domain", () => {
    const university = findUniversityByEmailDomain("mail.utoronto.ca");
    expect(university).toMatchObject({ name: "University of Toronto" });
    expect(universityMatchesDomain(university!, "mail.utoronto.ca")).toBe(true);
  });
});

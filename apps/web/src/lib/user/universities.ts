import "server-only";

import registryData from "./data/world-universities.json";

type RegistryUniversity = {
  name: string;
  country: string;
  alpha_two_code: string;
  domains: string[];
};

export type UniversityOption = {
  id: string;
  name: string;
  country: string;
  country_code: string;
  domains: string[];
};

const normalizeText = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();

const normalizeDomain = (value: string) =>
  value.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");

const universities: UniversityOption[] = (registryData as RegistryUniversity[])
  .map((entry) => {
    const domains = [...new Set(entry.domains.map(normalizeDomain).filter(Boolean))];
    return {
      id: `${entry.alpha_two_code}:${entry.name}:${domains[0] ?? ""}`,
      name: entry.name.trim(),
      country: entry.country.trim(),
      country_code: entry.alpha_two_code.toUpperCase(),
      domains,
    };
  })
  .filter((entry) => entry.name && entry.domains.length > 0);

const universitiesById = new Map(universities.map((entry) => [entry.id, entry]));
const domainEntries = universities
  .flatMap((university) => university.domains.map((domain) => ({ domain, university })))
  .sort((a, b) => b.domain.length - a.domain.length);

export function getUniversityById(id: string): UniversityOption | null {
  return universitiesById.get(id) ?? null;
}

export function universityMatchesDomain(
  university: UniversityOption,
  emailDomain: string,
): boolean {
  const normalized = normalizeDomain(emailDomain);
  return university.domains.some(
    (domain) => normalized === domain || normalized.endsWith(`.${domain}`),
  );
}

export function matchedUniversityDomain(
  university: UniversityOption,
  emailDomain: string,
): string | null {
  const normalized = normalizeDomain(emailDomain);
  return (
    university.domains
      .filter((domain) => normalized === domain || normalized.endsWith(`.${domain}`))
      .sort((a, b) => b.length - a.length)[0] ?? null
  );
}

export function findUniversityByEmailDomain(emailDomain: string): UniversityOption | null {
  const normalized = normalizeDomain(emailDomain);
  return (
    domainEntries.find(
      ({ domain }) => normalized === domain || normalized.endsWith(`.${domain}`),
    )?.university ?? null
  );
}

export function searchUniversities(query: string, limit = 12): UniversityOption[] {
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery.length < 2) return [];

  return universities
    .map((university) => {
      const name = normalizeText(university.name);
      const country = normalizeText(university.country);
      const exactDomain = university.domains.some((domain) => domain === normalizedQuery);
      const domainPrefix = university.domains.some((domain) => domain.startsWith(normalizedQuery));

      let score = Number.POSITIVE_INFINITY;
      if (exactDomain) score = 0;
      else if (name === normalizedQuery) score = 1;
      else if (name.startsWith(normalizedQuery)) score = 2;
      else if (domainPrefix) score = 3;
      else if (name.includes(normalizedQuery)) score = 4;
      else if (university.domains.some((domain) => domain.includes(normalizedQuery))) score = 5;
      else if (country.includes(normalizedQuery)) score = 6;

      return { university, score };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort(
      (a, b) =>
        a.score - b.score ||
        a.university.name.localeCompare(b.university.name) ||
        a.university.country.localeCompare(b.university.country),
    )
    .slice(0, Math.min(Math.max(limit, 1), 25))
    .map(({ university }) => university);
}

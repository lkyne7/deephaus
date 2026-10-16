/** One credit per started thousand characters of spoken text. */
export function speechCredits(text: string): number {
  return Math.max(1, Math.ceil(text.length / 1000));
}

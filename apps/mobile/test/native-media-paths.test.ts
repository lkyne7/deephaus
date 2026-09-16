import { expect, it } from 'vitest';
import { persistNativeMediaEntry, restoreNativeMediaEntry } from '../lib/native-media-paths';
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const file = '33333333-3333-4333-8333-333333333333';
const directory = `file:///new-sandbox/Documents/study-media/${user}/`;
const entry = { url: 'https://example.test/card.png', bytes: 100, attempts: 1 };
it('recovers legacy downloads after an iOS sandbox relocation and migrates the persisted path', () => {
  const old = { ...entry, localUri: `file:///old-sandbox/Documents/study-media/${user}/${file}` };
  const restored = restoreNativeMediaEntry(old, user, directory);
  expect(restored).toEqual({ ...entry, localUri: `${directory}${file}` });
  expect(persistNativeMediaEntry(restored, user)).toEqual({ ...entry, localUri: `study-media/${user}/${file}` });
});
it('resolves relative records across repeated reinstalls without changing their disk representation', () => {
  const saved = { ...entry, localUri: `study-media/${user}/${file}` };
  for (const sandbox of ['first', 'second']) {
    const restored = restoreNativeMediaEntry(saved, user, `file:///${sandbox}/Documents/study-media/${user}/`);
    expect(restored.localUri).toContain(`/${sandbox}/Documents/`);
    expect(persistNativeMediaEntry(restored, user)).toEqual(saved);
  }
});
it.each([
  `study-media/${other}/${file}`,
  `file:///sandbox/Documents/study-media/${other}/${file}`,
  `file:///sandbox/Secrets/${file}`,
  `https://example.test/Documents/study-media/${user}/${file}`,
  `file://remote/Documents/study-media/${user}/${file}`,
  `study-media/${user}/../${file}`,
  `study-media/${user}/%2e%2e/${file}`,
  `file:///sandbox/Documents/study-media/${user}/${file}?extra=1`,
])('rejects a foreign account, untrusted location or traversal: %s', localUri => {
  const invalid = { ...entry, localUri };
  expect(restoreNativeMediaEntry(invalid, user, directory)).toEqual({ ...entry, bytes: 0 });
  expect(persistNativeMediaEntry(invalid, user)).toEqual({ ...entry, bytes: 0 });
});

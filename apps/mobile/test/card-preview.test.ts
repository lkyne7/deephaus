import { describe, expect, it } from 'vitest';
import { plainCardText } from '../lib/card-preview';

describe('plainCardText', () => {
  it('removes bold markers', () => {
    expect(plainCardText('The **glomerulus**.')).toBe('The glomerulus.');
  });
  it('flattens media and tolerates empty values', () => {
    expect(plainCardText('See ![leaf](a.png)')).toBe('See [image]');
    expect(plainCardText(null)).toBe('');
  });
});

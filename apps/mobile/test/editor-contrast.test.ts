import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default } }));
import { lightColors, darkColors, midnightColors } from '../lib/theme';

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return r! * 0.2126 + g! * 0.7152 + b! * 0.0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}
// Check actual semantic colors against the surfaces the editor renders on.
// WCAG 1.4.3: https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html
for (const [name, colors] of Object.entries({ light: lightColors, dark: darkColors, midnight: midnightColors })) {
  describe(`${name} editor contrast`, () => {
    it('keeps labels, placeholders, save state, errors and retry text readable', () => {
      for (const background of [colors.bgSurface, colors.bgCanvas]) {
        for (const key of ['fgPrimary', 'fgSecondary', 'fgTertiary', 'fgError', 'brand700'] as const) {
          expect(contrast(colors[key], background), `${key} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
    it('keeps input boundaries and focus indication visible', () => {
      for (const key of ['fgQuaternary', 'brand600', 'fgError'] as const) {
        expect(contrast(colors[key], colors.bgSurface), key).toBeGreaterThanOrEqual(3);
      }
    });
  });
}

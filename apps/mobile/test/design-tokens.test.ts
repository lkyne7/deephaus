import { designColors, designRadius } from '@deephaus/shared';
import { describe, expect, it, vi } from 'vitest';
vi.mock('react-native', () => ({ Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default } }));
import { darkColors, lightColors, midnightColors, radius } from '../lib/theme';

const schemes = [
  ['light', lightColors, designColors.light],
  ['dark', darkColors, designColors.dark],
] as const;

describe.each(schemes)('%s theme', (_name, colors, tokens) => {
  it('takes every surface and ink from the shared tokens', () => {
    expect(colors.bgCanvas).toBe(tokens.canvas);
    expect(colors.bgSurface).toBe(tokens.surface);
    expect(colors.fgPrimary).toBe(tokens.ink);
    expect(colors.fgSecondary).toBe(tokens.ink2);
    expect(colors.fgTertiary).toBe(tokens.ink3);
    expect(colors.line).toBe(tokens.line);
    expect(colors.gray500).toBe(tokens.gray[500]);
  });

  it('keeps one accent, and orange for due', () => {
    expect(colors.brand600).toBe(tokens.accent);
    expect(colors.brand700).toBe(tokens.accentInk);
    expect(colors.fgBrand).toBe(tokens.accentInk);
    expect(colors.orange400).toBe(tokens.dueDot);
    expect(colors.orange700).toBe(tokens.due);
  });

  it('uses the shared grade scale, heat and projected ramps', () => {
    expect([colors.gradeAgain, colors.gradeHard, colors.gradeGood, colors.gradeEasy]).toEqual([
      tokens.grade.again,
      tokens.grade.hard,
      tokens.grade.good,
      tokens.grade.easy,
    ]);
    expect(colors.heat).toEqual(tokens.heat);
    expect(colors.projected).toEqual(tokens.projected);
  });
});

describe('midnight theme', () => {
  it('is true black with the dark accent and warm ink', () => {
    expect(midnightColors.bgCanvas).toBe('#000000');
    expect(midnightColors.accent).toBe(darkColors.accent);
    expect(midnightColors.fgPrimary).toBe(darkColors.fgPrimary);
    expect(midnightColors.fgTertiary).toBe(darkColors.fgTertiary);
  });
});

describe('radius', () => {
  it('maps onto the shared scale', () => {
    expect(radius.lg).toBe(designRadius.control);
    expect(radius.xl).toBe(designRadius.input);
    expect(radius.xl3).toBe(designRadius.card);
    expect(radius.xl4).toBe(designRadius.sheet);
  });
});

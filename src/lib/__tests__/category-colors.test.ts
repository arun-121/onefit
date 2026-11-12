/// <reference types="jest" />
import { categoryColors } from '../../constants/category-colors';

const PRIMARIES = ['#415F91', '#8F4C38', '#6750A4', '#4C662B', '#904A43'];

describe('categoryColors', () => {
  it('reads the scheme’s #RRGGBBAA colours the same as #RRGGBB', () => {
    expect(categoryColors('#415F91FF', false)).toEqual(categoryColors('#415F91', false));
  });

  it('returns plain hex colours for every role', () => {
    for (const dark of [false, true]) {
      for (const roles of Object.values(categoryColors('#8F4C38', dark))) {
        for (const value of Object.values(roles)) expect(value).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('keeps the three tiles different from each other in every palette', () => {
    for (const primary of PRIMARIES) {
      for (const dark of [false, true]) {
        const { protein, carbs, fat } = categoryColors(primary, dark);
        expect(new Set([protein.container, carbs.container, fat.container]).size).toBe(3);
      }
    }
  });

  it('uses light tiles with dark text in light mode, and the reverse in dark mode', () => {
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    for (const primary of PRIMARIES) {
      for (const roles of Object.values(categoryColors(primary, false))) {
        expect(luminance(roles.container)).toBeGreaterThan(luminance(roles.onContainer));
      }
      for (const roles of Object.values(categoryColors(primary, true))) {
        expect(luminance(roles.container)).toBeLessThan(luminance(roles.onContainer));
      }
    }
  });

  it('caches per primary and mode', () => {
    expect(categoryColors('#415F91', true)).toBe(categoryColors('#415F91', true));
    expect(categoryColors('#415F91', true)).not.toBe(categoryColors('#415F91', false));
  });
});

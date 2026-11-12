/**
 * Category colours for protein, carbs and fat, the way Google Home colours its categories
 * (blue cameras, yellow lighting, peach climate).
 *
 * Material 3 calls these custom colours. Each fixed hue is nudged toward the system primary,
 * so the tiles shift with the user's Material You colour instead of standing apart from it.
 * The nudge is capped at 7.5° (half of Blend.harmonize's 15°) so carbs and fat stay clearly
 * different even when the system colour is orange or red. Everything else in the app still
 * uses the system scheme only.
 *
 * Two tonal palettes per category, like Home's tiles: a stronger one for icons, rings and text,
 * and a softer one for the tile, at the standard M3 container tones (90 light, 30 dark).
 */
import {
  Hct,
  TonalPalette,
  argbFromHex,
  differenceDegrees,
  hexFromArgb,
  rotationDirection,
  sanitizeDegreesDouble,
} from '@material/material-color-utilities';

export type Category = 'protein' | 'carbs' | 'fat';

export interface CategoryRoles {
  /** Icons, rings and progress on the container. */
  color: string;
  /** Tile background. */
  container: string;
  /** Text on the container. */
  onContainer: string;
}

const SOURCES: Record<Category, string> = {
  protein: '#1A73E8', // Google blue
  carbs: '#FBBC04', // Google yellow
  fat: '#EA4335', // Google red
};

const ACCENT_CHROMA = 48;
const SOFT_CHROMA = 32;
const MAX_ROTATION = 7.5;

const cache = new Map<string, Record<Category, CategoryRoles>>();

/** '#RRGGBB' from the scheme's '#RRGGBBAA' (the utilities read 8 digits as AARRGGBB). */
const rgb = (color: string) => color.slice(0, 7);

export function categoryColors(primary: string, dark: boolean): Record<Category, CategoryRoles> {
  const key = `${rgb(primary)}|${dark ? 'dark' : 'light'}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const primaryHue = Hct.fromInt(argbFromHex(rgb(primary))).hue;
  const roles = {} as Record<Category, CategoryRoles>;
  for (const category of Object.keys(SOURCES) as Category[]) {
    const own = Hct.fromInt(argbFromHex(SOURCES[category])).hue;
    const rotation = Math.min(differenceDegrees(own, primaryHue) * 0.5, MAX_ROTATION);
    const hue = sanitizeDegreesDouble(own + rotation * rotationDirection(own, primaryHue));
    const accent = TonalPalette.fromHueAndChroma(hue, ACCENT_CHROMA);
    const soft = TonalPalette.fromHueAndChroma(hue, SOFT_CHROMA);
    roles[category] = dark
      ? { color: hexFromArgb(accent.tone(80)), container: hexFromArgb(soft.tone(30)), onContainer: hexFromArgb(accent.tone(92)) }
      : { color: hexFromArgb(accent.tone(40)), container: hexFromArgb(soft.tone(90)), onContainer: hexFromArgb(accent.tone(20)) };
  }
  cache.set(key, roles);
  return roles;
}

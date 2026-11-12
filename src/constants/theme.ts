/**
 * Material Design 3 tokens.
 *
 * Colours: the Android system's Material You scheme is the source of truth. (The one addition is
 * three category colours for protein, carbs and fat, harmonised to it: category-colors.ts.) It is read
 * through @expo/ui (native Android dynamic colour APIs) on Android 12+, so the app follows the
 * user's wallpaper / accent exactly like Pixel first-party apps. The app never generates its own
 * palette or imposes a brand colour: phones without dynamic colour, other platforms and tests get
 * Google's static M3 baseline. Components use colour ROLES only, in their intended pairs
 * (primary + onPrimary, primaryContainer + onPrimaryContainer, surfaceContainer + onSurface, …).
 *
 * The same scheme feeds the home-screen widget, which needs hex strings: the palette is
 * '#RRGGBBAA', which both React Native and react-native-android-widget accept.
 */
import { getMaterialColors, isDynamicColorAvailable, type MaterialColors } from '@expo/ui/jetpack-compose';
import { Platform, type TextStyle } from 'react-native';
import type { ReduceMotion } from 'react-native-reanimated';

export type ColorScheme = MaterialColors;
export type SchemeMode = 'light' | 'dark';

// Material 3 baseline (static) scheme, used only when the native palette is unavailable.
const BASELINE: Record<SchemeMode, ColorScheme> = {
  light: {
    primary: '#6750A4', onPrimary: '#FFFFFF', primaryContainer: '#EADDFF', onPrimaryContainer: '#4F378B',
    inversePrimary: '#D0BCFF', secondary: '#625B71', onSecondary: '#FFFFFF', secondaryContainer: '#E8DEF8',
    onSecondaryContainer: '#4A4458', tertiary: '#7D5260', onTertiary: '#FFFFFF', tertiaryContainer: '#FFD8E4',
    onTertiaryContainer: '#633B48', background: '#FEF7FF', onBackground: '#1D1B20', surface: '#FEF7FF',
    onSurface: '#1D1B20', surfaceVariant: '#E7E0EC', onSurfaceVariant: '#49454F', surfaceTint: '#6750A4',
    inverseSurface: '#322F35', inverseOnSurface: '#F5EFF7', error: '#B3261E', onError: '#FFFFFF',
    errorContainer: '#F9DEDC', onErrorContainer: '#8C1D18', outline: '#79747E', outlineVariant: '#CAC4D0',
    scrim: '#000000', surfaceBright: '#FEF7FF', surfaceDim: '#DED8E1', surfaceContainer: '#F3EDF7',
    surfaceContainerHigh: '#ECE6F0', surfaceContainerHighest: '#E6E0E9', surfaceContainerLow: '#F7F2FA',
    surfaceContainerLowest: '#FFFFFF', primaryFixed: '#EADDFF', primaryFixedDim: '#D0BCFF', onPrimaryFixed: '#21005D',
    onPrimaryFixedVariant: '#4F378B', secondaryFixed: '#E8DEF8', secondaryFixedDim: '#CCC2DC',
    onSecondaryFixed: '#1D192B', onSecondaryFixedVariant: '#4A4458', tertiaryFixed: '#FFD8E4',
    tertiaryFixedDim: '#EFB8C8', onTertiaryFixed: '#31111D', onTertiaryFixedVariant: '#633B48',
  },
  dark: {
    primary: '#D0BCFF', onPrimary: '#381E72', primaryContainer: '#4F378B', onPrimaryContainer: '#EADDFF',
    inversePrimary: '#6750A4', secondary: '#CCC2DC', onSecondary: '#332D41', secondaryContainer: '#4A4458',
    onSecondaryContainer: '#E8DEF8', tertiary: '#EFB8C8', onTertiary: '#492532', tertiaryContainer: '#633B48',
    onTertiaryContainer: '#FFD8E4', background: '#141218', onBackground: '#E6E0E9', surface: '#141218',
    onSurface: '#E6E0E9', surfaceVariant: '#49454F', onSurfaceVariant: '#CAC4D0', surfaceTint: '#D0BCFF',
    inverseSurface: '#E6E0E9', inverseOnSurface: '#322F35', error: '#F2B8B5', onError: '#601410',
    errorContainer: '#8C1D18', onErrorContainer: '#F9DEDC', outline: '#938F99', outlineVariant: '#49454F',
    scrim: '#000000', surfaceBright: '#3B383E', surfaceDim: '#141218', surfaceContainer: '#211F26',
    surfaceContainerHigh: '#2B2930', surfaceContainerHighest: '#36343B', surfaceContainerLow: '#1D1B20',
    surfaceContainerLowest: '#0F0D13', primaryFixed: '#EADDFF', primaryFixedDim: '#D0BCFF', onPrimaryFixed: '#21005D',
    onPrimaryFixedVariant: '#4F378B', secondaryFixed: '#E8DEF8', secondaryFixedDim: '#CCC2DC',
    onSecondaryFixed: '#1D192B', onSecondaryFixedVariant: '#4A4458', tertiaryFixed: '#FFD8E4',
    tertiaryFixedDim: '#EFB8C8', onTertiaryFixed: '#31111D', onTertiaryFixedVariant: '#633B48',
  },
};

// ---------- palette store (cached; refreshed when the app returns to the foreground) ----------

let cache: Partial<Record<SchemeMode, ColorScheme>> = {};
let version = 0;
const listeners = new Set<() => void>();

function loadScheme(mode: SchemeMode): ColorScheme {
  if (Platform.OS !== 'android') return BASELINE[mode];
  try {
    // Without a seed this is the system's dynamic scheme (Android 12+) or Google's M3 baseline.
    return isDynamicColorAvailable ? getMaterialColors({ scheme: mode }) : BASELINE[mode];
  } catch {
    return BASELINE[mode];
  }
}

/** The Material You scheme for light or dark mode. Safe to call from the widget's background task. */
export function getScheme(mode: SchemeMode): ColorScheme {
  const cached = cache[mode];
  if (cached) return cached;
  const scheme = loadScheme(mode);
  cache[mode] = scheme;
  return scheme;
}

/** Re-read the palette (the wallpaper may have changed while the app was in the background). */
export function refreshScheme() {
  cache = {};
  version += 1;
  listeners.forEach((l) => l());
}

export function subscribeScheme(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSchemeVersion(): number {
  return version;
}

/** Same colour with a new opacity (0–1), for M3 state layers and tracks. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  const rgb = hex.length === 8 || hex.length === 6 ? hex.slice(0, 6) : hex;
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `#${rgb}${a}`;
}

// Protein, carbs and fat get Google Home-style category colours, harmonised to this scheme:
// see category-colors.ts.

// ---------- typography (M3 type scale, Roboto) ----------

type TypeStyle = Pick<TextStyle, 'fontSize' | 'lineHeight' | 'fontWeight' | 'letterSpacing'>;

export const Type = {
  displayLarge: { fontSize: 57, lineHeight: 64, fontWeight: '400', letterSpacing: -0.25 },
  displayMedium: { fontSize: 45, lineHeight: 52, fontWeight: '400', letterSpacing: 0 },
  displaySmall: { fontSize: 36, lineHeight: 44, fontWeight: '400', letterSpacing: 0 },
  headlineLarge: { fontSize: 32, lineHeight: 40, fontWeight: '400', letterSpacing: 0 },
  headlineMedium: { fontSize: 28, lineHeight: 36, fontWeight: '400', letterSpacing: 0 },
  headlineSmall: { fontSize: 24, lineHeight: 32, fontWeight: '400', letterSpacing: 0 },
  titleLarge: { fontSize: 22, lineHeight: 28, fontWeight: '400', letterSpacing: 0 },
  titleMedium: { fontSize: 16, lineHeight: 24, fontWeight: '500', letterSpacing: 0.15 },
  titleSmall: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  bodyLarge: { fontSize: 16, lineHeight: 24, fontWeight: '400', letterSpacing: 0.5 },
  bodyMedium: { fontSize: 14, lineHeight: 20, fontWeight: '400', letterSpacing: 0.25 },
  bodySmall: { fontSize: 12, lineHeight: 16, fontWeight: '400', letterSpacing: 0.4 },
  labelLarge: { fontSize: 14, lineHeight: 20, fontWeight: '500', letterSpacing: 0.1 },
  labelMedium: { fontSize: 12, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5 },
  labelSmall: { fontSize: 11, lineHeight: 16, fontWeight: '500', letterSpacing: 0.5 },
} as const satisfies Record<string, TypeStyle>;

export type TypeRole = keyof typeof Type;

/** M3 emphasized styles: same size, one step heavier. Used sparingly for key values. */
export const EmphasizedWeight: Record<TypeRole, '500' | '600' | '700'> = {
  displayLarge: '500',
  displayMedium: '500',
  displaySmall: '500',
  headlineLarge: '500',
  headlineMedium: '500',
  headlineSmall: '500',
  titleLarge: '500',
  titleMedium: '600',
  titleSmall: '600',
  bodyLarge: '500',
  bodyMedium: '500',
  bodySmall: '500',
  labelLarge: '600',
  labelMedium: '600',
  labelSmall: '600',
};

// ---------- shape (M3 corner scale) ----------

export const Shape = {
  none: 0,
  extraSmall: 4,
  small: 8,
  medium: 12,
  large: 16,
  largeIncreased: 20,
  extraLarge: 28,
  extraLargeIncreased: 32,
  full: 9999,
} as const;

// ---------- spacing (8dp system, with 4dp half-steps) ----------

export const Spacing = {
  /** The gap between the rows of a segmented group and the segments of a connected button group. */
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

/** Minimum touch target (dp). */
export const TOUCH_TARGET = 48;

/** The round avatar in a list row or a tile (dp). */
export const AVATAR_SIZE = 40;
/** The bottom padding a tab screen with a FAB gives its scroll content, so the last row clears the FAB. */
export const FAB_CLEARANCE = 96;

// ---------- state layers and tints ----------

/** Opacities applied with withAlpha(). */
export const Alpha = {
  /** M3 pressed state layer; the Android ripple colour is the content colour at this opacity. */
  pressed: 0.12,
  /** The unfilled part of a ring or bar, and the tint behind an avatar on a lit tile: the on-container colour at this opacity. */
  track: 0.14,
  disabledContainer: 0.12,
  disabledContent: 0.38,
} as const;

// ---------- motion (M3 Expressive springs) ----------

// The same value as ReduceMotion.System. Written out so this file, which the home-screen widget's
// background task also loads, never pulls in the animation library at run time.
const SYSTEM_REDUCE_MOTION = 'system' as ReduceMotion.System;

/**
 * Spring presets. Every one follows the phone's "Remove animations" setting.
 *
 *  - `fast`: a press going in. No overshoot, settled in about 120 ms, so a tap is answered at once.
 *  - `spatial`: a press letting go, a shape morphing, a selection moving. A slight overshoot, about 300 ms.
 *  - `value`: a ring or a bar moving to a new figure. No overshoot (a measure must never show more
 *    than it holds, even for a moment), about 500 ms so the change can be followed.
 */
export const Springs = {
  spatial: { damping: 27, stiffness: 380, mass: 1, reduceMotion: SYSTEM_REDUCE_MOTION },
  fast: { damping: 75, stiffness: 1400, mass: 1, reduceMotion: SYSTEM_REDUCE_MOTION },
  value: { damping: 22, stiffness: 120, mass: 1, reduceMotion: SYSTEM_REDUCE_MOTION },
} as const;

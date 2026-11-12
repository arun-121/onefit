import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';

import { getScheme, getSchemeVersion, subscribeScheme, type ColorScheme } from '@/constants/theme';

/**
 * The Android system's Material You scheme for the current light/dark setting.
 * Re-renders when the system appearance flips or the palette is re-read (app foreground).
 */
export function useTheme(): { colors: ColorScheme; dark: boolean } {
  // Reads the palette cache, which changes outside React; keep the compiler from caching it.
  'use no memo';
  useSyncExternalStore(subscribeScheme, getSchemeVersion, getSchemeVersion);
  const dark = useColorScheme() === 'dark';
  return { colors: getScheme(dark ? 'dark' : 'light'), dark };
}

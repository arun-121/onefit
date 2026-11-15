import { unstable_getMaterialSymbolSourceAsync, type AndroidSymbol } from 'expo-symbols';
import { NativeTabs } from 'expo-router/native-tabs';
import { useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';

import { withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const TAB_SYMBOLS: Record<'today' | 'progress' | 'assistant' | 'settings', AndroidSymbol> = {
  today: 'today',
  progress: 'monitoring',
  assistant: 'auto_awesome',
  settings: 'settings',
};

// Material Symbols rendered to images once per app run; the navigation bar tints them per state.
const loading = Object.fromEntries(
  Object.entries(TAB_SYMBOLS).map(([tab, symbol]) => [tab, unstable_getMaterialSymbolSourceAsync(symbol, 24, '#000000')]),
) as Record<keyof typeof TAB_SYMBOLS, Promise<ImageSourcePropType | null>>;

function useTabIcons() {
  const [icons, setIcons] = useState<Partial<Record<keyof typeof TAB_SYMBOLS, ImageSourcePropType>>>({});
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      (Object.keys(loading) as (keyof typeof TAB_SYMBOLS)[]).map(async (tab) => [tab, await loading[tab]] as const),
    ).then((pairs) => {
      if (cancelled) return;
      setIcons(Object.fromEntries(pairs.filter(([, src]) => src != null)));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return icons;
}

/** M3 navigation bar: surface container, secondary-container pill indicator, Material Symbols. */
export default function TabsLayout() {
  const { colors } = useTheme();
  const icons = useTabIcons();
  return (
    <NativeTabs
      backgroundColor={colors.surfaceContainer}
      indicatorColor={colors.secondaryContainer}
      rippleColor={withAlpha(colors.onSurface, 0.12)}
      iconColor={{ default: colors.onSurfaceVariant, selected: colors.onSecondaryContainer }}
      labelStyle={{ default: { color: colors.onSurfaceVariant }, selected: { color: colors.onSurface } }}
      labelVisibilityMode="labeled">
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        {icons.today ? <NativeTabs.Trigger.Icon src={icons.today} renderingMode="template" /> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="progress">
        <NativeTabs.Trigger.Label>Progress</NativeTabs.Trigger.Label>
        {icons.progress ? <NativeTabs.Trigger.Icon src={icons.progress} renderingMode="template" /> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="assistant">
        <NativeTabs.Trigger.Label>Assistant</NativeTabs.Trigger.Label>
        {icons.assistant ? <NativeTabs.Trigger.Icon src={icons.assistant} renderingMode="template" /> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
        {icons.settings ? <NativeTabs.Trigger.Icon src={icons.settings} renderingMode="template" /> : null}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

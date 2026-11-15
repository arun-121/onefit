import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { Appearance, AppState } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { SnackbarProvider, useSnackbar } from '@/components/snackbar';
import { refreshScheme, Type } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { addDays } from '@/lib/dates';
import { getDb, notifyChanged } from '@/lib/db';
import { copyMeal, syncHealthBackfill } from '@/lib/logging';
import {
  ACTION_SAME_AS_YESTERDAY,
  COME_BACK_ROUTE,
  isComeBackReminderData,
  isReminderData,
  isWeighInReminderData,
  refreshHeadsUp,
  rescheduleReminders,
  setupNotifications,
  WEIGH_IN_ROUTE,
} from '@/lib/reminders';
import { MEAL_LABELS } from '@/lib/types';
import { refreshWidgets } from '@/widget/refresh';

// Deep links (e.g. from the widget) open on top of the tabs, so Back lands on Today.
export const unstable_settings = { anchor: '(tabs)' };

// Open the database (and run migrations) before any screen reads from it.
getDb();

/** Things to redo whenever the app comes to the foreground (e.g. the day or wallpaper may have changed). */
function onForeground() {
  refreshScheme();
  notifyChanged();
  void rescheduleReminders();
  void refreshHeadsUp();
  void refreshWidgets();
  void syncHealthBackfill();
}

function useAppLifecycle() {
  useEffect(() => {
    void setupNotifications().then(onForeground);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') onForeground();
    });
    // System theme flips (and the accent changes that come with them) re-read the Material You palette.
    const appearance = Appearance.addChangeListener(() => {
      refreshScheme();
      void refreshWidgets();
    });
    return () => {
      sub.remove();
      appearance.remove();
    };
  }, []);
}

/**
 * Taps on reminders. Meals: "Same as yesterday" copies the meal, anything else opens the log
 * screen. Weigh-in: the notification and its "Log weight" button both open the weight sheet.
 * Come-back (sent after a week away): the log screen, or the weight sheet for someone who only
 * has the weigh-in reminder on.
 */
function useReminderResponses() {
  const router = useRouter();
  const showSnack = useSnackbar();
  const response = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!response) return;
    const data = response.notification.request.content.data;
    const identifier = response.notification.request.identifier;
    /** True the first time a response is seen; it is then cleared so it cannot fire again. */
    const claim = () => {
      const key = `${identifier}:${response.actionIdentifier}`;
      if (handled.current === key) return false;
      handled.current = key;
      Notifications.clearLastNotificationResponse();
      void Notifications.dismissNotificationAsync(identifier).catch(() => {});
      return true;
    };

    if (isWeighInReminderData(data)) {
      // No date: the weighing happens now, so the sheet opens on today even from yesterday's reminder.
      if (claim()) router.push(WEIGH_IN_ROUTE);
      return;
    }
    if (isComeBackReminderData(data)) {
      // Sent after a week away, so it opens on today and the meal for the time of day, not its own date.
      if (claim()) router.push(data.about === 'weigh-in' ? WEIGH_IN_ROUTE : COME_BACK_ROUTE);
      return;
    }
    if (!isReminderData(data) || !claim()) return;

    (async () => {
      if (response.actionIdentifier === ACTION_SAME_AS_YESTERDAY) {
        const copied = await copyMeal(addDays(data.date, -1), data.meal, data.date);
        if (copied > 0) {
          showSnack(`Copied yesterday's ${MEAL_LABELS[data.meal].toLowerCase()} (${copied} item${copied > 1 ? 's' : ''})`);
          return;
        }
        showSnack(`Nothing was logged for ${MEAL_LABELS[data.meal].toLowerCase()} yesterday`);
      }
      router.push({ pathname: '/log', params: { meal: data.meal, date: data.date } });
    })();
  }, [response, router, showSnack]);
}

function AppNavigator() {
  useAppLifecycle();
  useReminderResponses();
  const { colors } = useTheme();
  const sheet = {
    presentation: 'formSheet' as const,
    sheetCornerRadius: 28,
    sheetGrabberVisible: true,
    headerShown: false,
    contentStyle: { backgroundColor: colors.surfaceContainerLow },
  };
  return (
    <Stack
      screenOptions={{
        // M3 small top app bar: surface container, title large, on-surface content.
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.onSurface,
        headerTitleStyle: { fontSize: Type.titleLarge.fontSize, fontWeight: Type.titleLarge.fontWeight },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.surface },
      }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      {/* Full screen, and it draws its own title row like the sheets do, so the native header is off. */}
      <Stack.Screen name="log" options={{ title: 'Log food', presentation: 'modal', headerShown: false }} />
      {/* Google-app pattern: items and quick actions open as native bottom sheets. */}
      <Stack.Screen name="entry/[id]" options={{ ...sheet, sheetAllowedDetents: [0.85] }} />
      <Stack.Screen name="meal/[meal]" options={{ ...sheet, sheetAllowedDetents: [0.6, 0.95] }} />
      <Stack.Screen name="exercise" options={{ ...sheet, sheetAllowedDetents: [0.92] }} />
      {/* Two detents: it opens compact, and react-native-screens expands it when the keyboard comes up. */}
      <Stack.Screen name="weight" options={{ ...sheet, sheetAllowedDetents: [0.62, 0.95] }} />
      <Stack.Screen name="day/[date]" options={{ title: '' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const { colors, dark } = useTheme();
  const base = dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...base,
    colors: {
      ...base.colors,
      background: colors.surface,
      card: colors.surfaceContainer,
      text: colors.onSurface,
      border: colors.outlineVariant,
      primary: colors.primary,
      notification: colors.error,
    },
  };
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={navTheme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <SnackbarProvider>
          <AppNavigator />
        </SnackbarProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

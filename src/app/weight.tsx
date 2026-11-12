import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, TextInput, View, type TextInputInstance } from 'react-native';

import { changeSincePrevious, dayWords, keepUnits, startingWeightKg, TREND_ICONS, WEIGHT_RANGE_HINT } from '@/components/screen-text';
import { Sheet, SheetHeader, useValueColor, ValueBox } from '@/components/sheet-parts';
import { useSnackbar } from '@/components/snackbar';
import { AppText, Button, Icon, useNumberText, type IconName } from '@/components/ui';
import { Alpha, EmphasizedWeight, Shape, Spacing, Type, withAlpha } from '@/constants/theme';
import { useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatDayLabel, isDateKey } from '@/lib/dates';
import { getLatestWeight, getWeight } from '@/lib/db';
import { deleteWeight, logWeight, restoreWeight } from '@/lib/logging';
import { getSettings } from '@/lib/settings';
import type { WeightEntry } from '@/lib/types';
import { clampWeightKg, formatKg, isValidWeightKg, MAX_WEIGHT_KG, roundKg, WEIGHT_STEP_KG } from '@/lib/weight';

/** Holding − or + this long starts it repeating. */
const HOLD_DELAY_MS = 400;
/** While held, a step this often: about 12 steps, 1.2 kg, a second. */
const REPEAT_MS = 80;
/** "400.0": no weight in range takes more characters. */
const MAX_CHARACTERS = 5;
/** The number grows with the phone's font size only this far: five digits must still fit between − and +. */
const MAX_NUMBER_SCALE = 1.5;

/** Log or edit the weigh-in for a day (today unless `?date=` says otherwise). Opens as a native bottom sheet. */
export default function WeightSheet() {
  const params = useLocalSearchParams<{ date?: string }>();
  const today = useToday();
  // A weigh-in belongs to a day that has begun, so anything else falls back to today.
  const date = isDateKey(params.date) && params.date <= today ? params.date : today;
  const existing = useLiveQuery(() => getWeight(date), [date]);
  const previous = useLiveQuery(() => getLatestWeight(addDays(date, -1)), [date]);
  return <WeightForm key={date} date={date} today={today} existing={existing} previous={previous} />;
}

/**
 * One number on the sheet, and it is the input: tap it and type (the whole number is selected, so
 * the first key replaces it), and the keyboard's done key saves. − and + move it by 0.1 kg, and
 * keep going while held.
 */
function WeightForm({
  date,
  today,
  existing,
  previous,
}: {
  date: string;
  today: string;
  /** The weigh-in already saved for this day, if any. */
  existing: WeightEntry | null;
  /** The latest weigh-in before this day, to compare with. */
  previous: WeightEntry | null;
}) {
  const { back } = useRouter();
  const showSnack = useSnackbar();
  const { colors } = useTheme();
  const on = useValueColor('primary');

  // What the sheet opened on. Saving or deleting changes `existing` a moment before the sheet
  // closes; the title and buttons should not flip under the owner's thumb while it does.
  const [opened] = useState(() => {
    const latest = getLatestWeight();
    return {
      editing: existing !== null,
      fromHealth: existing?.source === 'health',
      firstEver: latest === null,
      kg: startingWeightKg({
        entryKg: existing?.kg,
        earlierKg: previous?.kg,
        latestKg: latest?.kg,
        profileKg: getSettings().profile?.weightKg,
      }),
    };
  });
  // The number as typed or stepped. It may be out of range while typing; Save waits until it is not.
  const [value, setValue] = useState(opened.kg);
  const [saving, setSaving] = useState(false);
  const [focused, setFocused] = useState(false);
  const input = useRef<TextInputInstance>(null);
  // The same reading of typed text as every other number field, held to one decimal.
  const number = useNumberText({
    value,
    onChange: setValue,
    maxDecimals: 1,
    // Always one decimal, so the number keeps its shape as it is stepped. Empty while there is none.
    format: (n) => (Number.isFinite(n) && n > 0 ? roundKg(n).toFixed(1) : ''),
  });

  // Android's back gesture puts the keyboard away but leaves the input focused, and a focused
  // input does not select its number again when tapped. Letting go of the focus with the keyboard
  // keeps "tap, then type" true every time, and takes the outline off the number.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => input.current?.blur());
    return () => sub.remove();
  }, []);

  const kg = roundKg(value);
  const valid = isValidWeightKg(kg);
  const change = valid ? changeSincePrevious(kg, previous, today) : null;
  // Under the number: the change from the weigh-in before, or what is missing. Each version fits
  // one line at the default font size, so typing never moves the Save button underneath.
  let status: { icon: IconName; text: string; color: string };
  if (!valid) {
    // Too high cannot be fixed by typing on, so it is an error. Too low is usually a number that
    // is not finished yet, so it gets the same hint without the alarm.
    status =
      kg > MAX_WEIGHT_KG
        ? { icon: 'alert-circle-outline', text: WEIGHT_RANGE_HINT, color: colors.error }
        : { icon: 'information-outline', text: WEIGHT_RANGE_HINT, color: colors.onSurfaceVariant };
  } else if (change) {
    status = { icon: TREND_ICONS[change.direction], text: change.text, color: colors.onSurfaceVariant };
  } else {
    status = {
      icon: 'information-outline',
      text: opened.firstEver ? 'This is your first weigh-in.' : 'No earlier weigh-in to compare with.',
      color: colors.onSurfaceVariant,
    };
  }

  // The timer that keeps stepping while − or + is held.
  const repeat = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRepeat = () => {
    if (repeat.current !== null) clearInterval(repeat.current);
    repeat.current = null;
  };
  // The sheet can close under a held button (the keyboard's done key, a swipe down).
  useEffect(
    () => () => {
      if (repeat.current !== null) clearInterval(repeat.current);
      repeat.current = null;
    },
    [],
  );

  const step = (direction: 1 | -1, haptic = true) => {
    if (haptic) void Haptics.selectionAsync().catch(() => {});
    // From a half-typed number, the buttons go back to where the sheet started.
    setValue((v) => (isValidWeightKg(roundKg(v)) ? clampWeightKg(roundKg(v) + direction * WEIGHT_STEP_KG) : opened.kg));
  };
  /** A hold: one step with its haptic, then a step every 80 ms without one (12 buzzes a second is noise) until the finger lifts. */
  const startRepeat = (direction: 1 | -1) => {
    stopRepeat();
    step(direction);
    repeat.current = setInterval(() => step(direction, false), REPEAT_MS);
  };

  const save = async () => {
    if (!valid || saving) return;
    stopRepeat();
    setSaving(true);
    try {
      const saved = await logWeight(date, kg);
      if (saved) {
        input.current?.blur();
        back();
        return;
      }
    } catch (e) {
      console.warn('Could not save the weigh-in', e);
    }
    setSaving(false);
    Alert.alert('Weight not saved', 'Something went wrong while saving your weight. Try again.');
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert('Delete this weigh-in?', `The ${formatKg(existing.kg)} weigh-in for ${dayWords(date, today)} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            const removed = await deleteWeight(date);
            input.current?.blur();
            back();
            if (removed) {
              showSnack('Weigh-in deleted', {
                label: 'Undo',
                // Puts back exactly what was removed: a weigh-in from another app stays that app's.
                onPress: () => void restoreWeight(removed).catch((e) => console.warn('Could not put the weigh-in back', e)),
              });
            }
          } catch (e) {
            console.warn('Could not delete the weigh-in', e);
            Alert.alert('Weigh-in not deleted', 'Something went wrong while deleting it. Try again.');
          }
        },
      },
    ]);
  };

  return (
    <Sheet>
      <SheetHeader
        title={opened.editing ? 'Edit weight' : 'Log weight'}
        supporting={formatDayLabel(date)}
        onDelete={opened.editing ? remove : undefined}
        onClose={back}
      />

      <View style={styles.block}>
        {/* Google Home's thermostat tile: − value +, and here the value is typed into as well. */}
        <ValueBox
          tone="primary"
          minus={{
            label: '0.1 kilograms less',
            onPress: () => step(-1),
            onLongPress: () => startRepeat(-1),
            onPressOut: stopRepeat,
            delayLongPress: HOLD_DELAY_MS,
          }}
          plus={{
            label: '0.1 kilograms more',
            onPress: () => step(1),
            onLongPress: () => startRepeat(1),
            onPressOut: stopRepeat,
            delayLongPress: HOLD_DELAY_MS,
          }}>
          {/* The number is a text field, so this is its own hit area and not a button: the whole well opens the
              keyboard, and TalkBack goes straight to the input inside it. Its outline shows while it has the keyboard. */}
          <Pressable
            accessible={false}
            onPress={() => input.current?.focus()}
            style={[styles.well, { borderColor: focused ? colors.primary : 'transparent' }]}>
            <TextInput
              ref={input}
              value={number.text}
              onChangeText={number.onChangeText}
              onFocus={() => setFocused(true)}
              onBlur={() => {
                setFocused(false);
                // "80" is written out as "80.0" again once typing is over.
                number.tidy();
              }}
              keyboardType="decimal-pad"
              selectTextOnFocus
              maxLength={MAX_CHARACTERS}
              // The well is as wide as five digits at this size and no wider.
              maxFontSizeMultiplier={MAX_NUMBER_SCALE}
              returnKeyType="done"
              // Done saves and puts the keyboard away. With a number that cannot be saved it stays up, to fix it.
              submitBehavior={valid ? 'blurAndSubmit' : 'submit'}
              onSubmitEditing={() => void save()}
              placeholder="0.0"
              placeholderTextColor={withAlpha(on, Alpha.disabledContent)}
              selectionColor={withAlpha(colors.primary, 0.4)}
              selectionHandleColor={colors.primary}
              cursorColor={colors.primary}
              accessibilityLabel="Weight in kilograms"
              style={[Type.displayMedium, styles.number, { color: on }]}
            />
            <AppText variant="bodyMedium" color={on} importantForAccessibility="no">
              kg
            </AppText>
          </Pressable>
        </ValueBox>
        {/* One line that is always there, so nothing below it jumps while a number is being typed.
            It is also what TalkBack says after a step: the weight, then how it compares. */}
        <View
          style={styles.status}
          accessible
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${valid ? `${kg.toFixed(1)} kilograms. ` : ''}${status.text}`}>
          <Icon name={status.icon} size={20} color={status.color} />
          <AppText variant="bodyMedium" color={status.color} textBreakStrategy="balanced" style={styles.statusText}>
            {keepUnits(status.text)}
          </AppText>
        </View>
        {opened.fromHealth ? (
          <AppText variant="bodySmall" color={colors.onSurfaceVariant} textBreakStrategy="balanced" style={styles.note}>
            This weigh-in came from another app through Health Connect. Saving replaces it with your number.
          </AppText>
        ) : null}
      </View>

      <Button
        title={opened.editing ? 'Save changes' : 'Save weight'}
        size="large"
        loading={saving}
        disabled={!valid}
        onPress={() => void save()}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.md },
  well: {
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: Shape.largeIncreased,
    // Always there, in a colour that shows only with the keyboard up, so focusing moves nothing.
    borderWidth: 2,
  },
  // Stretched across the well, so a tap anywhere on the number's row lands in the input itself.
  number: {
    alignSelf: 'stretch',
    textAlign: 'center',
    padding: 0,
    fontWeight: EmphasizedWeight.displayMedium,
    fontVariant: ['tabular-nums'],
  },
  status: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, paddingHorizontal: Spacing.lg },
  statusText: { flex: 1 },
  note: { paddingHorizontal: Spacing.lg },
});

import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { ButtonGroup } from '@/components/expressive';
import { dayWords } from '@/components/screen-text';
import { MacroFigures, Sheet, SheetHeader } from '@/components/sheet-parts';
import { useSnackbar } from '@/components/snackbar';
import { foodIcon } from '@/components/today-tiles';
import { AppText, Button, Group, GroupRow } from '@/components/ui';
import { VOICE_LOGGING } from '@/constants/features';
import { Shape, Spacing } from '@/constants/theme';
import { useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { addDays, formatDayLabel } from '@/lib/dates';
import { getEntriesForMeal } from '@/lib/db';
import { copyMeal } from '@/lib/logging';
import { formatKcal, sumMacros } from '@/lib/nutrition';
import { MEAL_LABELS, MEALS, type Macros, type Meal } from '@/lib/types';

const isMeal = (v: unknown): v is Meal => typeof v === 'string' && (MEALS as string[]).includes(v);
const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** One meal's foods, as a native bottom sheet opened from its tile on Today. */
export default function MealSheet() {
  const params = useLocalSearchParams<{ meal: string; date?: string }>();
  const { back, push } = useRouter();
  const showSnack = useSnackbar();
  const today = useToday();
  const meal: Meal = isMeal(params.meal) ? params.meal : 'snack';
  const date = isDateKey(params.date) ? params.date : today;

  const entries = useLiveQuery(() => getEntriesForMeal(date, meal), [date, meal]);
  const yesterday = useLiveQuery(() => getEntriesForMeal(addDays(date, -1), meal), [date, meal]);
  const totals = sumMacros(entries);
  const logged = entries.length > 0;

  const openLog = (mode: 'voice' | 'text') => push({ pathname: '/log', params: { mode, meal, date } });

  // Under the title: the day, and for a meal with nothing in it, that there is nothing.
  let day: string;
  if (logged) day = formatDayLabel(date);
  else if (date === today) day = 'Nothing logged yet today';
  else if (date === addDays(today, -1)) day = 'Nothing logged yesterday';
  else day = `Nothing logged on ${dayWords(date, today)}`;

  return (
    <Sheet>
      <SheetHeader title={MEAL_LABELS[meal]} supporting={day} onClose={back} />

      {logged ? (
        <View style={styles.block}>
          <MealTotals totals={totals} />
          <Group>
            {entries.map((e) => (
              <GroupRow
                key={e.id}
                icon={foodIcon(e.name)}
                tone="secondary"
                headline={e.name}
                supporting={e.portion || undefined}
                supportingLines={1}
                trailing={
                  <AppText variant="titleMedium" tabular>
                    {formatKcal(e.calories)}
                  </AppText>
                }
                onPress={() => push({ pathname: '/entry/[id]', params: { id: String(e.id) } })}
                accessibilityLabel={`${e.name}, ${e.portion}, ${Math.round(e.calories)} calories. Edit`}
              />
            ))}
          </Group>
        </View>
      ) : yesterday.length > 0 ? (
        // An empty meal offers the day before's, with what that was, so one tap fills it.
        <Group>
          <GroupRow
            icon="content-copy"
            tone="ring"
            headline="Same as yesterday"
            supporting={yesterday.map((e) => e.name).join(', ')}
            supportingLines={2}
            trailing={`${formatKcal(sumMacros(yesterday).calories)} kcal`}
            onPress={async () => {
              const n = await copyMeal(addDays(date, -1), meal, date);
              showSnack(n > 0 ? `Copied ${n} item${n > 1 ? 's' : ''} from yesterday` : 'Nothing to copy');
            }}
            accessibilityLabel={`Same as yesterday (${yesterday.length} item${yesterday.length > 1 ? 's' : ''})`}
          />
        </Group>
      ) : null}

      {VOICE_LOGGING ? (
        <ButtonGroup
          height={56}
          items={[
            { label: 'Say it', icon: 'microphone', onPress: () => openLog('voice'), variant: 'filled' },
            { label: 'Type it', icon: 'pencil-outline', onPress: () => openLog('text') },
          ]}
        />
      ) : (
        <Button title={`Add to ${MEAL_LABELS[meal].toLowerCase()}`} icon="plus" size="large" onPress={() => openLog('text')} />
      )}
    </Sheet>
  );
}

/**
 * What the meal adds up to, as the sheet's value box: the calories as the one large number, and
 * beside it protein, carbs and fat as the same figures every sheet draws them with (`MacroFigures`),
 * one under another, each with its category colour.
 */
function MealTotals({ totals }: { totals: Macros }) {
  const { colors } = useTheme();
  const on = colors.onPrimaryContainer;
  return (
    <View style={[styles.totals, { backgroundColor: colors.primaryContainer }]}>
      <View style={styles.figure} accessible accessibilityLabel={`${formatKcal(totals.calories)} calories`}>
        <AppText variant="displayMedium" emphasized tabular color={on} numberOfLines={1} maxFontSizeMultiplier={1.3}>
          {formatKcal(totals.calories)}
        </AppText>
        <AppText variant="bodyMedium" color={on}>
          kcal
        </AppText>
      </View>
      <View style={styles.macros}>
        <MacroFigures totals={totals} color={on} stacked />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.sm },
  // The number at the left, and what it is made of, one macro under another, at the right.
  totals: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xl,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    borderRadius: Shape.extraLarge,
  },
  figure: { flex: 1, minWidth: 0 },
  macros: { flex: 1, minWidth: 0 },
});

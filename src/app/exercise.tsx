import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ChoiceTile, Sheet, SheetHeader, useValueColor, ValueBox } from '@/components/sheet-parts';
import { AppText, Button, Chip, NumberField, SegmentedButtons, type IconName } from '@/components/ui';
import { Spacing, TOUCH_TARGET } from '@/constants/theme';
import { useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { formatDayLabel } from '@/lib/dates';
import { getExercise, getLatestExercise } from '@/lib/db';
import {
  ACTIVITIES,
  ACTIVITY_ORDER,
  estimateBurn,
  formatMinutes,
  INTENSITY_LABELS,
  INTENSITY_ORDER,
  isActivity,
  isIntensity,
  type Activity,
  type Intensity,
} from '@/lib/exercise';
import { deleteExercise, editExercise, logExercise } from '@/lib/logging';
import { getBodyWeightKg } from '@/lib/settings';
import type { Exercise } from '@/lib/types';

const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const QUICK_MINUTES = [15, 30, 45, 60];
const MAX_MINUTES = 600;
/** The minutes grow with the phone's font size only this far, so three digits still fit between − and +. */
const MAX_NUMBER_SCALE = 1.5;

/**
 * Where a new workout starts: the activity, intensity and length of the last one logged, since
 * most people repeat a few sessions, or a 30 minute moderate walk when there is none. Each part
 * is checked on its own, so a row from an older version or a backup cannot select nothing.
 */
function newWorkoutDefaults(last: Exercise | null): { activity: Activity; intensity: Intensity; minutes: number } {
  const minutes = last ? Math.round(last.minutes) : NaN;
  return {
    activity: isActivity(last?.activity) ? last.activity : 'walk',
    intensity: isIntensity(last?.intensity) ? last.intensity : 'moderate',
    minutes: minutes >= 1 && minutes <= MAX_MINUTES ? minutes : 30,
  };
}

/** Log or edit a workout. Opens as a native bottom sheet. */
export default function ExerciseSheet() {
  const params = useLocalSearchParams<{ id?: string; date?: string }>();
  const today = useToday();
  const existing = useLiveQuery(() => (params.id ? getExercise(Number(params.id)) : null), [params.id]);
  const date = existing?.date ?? (isDateKey(params.date) ? params.date : today);
  return <ExerciseForm key={existing?.id ?? 'new'} existing={existing} date={date} today={today} />;
}

function ExerciseForm({ existing, date, today }: { existing: Exercise | null; date: string; today: string }) {
  const { back } = useRouter();
  const { colors } = useTheme();
  const on = useValueColor('tertiary');
  // The latest weigh-in, else the weight typed into the targets calculator, else a typical 70 kg.
  const weight = useLiveQuery(getBodyWeightKg, []);

  // Read once, when the sheet opens: a new workout starts from the last one logged.
  const [start] = useState(() => newWorkoutDefaults(existing ? null : getLatestExercise()));
  const [activity, setActivity] = useState<Activity>(existing?.activity ?? start.activity);
  const [intensity, setIntensity] = useState<Intensity>(existing?.intensity ?? start.intensity);
  const [minutes, setMinutes] = useState(existing?.minutes ?? start.minutes);
  // Undefined until the user types their own number; otherwise follow the estimate. A new workout
  // never copies the last one's calories, so its estimate uses today's body weight.
  const [customKcal, setCustomKcal] = useState<number | undefined>(() =>
    existing && existing.calories !== estimateBurn(existing.activity, existing.intensity, existing.minutes, weight)
      ? existing.calories
      : undefined,
  );
  const [saving, setSaving] = useState(false);

  const estimate = estimateBurn(activity, intensity, minutes, weight);
  const calories = customKcal ?? estimate;

  const change = (patch: () => void) => {
    patch();
    // A new activity, intensity or duration means a new estimate.
    setCustomKcal(undefined);
  };

  const save = async () => {
    setSaving(true);
    const data = { activity, intensity, minutes, calories };
    if (existing) await editExercise(existing.id, data);
    else await logExercise({ ...data, date });
    back();
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert('Delete this workout?', `${ACTIVITIES[existing.activity].label} will be removed.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteExercise(existing.id);
          back();
        },
      },
    ]);
  };

  return (
    <Sheet>
      <SheetHeader
        title={existing ? 'Edit workout' : 'Log exercise'}
        supporting={date === today ? 'Today' : formatDayLabel(date)}
        onDelete={existing ? remove : undefined}
        onClose={back}
      />

      {/* Movement is tertiary everywhere: the chosen activity, the minutes, the intensity. */}
      <View style={styles.activities} accessibilityRole="radiogroup">
        {ACTIVITY_ORDER.map((a) => (
          <ChoiceTile
            key={a}
            tone="tertiary"
            icon={ACTIVITIES[a].icon as IconName}
            label={ACTIVITIES[a].label}
            selected={a === activity}
            onPress={() => change(() => setActivity(a))}
          />
        ))}
      </View>

      <View style={styles.block}>
        {/* Duration, laid out like Google Home's thermostat: − value + */}
        <ValueBox
          tone="tertiary"
          minus={{ label: '5 minutes less', onPress: () => change(() => setMinutes((m) => Math.max(5, m - 5))) }}
          plus={{ label: '5 minutes more', onPress: () => change(() => setMinutes((m) => Math.min(MAX_MINUTES, m + 5))) }}>
          <View style={styles.value} accessible accessibilityLabel={`Duration ${formatMinutes(minutes)}`}>
            <AppText variant="displayMedium" emphasized tabular color={on} numberOfLines={1} maxFontSizeMultiplier={MAX_NUMBER_SCALE}>
              {String(minutes)}
            </AppText>
            <AppText variant="bodyMedium" color={on}>
              minutes
            </AppText>
          </View>
        </ValueBox>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.bleed} contentContainerStyle={styles.quick}>
          {QUICK_MINUTES.map((m) => (
            <Chip
              key={m}
              kind="filter"
              tone="tertiary"
              label={`${m} min`}
              selected={m === minutes}
              onPress={() => change(() => setMinutes(m))}
            />
          ))}
        </ScrollView>
      </View>

      <SegmentedButtons
        tone="tertiary"
        value={intensity}
        onChange={(v) => change(() => setIntensity(v))}
        options={INTENSITY_ORDER.map((i) => ({ value: i, label: INTENSITY_LABELS[i] }))}
      />

      <View style={styles.field}>
        <NumberField label="Calories burned" suffix="kcal" value={calories} onChange={(n) => setCustomKcal(Math.round(n))} />
        <AppText variant="bodySmall" color={colors.onSurfaceVariant} textBreakStrategy="balanced" style={styles.helper}>
          {customKcal === undefined
            ? `Estimated for ${Math.round(weight)} kg. Change it if you know the real figure.`
            : `Your number. The estimate was ${estimate} kcal.`}
        </AppText>
      </View>

      <Button title={existing ? 'Save changes' : 'Log exercise'} size="large" loading={saving} disabled={minutes <= 0} onPress={() => void save()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  activities: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  block: { gap: Spacing.sm },
  value: { alignItems: 'center' },
  // The quick lengths sit centred under the number. At a large font size they no longer fit the
  // row, and then it scrolls sideways out of the sheet's gutter instead of wrapping one pill alone.
  bleed: { marginHorizontal: -Spacing.lg },
  quick: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, minHeight: TOUCH_TARGET },
  field: { gap: Spacing.xs },
  helper: { paddingHorizontal: Spacing.lg },
});

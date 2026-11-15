import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { ChoiceTile, Note, Sheet, SheetHeader, useValueColor, ValueBox } from '@/components/sheet-parts';
import { AppText, Button, Chip, Group, GroupRow, IconButton, NumberField, SegmentedButtons, TextField, type IconName } from '@/components/ui';
import { Shape, Spacing, TOUCH_TARGET } from '@/constants/theme';
import { useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { formatDayLabel } from '@/lib/dates';
import { getExercise, getLatestExercise } from '@/lib/db';
import type { WorkoutDraft } from '@/lib/ai-workout';
import {
  ACTIVITIES,
  ACTIVITY_ORDER,
  burnFromMet,
  estimateBurn,
  exerciseTitle,
  formatMinutes,
  INTENSITY_LABELS,
  INTENSITY_ORDER,
  isActivity,
  isIntensity,
  type Activity,
  type Intensity,
} from '@/lib/exercise';
import { parseWorkoutText } from '@/lib/groq';
import { deleteExercise, editExercise, logExercise } from '@/lib/logging';
import { formatKcal } from '@/lib/nutrition';
import { getBodyWeightKg, getSettings } from '@/lib/settings';
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

/**
 * A new workout is described in words and the AI works out each exercise (see `ai-workout.ts`);
 * picking an activity by hand is still there for when there is no key or no signal. A logged
 * workout opens in the hand editor.
 */
function ExerciseForm({ existing, date, today }: { existing: Exercise | null; date: string; today: string }) {
  const [byHand, setByHand] = useState(existing !== null);
  return byHand ? (
    <ManualForm existing={existing} date={date} today={today} />
  ) : (
    <DescribeForm date={date} today={today} onByHand={() => setByHand(true)} />
  );
}

function DescribeForm({ date, today, onByHand }: { date: string; today: string; onByHand: () => void }) {
  const { back } = useRouter();
  const { colors } = useTheme();
  const weight = useLiveQuery(getBodyWeightKg, []);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<WorkoutDraft[] | null>(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const workOut = async () => {
    setBusy(true);
    setError(null);
    try {
      const parsed = await parseWorkoutText(text.trim(), getSettings().textModel, weight);
      setDrafts(parsed.items);
      setNote(parsed.items.length ? parsed.note : parsed.note || 'That did not read as exercise. Try naming what you did, with sets, reps or time.');
      setOpen(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const patch = (key: string, change: Partial<WorkoutDraft>) =>
    setDrafts((list) => list?.map((d) => (d.key === key ? { ...d, ...change } : d)) ?? null);

  const save = async () => {
    if (!drafts?.length) return;
    setSaving(true);
    for (const d of drafts) {
      await logExercise({
        date,
        activity: d.activity,
        intensity: d.intensity,
        minutes: d.minutes,
        calories: d.calories,
        name: d.name,
        details: d.details,
        sets: d.sets,
        reps: d.reps,
        loadKg: d.loadKg,
        met: d.met,
      });
    }
    back();
  };

  const total = drafts?.reduce((a, d) => a + d.calories, 0) ?? 0;
  const minutes = drafts?.reduce((a, d) => a + d.minutes, 0) ?? 0;

  return (
    <Sheet>
      <SheetHeader title="Log exercise" supporting={date === today ? 'Today' : formatDayLabel(date)} onClose={back} />

      <View style={styles.field}>
        <TextField
          label="What did you do?"
          value={text}
          onChangeText={(t) => {
            setText(t);
            setError(null);
          }}
          placeholder="Bench press 4×10 at 60 kg, squats 5×5 at 80 kg, 20 min easy run"
          multiline
          autoFocus
        />
      </View>
      <Button
        title={drafts ? 'Work it out again' : 'Work it out'}
        icon="auto-fix"
        size="large"
        variant={drafts ? 'tonal' : 'filled'}
        loading={busy}
        disabled={text.trim().length === 0 || busy}
        onPress={() => void workOut()}
      />
      {error ? (
        <Note icon="alert-circle-outline" color={colors.error}>
          {error}
        </Note>
      ) : null}

      {drafts && drafts.length > 0 ? (
        <View style={styles.block}>
          <Group>
            {drafts.map((d) => (
              <GroupRow
                key={d.key}
                icon={ACTIVITIES[d.activity].icon as IconName}
                tone="tertiary"
                headline={d.name}
                supporting={`${d.details ? `${d.details}, ` : ''}${formatMinutes(d.minutes)}`}
                trailing={
                  <AppText variant="labelLarge" tabular color={colors.tertiary}>
                    {`+${formatKcal(d.calories)} kcal`}
                  </AppText>
                }
                onPress={() => setOpen((k) => (k === d.key ? null : d.key))}
                accessibilityLabel={`${d.name}, ${formatMinutes(d.minutes)}, ${d.calories} calories. Change`}
              />
            ))}
          </Group>
          {drafts
            .filter((d) => d.key === open)
            .map((d) => (
              <View key={d.key} style={[styles.editor, { backgroundColor: colors.surfaceContainerHigh }]}>
                <View style={styles.editorHead}>
                  <AppText variant="titleSmall" emphasized style={styles.grow}>
                    {d.name}
                  </AppText>
                  <IconButton
                    icon="trash-can-outline"
                    label={`Remove ${d.name}`}
                    onPress={() => {
                      setDrafts((list) => list?.filter((x) => x.key !== d.key) ?? null);
                      setOpen(null);
                    }}
                  />
                </View>
                <View style={styles.row}>
                  <NumberField
                    label="Minutes"
                    value={d.minutes}
                    selectOnFocus
                    // New minutes, new calories at the same effort.
                    onChange={(m) => patch(d.key, { minutes: Math.round(m), calories: burnFromMet(d.met, m, weight) })}
                  />
                  <NumberField label="Calories" suffix="kcal" value={d.calories} selectOnFocus onChange={(c) => patch(d.key, { calories: Math.round(c) })} />
                </View>
                <AppText variant="bodySmall" color={colors.onSurfaceVariant}>
                  {`Effort ${d.met} MET, ${ACTIVITIES[d.activity].label.toLowerCase()}, ${INTENSITY_LABELS[d.intensity].toLowerCase()}.`}
                </AppText>
              </View>
            ))}
          <Note>{`${note ? `${note} ` : ''}Calories are worked out for ${Math.round(weight)} kg from each exercise's effort. Tap one to change it.`}</Note>
        </View>
      ) : drafts ? (
        <Note>{note}</Note>
      ) : null}

      {drafts && drafts.length > 0 ? (
        <Button
          title={`Log workout, +${formatKcal(total)} kcal`}
          size="large"
          icon="check"
          loading={saving}
          onPress={() => void save()}
          accessibilityLabel={`Log workout: ${formatMinutes(minutes)}, ${total} calories`}
        />
      ) : null}
      <Button title="Pick an activity instead" variant="text" onPress={onByHand} style={styles.end} />
    </Sheet>
  );
}

function ManualForm({ existing, date, today }: { existing: Exercise | null; date: string; today: string }) {
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
  const [customKcal, setCustomKcal] = useState<number | undefined>(() => {
    if (!existing) return undefined;
    const was = existing.met ? burnFromMet(existing.met, existing.minutes, weight) : estimateBurn(existing.activity, existing.intensity, existing.minutes, weight);
    return existing.calories !== was ? existing.calories : undefined;
  });
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(existing?.name ?? '');
  const [details, setDetails] = useState(existing?.details ?? '');
  // A described workout keeps the effort the AI gave it until the activity or intensity changes.
  const [met, setMet] = useState<number | null>(existing?.met ?? null);

  const estimate = met !== null ? burnFromMet(met, minutes, weight) : estimateBurn(activity, intensity, minutes, weight);
  const calories = customKcal ?? estimate;

  const change = (patch: () => void, keepEffort = false) => {
    patch();
    if (!keepEffort) setMet(null);
    // A new activity, intensity or duration means a new estimate.
    setCustomKcal(undefined);
  };

  const save = async () => {
    setSaving(true);
    const data = { activity, intensity, minutes, calories, name: name.trim(), details: details.trim(), met };
    if (existing) await editExercise(existing.id, data);
    else await logExercise({ ...data, date });
    back();
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert('Delete this workout?', `${exerciseTitle(existing)} will be removed.`, [
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

      {existing?.name || existing?.details ? (
        <View style={styles.row}>
          <View style={styles.grow}>
            <TextField label="Name" value={name} onChangeText={setName} />
          </View>
          <View style={styles.grow}>
            <TextField label="What you did" value={details} onChangeText={setDetails} />
          </View>
        </View>
      ) : null}

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
          minus={{ label: '5 minutes less', onPress: () => change(() => setMinutes((m) => Math.max(5, m - 5)), true) }}
          plus={{ label: '5 minutes more', onPress: () => change(() => setMinutes((m) => Math.min(MAX_MINUTES, m + 5)), true) }}>
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
              onPress={() => change(() => setMinutes(m), true)}
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
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  grow: { flex: 1, minWidth: 0 },
  editor: { borderRadius: Shape.large, padding: Spacing.lg, gap: Spacing.sm },
  editorHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  end: { alignSelf: 'center' },
  helper: { paddingHorizontal: Spacing.lg },
});

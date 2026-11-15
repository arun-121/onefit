import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';

import { Disclosure, GlanceFigure } from '@/components/glance';
import { effortLevel, keepUnits } from '@/components/screen-text';
import { Chevron, Panel } from '@/components/settings-parts';
import { ChoiceTile, EffortMark, Note, Sheet, SheetHeader, useValueColor, ValueBox } from '@/components/sheet-parts';
import { AppText, Avatar, Button, Chip, Group, GroupItem, NumberField, SegmentedButtons, TextField, type IconName } from '@/components/ui';
import { Spacing, TOUCH_TARGET } from '@/constants/theme';
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
      {/* The two ways in, as Log food has them: the AI, and under it the hand-picked activity. So the
          sheet still ends on its one main button once there is a workout to log. */}
      <View style={styles.actions}>
        <Button
          title={drafts ? 'Work it out again' : 'Work it out'}
          icon="auto-fix"
          size="large"
          variant={drafts ? 'tonal' : 'filled'}
          loading={busy}
          disabled={text.trim().length === 0 || busy}
          onPress={() => void workOut()}
        />
        <Button title="Pick an activity instead" variant="text" hitSlop={4} onPress={onByHand} style={styles.end} />
      </View>
      {error ? (
        <Note icon="alert-circle-outline" color={colors.error}>
          {error}
        </Note>
      ) : null}

      {drafts && drafts.length > 0 ? (
        <View style={styles.results}>
          {/* The one number: what the whole workout burned, and in how long. */}
          <GlanceFigure
            value={formatKcal(total)}
            unit={`kcal in ${formatMinutes(minutes)}`}
            accessibilityLabel={`${total} calories in ${formatMinutes(minutes)}, from ${drafts.length} ${drafts.length === 1 ? 'exercise' : 'exercises'}`}
          />
          {/* A tapped exercise opens its editor straight under it, as a row of the same group, the way
              a row opens in Settings; the chevron says which one is open. */}
          <Group>
            {drafts.map((d) => [
              <DraftRow key={d.key} draft={d} open={open === d.key} onPress={() => setOpen((k) => (k === d.key ? null : d.key))} />,
              open === d.key ? (
                <Panel key={`${d.key}-editor`} appear color={colors.surfaceContainerHigh}>
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
                  <View style={styles.editorFoot}>
                    <AppText variant="bodySmall" color={colors.onSurfaceVariant} style={styles.grow}>
                      {`Logged as ${ACTIVITIES[d.activity].label.toLowerCase()}, ${INTENSITY_LABELS[d.intensity].toLowerCase()}`}
                    </AppText>
                    <Button
                      title="Remove"
                      icon="trash-can-outline"
                      variant="text"
                      hitSlop={4}
                      accessibilityLabel={`Remove ${d.name}`}
                      onPress={() => {
                        setDrafts((list) => list?.filter((x) => x.key !== d.key) ?? null);
                        setOpen(null);
                      }}
                    />
                  </View>
                </Panel>
              ) : null,
            ])}
          </Group>
          {/* The AI's own note stays, as the one line; how the figures are made is one tap away. */}
          {note ? <Note>{note}</Note> : null}
          <Disclosure>
            {keepUnits(`Calories are worked out for ${Math.round(weight)} kg from each exercise's effort, its MET: (MET − 1) × weight × hours, what the workout adds on top of resting.`)}
            {'The bars show the effort: one under 3 MET, two up to 6, three from 6. Tap an exercise to change its minutes or calories.'}
          </Disclosure>
        </View>
      ) : drafts ? (
        <Note>{note}</Note>
      ) : null}

      {drafts && drafts.length > 0 ? (
        <Button
          // The total is the figure above the list; the button only says what it does.
          title="Log workout"
          size="large"
          icon="check"
          loading={saving}
          onPress={() => void save()}
          accessibilityLabel={`Log workout: ${formatMinutes(minutes)}, ${total} calories`}
        />
      ) : null}
    </Sheet>
  );
}

/**
 * One exercise the AI read from the description, as a row of a segmented group: the activity's
 * avatar, the name and what was done, the effort as rising bars, and at the right the calories
 * (movement's `tertiary`) over the minutes, then the chevron of a row that opens. Tapping it opens
 * its editor under it, and the chevron turns over.
 */
function DraftRow({ draft: d, open, onPress }: { draft: WorkoutDraft; open: boolean; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <GroupItem
      onPress={onPress}
      accessibilityState={{ expanded: open }}
      accessibilityLabel={`${d.name}${d.details ? `, ${d.details}` : ''}, ${formatMinutes(d.minutes)}, ${d.calories} calories, ${effortLevel(d.met).spoken}. Change`}
      style={styles.draft}>
      <Avatar icon={ACTIVITIES[d.activity].icon as IconName} tone="tertiary" />
      <View style={styles.draftText}>
        <AppText variant="titleMedium" numberOfLines={2}>
          {d.name}
        </AppText>
        {/* What was done, then how hard: one line that wraps the effort under it only when it must. */}
        <View style={styles.draftMeta}>
          {d.details ? (
            <AppText variant="bodyMedium" color={colors.onSurfaceVariant} numberOfLines={1} style={styles.shrink}>
              {keepUnits(d.details)}
            </AppText>
          ) : null}
          <EffortMark met={d.met} />
        </View>
      </View>
      <View style={styles.draftFigures}>
        <AppText variant="titleMedium" emphasized tabular color={colors.tertiary} numberOfLines={1}>
          {`+${formatKcal(d.calories)}`}
          <AppText variant="labelLarge" color={colors.tertiary}>
            {'\u00A0kcal'}
          </AppText>
        </AppText>
        <AppText variant="labelMedium" tabular color={colors.onSurfaceVariant} numberOfLines={1}>
          {formatMinutes(d.minutes)}
        </AppText>
      </View>
      <Chevron open={open} />
    </GroupItem>
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
          {customKcal === undefined ? `Estimate for ${Math.round(weight)} kg` : `Your figure. Estimate ${formatKcal(estimate)} kcal`}
        </AppText>
      </View>

      <Button title={existing ? 'Save changes' : 'Log exercise'} size="large" loading={saving} disabled={minutes <= 0} onPress={() => void save()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  activities: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  block: { gap: Spacing.sm },
  results: { gap: Spacing.md },
  actions: { gap: Spacing.sm },
  value: { alignItems: 'center' },
  // The quick lengths sit centred under the number. At a large font size they no longer fit the
  // row, and then it scrolls sideways out of the sheet's gutter instead of wrapping one pill alone.
  bleed: { marginHorizontal: -Spacing.lg },
  quick: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.lg, minHeight: TOUCH_TARGET },
  field: { gap: Spacing.xs },
  row: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'flex-start' },
  grow: { flex: 1, minWidth: 0 },
  // The measures of a GroupRow, with room for a third line: the effort, and the chevron at the end.
  draft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, minHeight: 72, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md },
  draftText: { flex: 1, minWidth: 0, gap: 2 },
  draftMeta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.md, rowGap: 2 },
  shrink: { flexShrink: 1 },
  draftFigures: { alignItems: 'flex-end' },
  // What the exercise is logged as, and the button that takes it off the list.
  editorFoot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: -Spacing.sm, marginRight: -Spacing.md },
  end: { alignSelf: 'center' },
  helper: { paddingHorizontal: Spacing.lg },
});

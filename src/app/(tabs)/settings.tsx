import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Linking, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { requestPinWidget } from 'react-native-android-widget';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Disclosure } from '@/components/glance';
import {
  backupProblemsText,
  countBackup,
  goalPlan,
  goalStatusText,
  healthSync,
  healthText,
  keepUnits,
  restoreConfirmText,
  restoreDoneText,
  WEIGHT_RANGE_HINT,
  type DataCounts,
} from '@/components/screen-text';
import { ActionRow, ButtonRow, Cue, ExpanderRow, FieldCard, litTone, Panel, Pill, ROOMY_FONT_SCALE, SyncIcons } from '@/components/settings-parts';
import { MacroFigures } from '@/components/sheet-parts';
import { useSnackbar } from '@/components/snackbar';
import { foodIcon, MEAL_ICONS } from '@/components/today-tiles';
import {
  AppText,
  Button,
  Chip,
  Group,
  GroupRow,
  IconButton,
  NumberField,
  Row,
  ScreenHeader,
  SectionHeader,
  SegmentedButtons,
  Switch,
  TextField,
} from '@/components/ui';
import { VOICE_LOGGING } from '@/constants/features';
import { Shape, Spacing, Type } from '@/constants/theme';
import { useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { exportBackupFile, pickAndCheckBackup, restoreFromBackup, type BackupFile } from '@/lib/backup';
import { formatTime } from '@/lib/dates';
import {
  deleteFood,
  getAllExercises,
  getAllFoods,
  getAllWeights,
  getLatestWeight,
  getLoggedDates,
  notifyChanged,
  setFoodPinned,
} from '@/lib/db';
import { getStoredApiKey, hasEnvApiKey, listModels, saveApiKey } from '@/lib/groq';
import {
  getHealthAvailability,
  getHealthGrants,
  openHealthSettings,
  requestHealthPermissions,
  type HealthAvailability,
  type HealthGrants,
} from '@/lib/health';
import { loadCurrentWeightKg } from '@/lib/insights-data';
import { syncHealthBackfill } from '@/lib/logging';
import {
  ACTIVITY_LABELS,
  calculateTargets,
  formatKcal,
  GOAL_LABELS,
  MIN_CALORIE_TARGET,
  GOAL_RATES,
  goalRateKg,
  type ActivityLevel,
  type GoalType,
  type Profile,
} from '@/lib/nutrition';
import {
  anyReminderEnabled,
  ensureNotificationPermission,
  hasNotificationPermission,
  REMINDER_MEALS,
  requestNotifications,
  refreshHeadsUp,
  rescheduleReminders,
} from '@/lib/reminders';
import {
  applyCalculatedTargets,
  DEFAULT_MODELS,
  getSettings,
  setWeightGoal,
  updateSettings,
  type ReminderMeal,
  type ReminderSetting,
} from '@/lib/settings';
import { MEAL_LABELS } from '@/lib/types';
import { formatKg, isValidWeightKg, MAX_WEIGHT_KG, roundKg } from '@/lib/weight';
import { refreshWidgets } from '@/widget/refresh';
import { WIDGET_CALORIES_LEFT, WIDGET_QUICK_LOG } from '@/widget/CalorieWidgets';

/** How many saved foods the list shows. */
const FOODS_SHOWN = 40;

/**
 * Settings, top to bottom: the daily targets, reminders, Google Fit and Health Connect, the home
 * screen widgets, the AI key and models, backup, and the saved foods. Each section is a header
 * and one segmented group of rows (docs/DESIGN.md). A row's avatar is lit in its subject's colour
 * while the thing it stands for is on, and a plain ring while it is off or not set up yet.
 */
export default function SettingsScreen() {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  // Counts restores. The targets group keeps a draft of the calculator; after a restore it starts
  // again from the restored settings instead of showing numbers from the data that was replaced.
  const [restores, setRestores] = useState(0);
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View>
          {/* Today and Progress have a line above their title. Its height is left free here, so the
              title stays where it is when the tab changes. */}
          <ScreenHeader title="Settings" style={{ paddingTop: Spacing.lg + Type.bodyLarge.lineHeight * fontScale }} />
          <TargetsSection key={restores} />
        </View>
        <RemindersSection />
        <HealthSection />
        {Platform.OS === 'android' ? <WidgetSection /> : null}
        <AiSection />
        <DataSection onRestored={() => setRestores((n) => n + 1)} />
        <FavouritesSection />
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------- targets

const DEFAULT_PROFILE: Profile = { sex: 'male', age: 30, heightCm: 170, weightKg: 70, activity: 'light', goal: 'lose_fat', rateKg: 0.5 };

function TargetsSection() {
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const showSnack = useSnackbar();
  const today = useToday();
  const settings = useLiveQuery(getSettings, []);
  const latestWeight = useLiveQuery(() => getLatestWeight(), []);
  // The weight now as Progress works it out (not one weigh-in), so the two screens agree on how far
  // there is to go and on the weight the targets are worked out for.
  const currentKg = useLiveQuery(() => loadCurrentWeightKg(today), [today]);
  const [showCalc, setShowCalc] = useState(false);
  const [profile, setProfile] = useState<Profile>(() => {
    // The profile only remembers what was typed into the calculator; the weight now comes from the weigh-ins.
    const base = settings.profile ?? DEFAULT_PROFILE;
    return currentKg !== null ? { ...base, weightKg: currentKg } : base;
  });
  // The number being typed into the target weight field. Null until the field is touched.
  const [goalDraft, setGoalDraft] = useState<number | null>(null);
  // Counts the times the field was put back to the saved target, which starts it afresh.
  const [goalFieldResets, setGoalFieldResets] = useState(0);
  const preview = calculateTargets(profile);
  const rateRange = GOAL_RATES[profile.goal];
  // Says the range, and when the typed pace is outside it, the pace that is used instead.
  const rateText = (() => {
    if (!rateRange) return '';
    const typed = profile.rateKg;
    const used = goalRateKg(profile);
    const range = `${rateRange.min} to ${rateRange.max} kg a week`;
    return typed !== undefined && typed > 0 && Math.abs(typed - used) > 1e-9 ? `${range}. Using ${used} kg` : range;
  })();
  const setP = (patch: Partial<Profile>) => setProfile((p) => ({ ...p, ...patch }));
  // The plan in figures for the result card, and in words for the disclosure under it.
  const plan = goalPlan(profile, settings.weightGoalKg);

  const save = (patch: Parameters<typeof updateSettings>[0]) => {
    updateSettings(patch);
    void refreshWidgets();
  };

  const toggleCalc = () => {
    // Opening the calculator starts from the weight now, which may have moved since the last visit.
    if (!showCalc && currentKg !== null) setP({ weightKg: currentKg });
    setShowCalc((s) => !s);
  };

  const goal = settings.weightGoalKg;
  const changeGoal = (n: number) => {
    setGoalDraft(n);
    // Setting or changing the target stamps where it starts from (the latest weigh-in). An empty
    // field, or a number that is not a weight yet, is still being typed, so the saved target and
    // its starting point stay as they are. Only the clear button removes a target.
    const kg = roundKg(n);
    if (isValidWeightKg(kg)) setWeightGoal(kg, today);
  };
  const clearGoal = () => {
    // Clearing also forgets where the target started from, and that cannot be typed back in, so
    // Undo puts back all three.
    const previous = {
      weightGoalKg: settings.weightGoalKg,
      goalStartDate: settings.goalStartDate,
      goalStartWeightKg: settings.goalStartWeightKg,
    };
    setGoalDraft(null);
    setWeightGoal(null);
    showSnack('Target weight cleared', {
      label: 'Undo',
      onPress: () => {
        updateSettings(previous);
        // Whatever was typed since is dropped with it, so the field shows the target that is back.
        setGoalDraft(null);
      },
    });
  };
  const draftKg = goalDraft === null ? null : roundKg(goalDraft);
  // Typed, but not a weight that can be saved: empty, too low or too high.
  const goalUnsaved = draftKg !== null && !isValidWeightKg(draftKg);
  // Too high cannot be fixed by typing on, so it is an error. Empty or too low is usually a number
  // that is not finished yet, so it is told quietly what is still saved.
  const goalTooHigh = goalUnsaved && draftKg > MAX_WEIGHT_KG;
  /** Leaving the field with nothing in it that can be saved shows the saved target again. */
  const settleGoalField = () => {
    if (!goalUnsaved) return;
    setGoalDraft(null);
    setGoalFieldResets((n) => n + 1);
  };
  const stillSaved = goal !== null ? `Your target is still ${formatKg(goal)}.` : null;
  const goalStatus = goalStatusText(goal, latestWeight, settings.goalStartWeightKg, currentKg);
  let goalNote: string;
  if (!goalUnsaved) goalNote = goalStatus;
  else if (goalTooHigh) goalNote = stillSaved ? `${WEIGHT_RANGE_HINT} ${stillSaved}` : WEIGHT_RANGE_HINT;
  else if (draftKg === 0) goalNote = stillSaved ? `${stillSaved} To remove it, tap the cross.` : goalStatus;
  else goalNote = stillSaved ?? WEIGHT_RANGE_HINT;

  const calories = (
    <NumberField key="calories" label="Calories" suffix="kcal" value={settings.calorieGoal} onChange={(n) => save({ calorieGoal: Math.round(n) })} />
  );
  const protein = (
    <NumberField key="protein" label="Protein" suffix="g" value={settings.proteinGoal} onChange={(n) => save({ proteinGoal: Math.round(n) })} />
  );
  const carbs = <NumberField key="carbs" label="Carbs" suffix="g" value={settings.carbsGoal} onChange={(n) => save({ carbsGoal: Math.round(n) })} />;
  const fat = <NumberField key="fat" label="Fat" suffix="g" value={settings.fatGoal} onChange={(n) => save({ fatGoal: Math.round(n) })} />;
  // Calories over the three macros, the way Today stacks its hero over the macro tiles. At a large
  // font size three labels no longer fit side by side, and the four become two rows of two.
  const roomy = fontScale <= ROOMY_FONT_SCALE;
  const on = colors.onPrimaryContainer;

  return (
    <View>
      <SectionHeader title="Daily targets" />
      <View style={styles.stack}>
        <FieldCard>
          <View style={styles.fields}>
            {roomy ? (
              <>
                <Row style={styles.fieldRow}>{calories}</Row>
                <Row style={styles.fieldRow}>
                  {protein}
                  {carbs}
                  {fat}
                </Row>
              </>
            ) : (
              <>
                <Row style={styles.fieldRow}>
                  {calories}
                  {protein}
                </Row>
                <Row style={styles.fieldRow}>
                  {carbs}
                  {fat}
                </Row>
              </>
            )}
          </View>
          <View style={styles.fieldWithNote}>
            <Row>
              {/* Tapping the field selects the number, so typing a new target never passes through an empty field. */}
              <NumberField
                key={goalFieldResets}
                label="Target weight"
                suffix="kg"
                decimals={1}
                maxDecimals={1}
                selectOnFocus
                value={goal ?? 0}
                onChange={changeGoal}
                onBlur={settleGoalField}
              />
              {goal !== null ? <IconButton icon="close" label="Clear target weight" onPress={clearGoal} /> : null}
            </Row>
            <AppText
              variant="bodyMedium"
              color={goalTooHigh ? colors.error : colors.onSurfaceVariant}
              textBreakStrategy="balanced"
              style={styles.fieldNote}>
              {keepUnits(goalNote)}
            </AppText>
          </View>
        </FieldCard>
        <Group>
          <GroupRow
            icon="walk"
            tone={litTone(settings.countExerciseCalories, 'tertiary')}
            headline="Add activity from other apps"
            supporting="Logged workouts count either way"
            accessibilityHint="Active calories this phone counts through Google Fit and Health Connect. Workouts you log here always count."
            trailing={
              <Switch
                value={settings.countExerciseCalories}
                onValueChange={(v) => save({ countExerciseCalories: v })}
                accessibilityLabel="Add activity from other apps to my budget"
              />
            }
          />
          <ExpanderRow
            icon="calculator-variant-outline"
            tone="primary"
            headline="Work out my targets"
            supporting="From age, height, weight and activity"
            open={showCalc}
            onPress={toggleCalc}
          />
          {showCalc ? (
            <Panel appear>
              <SegmentedButtons
                accessibilityLabel="Sex"
                value={profile.sex}
                onChange={(sex) => setP({ sex })}
                options={[
                  { value: 'male', label: 'Male' },
                  { value: 'female', label: 'Female' },
                ]}
              />
              <Row style={styles.fieldRow}>
                <NumberField label="Age" value={profile.age} onChange={(age) => setP({ age })} />
                <NumberField label="Height" suffix="cm" value={profile.heightCm} onChange={(heightCm) => setP({ heightCm })} />
                {roomy ? (
                  <NumberField label="Weight" suffix="kg" decimals={1} value={profile.weightKg} onChange={(weightKg) => setP({ weightKg })} />
                ) : null}
              </Row>
              {roomy ? null : (
                <Row style={styles.fieldRow}>
                  <NumberField label="Weight" suffix="kg" decimals={1} value={profile.weightKg} onChange={(weightKg) => setP({ weightKg })} />
                </Row>
              )}
              <View style={styles.choice}>
                <AppText variant="labelLarge" color={colors.onSurfaceVariant}>
                  Activity
                </AppText>
                <View style={styles.wrap}>
                  {(Object.keys(ACTIVITY_LABELS) as ActivityLevel[]).map((a) => (
                    <Chip key={a} kind="filter" label={ACTIVITY_LABELS[a]} selected={profile.activity === a} onPress={() => setP({ activity: a })} />
                  ))}
                </View>
              </View>
              <View style={styles.choice}>
                <AppText variant="labelLarge" color={colors.onSurfaceVariant}>
                  Goal
                </AppText>
                <View style={styles.wrap}>
                  {(Object.keys(GOAL_LABELS) as GoalType[]).map((g) => (
                    <Chip
                      key={g}
                      kind="filter"
                      label={GOAL_LABELS[g]}
                      selected={profile.goal === g}
                      // Each goal starts at its usual pace; a pace typed for another goal may be out of its range.
                      onPress={() => setP({ goal: g, rateKg: GOAL_RATES[g]?.usual })}
                    />
                  ))}
                </View>
                {rateRange ? (
                  <View style={styles.fieldWithNote}>
                    <Row style={styles.fieldRow}>
                      <NumberField
                        key={profile.goal}
                        label={profile.goal === 'build_muscle' ? 'Gain' : 'Lose'}
                        suffix="kg a week"
                        decimals={2}
                        maxDecimals={2}
                        selectOnFocus
                        value={profile.rateKg ?? rateRange.usual}
                        onChange={(rateKg) => setP({ rateKg })}
                      />
                    </Row>
                    <AppText variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.fieldNote}>
                      {rateText}
                    </AppText>
                  </View>
                ) : null}
              </View>
              {/* What the calculator came to, lit as a food figure: the calories, how they sit against what
                  the body burns and when the pace reaches the target, the three macros with their colours
                  as Today draws them, and the button that uses them. The sentences are one tap below. */}
              <View style={[styles.result, { backgroundColor: colors.primaryContainer }]}>
                <View accessible accessibilityLabel={`${preview.calories} calories a day`}>
                  <AppText variant="headlineSmall" emphasized tabular color={on}>
                    {formatKcal(preview.calories)}
                    <AppText variant="bodyLarge" color={on}>
                      {'\u00A0kcal a day'}
                    </AppText>
                  </AppText>
                </View>
                <View style={styles.pills} accessible accessibilityLabel={plan.text}>
                  <Pill
                    icon={plan.kcalVsBurn < 0 ? 'arrow-down' : plan.kcalVsBurn > 0 ? 'arrow-up' : 'trending-neutral'}
                    label={
                      plan.kcalVsBurn === 0
                        ? 'What you burn'
                        : `${formatKcal(Math.abs(plan.kcalVsBurn))}\u00A0kcal ${plan.kcalVsBurn < 0 ? 'under' : 'over'} your burn`
                    }
                    color={on}
                  />
                  {plan.weeks !== null && plan.targetKg !== null ? (
                    <Pill icon="flag-variant-outline" label={`${formatKg(plan.targetKg)} in about ${plan.weeks} ${plan.weeks === 1 ? 'week' : 'weeks'}`} color={on} />
                  ) : null}
                </View>
                {/* The grams as every sheet draws them, so a target reads like the day it is for. */}
                <MacroFigures
                  totals={preview}
                  color={on}
                  accessibilityLabel={`${preview.protein} g protein, ${plan.proteinPerKg} g per kg, ${preview.carbs} g carbs, ${preview.fat} g fat`}
                />
                {plan.floored ? (
                  <AppText variant="bodyMedium" color={on} textBreakStrategy="balanced">
                    {`Held at ${formatKcal(MIN_CALORIE_TARGET)}\u00A0kcal, the lowest this suggests`}
                  </AppText>
                ) : null}
                <Button
                  title="Use these targets"
                  icon="check"
                  style={styles.end}
                  onPress={() => {
                    // Also records the weight these targets were worked out at, for Progress's recalculation hint.
                    applyCalculatedTargets(profile);
                    void refreshWidgets();
                    setShowCalc(false);
                  }}
                />
              </View>
              <Disclosure>
                {plan.text}
                {'An estimate from a standard formula. After 2 to 3 weeks of weigh-ins and logged meals, Progress shows what you really burn.'}
              </Disclosure>
            </Panel>
          ) : null}
        </Group>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- reminders

function RemindersSection() {
  const settings = useLiveQuery(getSettings, []);
  const weighIn = settings.weighInReminder;
  // Whether Android lets this app notify. Null until it has been read, and the row that says
  // notifications are off waits for a clear no.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const read = () => {
      void hasNotificationPermission()
        .then((ok) => {
          if (!cancelled) setAllowed(ok);
        })
        .catch(() => {});
    };
    read();
    // It changes outside this screen: Android's question after the first food log, or Android's
    // own settings. Both hand the screen back to the app, which is when this reads again.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  /**
   * Save a change to the reminders. Switching one on, or moving its time, needs permission to
   * notify; switching one off never does, so it always works.
   */
  const apply = async (patch: Parameters<typeof updateSettings>[0], turningOff = false) => {
    if (!turningOff) {
      const ok = await ensureNotificationPermission();
      setAllowed(ok);
      if (!ok) {
        Alert.alert('Notifications are off', 'Turn on notifications for OneFit in Android settings to get reminders.');
        return;
      }
    }
    updateSettings(patch);
    await rescheduleReminders();
  };

  /** The "Notifications are off" row: let Android ask, or show the way to its settings when it will not ask. */
  const allowNotifications = async () => {
    if (asking) return;
    setAsking(true);
    try {
      const result = await requestNotifications();
      if (result === 'granted') {
        setAllowed(true);
        await rescheduleReminders();
      } else if (result === 'blocked') {
        // Android has stopped asking, so only its own settings can switch notifications on.
        Alert.alert(
          'Allow notifications in Android settings',
          'Android will not ask again from here. Open settings, tap Notifications and switch them on for OneFit.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open settings', onPress: () => void Linking.openSettings().catch(() => {}) },
          ],
        );
      }
      // 'refused': the owner has just said no to Android's question. The row stays as it is.
    } catch (e) {
      console.warn('Could not ask to allow notifications', e);
    } finally {
      setAsking(false);
    }
  };
  // Reminders can be switched on while Android blocks every one of them. Say so where they are set.
  const notificationsOff = allowed === false && anyReminderEnabled(settings);

  const pickTime = (current: ReminderSetting, onPicked: (next: ReminderSetting) => void) => {
    const value = new Date();
    value.setHours(current.hour, current.minute, 0, 0);
    DateTimePickerAndroid.open({
      value,
      mode: 'time',
      is24Hour: false,
      onValueChange: (_event, date) => {
        if (!date) return;
        onPicked({ ...current, hour: date.getHours(), minute: date.getMinutes() });
      },
    });
  };

  const pickMealTime = (meal: ReminderMeal) =>
    pickTime(settings.reminders[meal], (next) => void apply({ reminders: { ...settings.reminders, [meal]: next } }));

  return (
    <View>
      <SectionHeader title="Reminders" />
      <Group>
        {notificationsOff ? (
          <ButtonRow
            icon="bell-off-outline"
            tone="ring"
            headline="Notifications are off"
            supporting="Reminders can’t reach you yet"
            onPress={() => void allowNotifications()}
            accessibilityLabel="Notifications are off. Reminders cannot reach you until they are allowed. Allow notifications"
            button={
              <Button
                title="Allow"
                variant="tonal"
                loading={asking}
                accessibilityLabel="Allow notifications"
                onPress={() => void allowNotifications()}
              />
            }
          />
        ) : null}
        <GroupRow
          icon="bell-outline"
          tone={litTone(settings.remindersEnabled, 'secondary')}
          headline="Remind me to log meals"
          supporting="Skipped once it’s logged"
          trailing={
            <Switch value={settings.remindersEnabled} onValueChange={(v) => void apply({ remindersEnabled: v }, !v)} accessibilityLabel="Meal reminders" />
          }
        />
        {settings.remindersEnabled
          ? REMINDER_MEALS.map((meal) => {
              const r = settings.reminders[meal];
              return (
                <GroupRow
                  key={meal}
                  icon={MEAL_ICONS[meal]}
                  tone={litTone(r.enabled, 'secondary')}
                  headline={MEAL_LABELS[meal]}
                  supporting={r.enabled ? `At ${formatTime(r.hour, r.minute)}` : 'Off'}
                  onPress={r.enabled ? () => pickMealTime(meal) : undefined}
                  accessibilityLabel={`${MEAL_LABELS[meal]} reminder time, ${formatTime(r.hour, r.minute)}`}
                  trailing={
                    <Switch
                      value={r.enabled}
                      onValueChange={(enabled) => void apply({ reminders: { ...settings.reminders, [meal]: { ...r, enabled } } }, !enabled)}
                      accessibilityLabel={`${MEAL_LABELS[meal]} reminder`}
                    />
                  }
                />
              );
            })
          : null}
        {/* Its own switch: the weigh-in reminder works whether or not meal reminders are on. */}
        <GroupRow
          icon="scale-bathroom"
          tone={litTone(weighIn.enabled, 'secondary')}
          headline="Remind me to weigh in"
          supporting={
            weighIn.enabled
              ? `At ${formatTime(weighIn.hour, weighIn.minute)}, unless you’ve weighed in`
              : 'Once a day, at a time you choose'
          }
          onPress={weighIn.enabled ? () => pickTime(weighIn, (next) => void apply({ weighInReminder: next })) : undefined}
          accessibilityLabel={`Weigh-in reminder time, ${formatTime(weighIn.hour, weighIn.minute)}`}
          trailing={
            <Switch
              value={weighIn.enabled}
              onValueChange={(enabled) => void apply({ weighInReminder: { ...weighIn, enabled } }, !enabled)}
              accessibilityLabel="Weigh-in reminder"
            />
          }
        />
        <GroupRow
          icon="lightbulb-on-outline"
          tone={litTone(settings.headsUpNotifications, 'secondary')}
          headline="Heads up"
          supporting="A morning note when it matters"
          accessibilityHint="When something stands out: an unusual day, a gap, a new best. One a day at most."
          trailing={
            <Switch
              value={settings.headsUpNotifications}
              onValueChange={(v) => {
                void apply({ headsUpNotifications: v }, !v).then(() => refreshHeadsUp());
              }}
              accessibilityLabel="Heads-up notifications"
            />
          }
        />
      </Group>
    </View>
  );
}

// ---------------------------------------------------------------- Health Connect

type HealthTask = 'connect' | 'workouts' | 'weight';

function HealthSection() {
  const showSnack = useSnackbar();
  const settings = useLiveQuery(getSettings, []);
  const [availability, setAvailability] = useState<HealthAvailability | null>(null);
  const [busy, setBusy] = useState<HealthTask | null>(null);
  // What Health Connect allows right now; null until it has been read. Someone who connected
  // before workouts or weight existed is still missing those grants, and each is offered in a
  // row of its own. They are optional: everything else works without them.
  const [grants, setGrants] = useState<HealthGrants | null>(null);

  useEffect(() => {
    void getHealthAvailability().then(setAvailability);
  }, []);

  useEffect(() => {
    if (!settings.healthConnectEnabled) return;
    let cancelled = false;
    const read = () => {
      void getHealthGrants()
        .then((g) => {
          if (!cancelled) setGrants(g);
        })
        .catch(() => {});
    };
    read();
    // Grants can change in Health Connect's own settings while this app is in the background.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') read();
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [settings.healthConnectEnabled]);

  const connect = async () => {
    if (busy) return;
    setBusy('connect');
    try {
      const next = await requestHealthPermissions();
      if (!next.writeNutrition) {
        Alert.alert('Not connected', 'Allow "Nutrition" access so your meals can reach Google Fit.');
        return;
      }
      setGrants(next);
      updateSettings({ healthConnectEnabled: true });
      await syncHealthBackfill();
    } catch (e) {
      Alert.alert('Health Connect', e instanceof Error ? e.message : 'Could not connect.');
    } finally {
      setBusy(null);
    }
  };

  /** Ask again for the grants that are missing. The request covers all of them; `what` is the row that was tapped. */
  const allow = async (what: 'workouts' | 'weight') => {
    if (busy) return;
    setBusy(what);
    try {
      const next = await requestHealthPermissions();
      setGrants(next);
      await syncHealthBackfill();
      const allowed = what === 'weight' ? next.writeWeight && next.readWeight : next.writeExercise;
      if (allowed) {
        showSnack(what === 'weight' ? 'Weigh-ins now sync with Health Connect' : 'Workouts now go to Google Fit');
      } else {
        // Android stops showing its permission screen after it has been turned down twice.
        Alert.alert(
          what === 'weight' ? 'Weight is not fully allowed yet' : 'Workouts are not allowed yet',
          `If Android did not ask, open Health Connect and allow ${what === 'weight' ? 'Weight' : 'Exercise and Active calories burned'} for OneFit. Everything else keeps working without it.`,
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Health Connect', onPress: openHealthSettings },
          ],
        );
      }
    } catch (e) {
      Alert.alert('Health Connect', e instanceof Error ? e.message : 'Could not ask for access.');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    updateSettings({ healthConnectEnabled: false });
    const current = await getHealthGrants().catch(() => null);
    if (current?.writeNutrition) {
      Alert.alert('Stopped syncing', 'To remove access completely, open Health Connect and revoke OneFit.', [
        { text: 'Later', style: 'cancel' },
        { text: 'Open Health Connect', onPress: openHealthSettings },
      ]);
    }
  };

  const unavailable = availability === 'unavailable' || availability === 'needs_update';
  const text = healthText(settings.healthConnectEnabled, grants);
  const optional = unavailable
    ? []
    : [
        ...(text.workouts ? [{ what: 'workouts' as const, icon: 'run' as const, label: 'Allow workouts', ...text.workouts }] : []),
        ...(text.weight ? [{ what: 'weight' as const, icon: 'scale-bathroom' as const, label: 'Allow weight', ...text.weight }] : []),
      ];
  const connected = settings.healthConnectEnabled;
  const sync = healthSync(connected, grants);
  return (
    <View>
      <SectionHeader title="Google Fit and Health Connect" />
      <Group>
        <ActionRow
          icon="heart-pulse"
          tone={litTone(connected, 'tertiary')}
          headline={connected ? 'Connected' : 'Not connected'}
          supporting={
            availability === 'unavailable'
              ? 'Not available on this phone'
              : availability === 'needs_update'
                ? 'Update Health Connect from the Play Store'
                : sync.line
          }
          // What syncs, lit or not; the sentence it stands for is what a screen reader hears.
          extra={!unavailable && sync.items.length > 0 ? <SyncIcons items={sync.items} label={text.status} /> : undefined}
          actions={
            unavailable ? undefined : connected ? (
              <Button title="Stop syncing" variant="tonal" hitSlop={4} onPress={() => void disconnect()} />
            ) : (
              <Button title="Connect" icon="link-variant" hitSlop={4} loading={busy === 'connect'} onPress={() => void connect()} />
            )
          }
        />
        {optional.map((row) => (
          <ButtonRow
            key={row.what}
            icon={row.icon}
            tone="ring"
            headline={row.headline}
            supporting={row.supporting}
            onPress={() => void allow(row.what)}
            accessibilityLabel={`${row.headline}. ${row.label}`}
            button={
              <Button
                title="Allow"
                variant="tonal"
                loading={busy === row.what}
                disabled={busy !== null}
                accessibilityLabel={row.label}
                onPress={() => void allow(row.what)}
              />
            }
          />
        ))}
        {!unavailable ? (
          <GroupRow
            key="open"
            icon="cog-outline"
            headline="Open Health Connect"
            supporting="Change what is shared"
            trailing={<Cue icon="open-in-new" />}
            onPress={openHealthSettings}
            accessibilityLabel="Open Health Connect"
            accessibilityHint="Change what is shared"
          />
        ) : null}
      </Group>
    </View>
  );
}

// ---------------------------------------------------------------- widget

function WidgetSection() {
  const pin = async (widgetName: string) => {
    const fallback = () => Alert.alert('Add the widget', 'Long-press your home screen, tap Widgets and find OneFit.');
    try {
      if (!(await requestPinWidget({ widgetName }))) fallback();
    } catch {
      fallback();
    }
  };
  return (
    <View>
      <SectionHeader title="Home screen widgets" />
      <Group>
        <GroupRow
          icon="widgets-outline"
          tone="primary"
          headline="Quick log (4×2)"
          supporting={VOICE_LOGGING ? 'Calories left, favourites, Say it or Type it' : 'Calories left, favourites and Log food'}
          onPress={() => void pin(WIDGET_QUICK_LOG)}
          trailing={<IconButton icon="plus" variant="tonal" label="Add Quick log widget" onPress={() => void pin(WIDGET_QUICK_LOG)} />}
        />
        <GroupRow
          icon="numeric"
          tone="primary"
          headline="Calories left (2×1)"
          supporting="The number and a quick-add button"
          onPress={() => void pin(WIDGET_CALORIES_LEFT)}
          trailing={<IconButton icon="plus" variant="tonal" label="Add Calories left widget" onPress={() => void pin(WIDGET_CALORIES_LEFT)} />}
        />
      </Group>
    </View>
  );
}

// ---------------------------------------------------------------- Groq

function AiSection() {
  const settings = useLiveQuery(getSettings, []);
  const [key, setKey] = useState('');
  const [hasStored, setHasStored] = useState(false);
  const [checking, setChecking] = useState(false);
  const [showModels, setShowModels] = useState(false);

  useEffect(() => {
    void getStoredApiKey().then((k) => setHasStored(!!k));
  }, []);

  const saveKey = async () => {
    await saveApiKey(key);
    setHasStored(!!key.trim());
    setKey('');
  };

  const check = async () => {
    setChecking(true);
    try {
      const available = new Set(await listModels());
      const models = [settings.textModel, ...(VOICE_LOGGING ? [settings.speechModel] : [])];
      const missing = models.filter((m) => !available.has(m));
      Alert.alert(
        missing.length ? 'Some models are unavailable' : 'Groq is working',
        missing.length
          ? `Your key works, but these models aren't available: ${missing.join(', ')}. Change them under AI models.`
          : `Your key works and ${models.length > 1 ? 'both models are' : 'the model is'} available.`,
      );
    } catch (e) {
      Alert.alert('Groq', e instanceof Error ? e.message : 'Check failed.');
    } finally {
      setChecking(false);
    }
  };

  const hasKey = hasStored || hasEnvApiKey();
  const keyStatus = hasStored ? 'A key is saved on this phone' : hasEnvApiKey() ? 'Using the key from your .env file' : 'No key yet';

  return (
    <View>
      <SectionHeader title="Groq AI" />
      <Group>
        <GroupRow
          icon="key-outline"
          tone={litTone(hasKey, 'secondary')}
          headline="API key"
          supporting={keyStatus}
        />
        <Panel>
          <TextField
            label="Paste API key"
            value={key}
            onChangeText={setKey}
            placeholder={hasStored ? '•••••••• (saved)' : 'gsk_…'}
            supportingText="Free keys at console.groq.com/keys"
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={styles.buttons}>
            {hasStored ? (
              <Button
                title="Remove"
                variant="text"
                onPress={() => {
                  void saveApiKey('');
                  setHasStored(false);
                }}
              />
            ) : null}
            <Button title="Test" variant="tonal" loading={checking} onPress={() => void check()} />
            <Button title="Save key" disabled={!key.trim()} onPress={() => void saveKey()} />
          </View>
        </Panel>
        <ExpanderRow
          icon="tune-variant"
          tone="secondary"
          headline="AI models"
          supporting={VOICE_LOGGING ? `Text: ${settings.textModel}\nVoice: ${settings.speechModel}` : `Text: ${settings.textModel}`}
          open={showModels}
          onPress={() => setShowModels((s) => !s)}
        />
        {showModels ? (
          <Panel appear>
            <View style={styles.fields}>
              <TextField label="Text" value={settings.textModel} autoCapitalize="none" onChangeText={(textModel) => updateSettings({ textModel: textModel.trim() })} />
              {VOICE_LOGGING ? (
                <TextField label="Voice" value={settings.speechModel} autoCapitalize="none" onChangeText={(speechModel) => updateSettings({ speechModel: speechModel.trim() })} />
              ) : null}
            </View>
            <Button title="Reset to defaults" variant="text" style={styles.end} onPress={() => updateSettings({ ...DEFAULT_MODELS })} />
          </Panel>
        ) : null}
      </Group>
    </View>
  );
}

// ---------------------------------------------------------------- backup

function DataSection({ onRestored }: { onRestored: () => void }) {
  const { colors } = useTheme();
  const showSnack = useSnackbar();
  const [busy, setBusy] = useState<'export' | 'restore' | null>(null);

  const exportNow = async () => {
    if (busy) return;
    setBusy('export');
    try {
      await exportBackupFile();
      // Android does not say whether the share sheet was used, so this claims only what is known.
      showSnack('Backup file made. Keep a copy somewhere other than this phone.');
    } catch (e) {
      Alert.alert('Backup not exported', e instanceof Error ? e.message : 'The backup file could not be made. Try again.');
    } finally {
      setBusy(null);
    }
  };

  const restore = async (backup: BackupFile, inFile: DataCounts) => {
    setBusy('restore');
    try {
      await restoreFromBackup(backup);
      onRestored();
      showSnack(restoreDoneText(inFile));
    } catch (e) {
      // The swap happens in one database transaction, so a failure leaves the old data in place.
      console.warn('Restore failed', e);
      Alert.alert('Backup not restored', 'Something went wrong while restoring. The data on this phone was left as it was.');
    } finally {
      setBusy(null);
    }
  };

  /** Pick a file and check it. Nothing on the phone changes until the owner confirms. */
  const chooseBackup = async () => {
    if (busy) return;
    setBusy('restore');
    let picked: Awaited<ReturnType<typeof pickAndCheckBackup>>;
    try {
      picked = await pickAndCheckBackup();
    } catch (e) {
      picked = { status: 'invalid', fileName: null, problems: [e instanceof Error ? e.message : 'That file could not be opened.'] };
    } finally {
      setBusy(null);
    }
    if (picked.status === 'canceled') return;
    if (picked.status === 'invalid') {
      Alert.alert('This file cannot be restored', backupProblemsText(picked.problems));
      return;
    }
    const { backup, summary } = picked;
    const inFile = countBackup(backup);
    const onPhone: DataCounts = {
      foodDays: getLoggedDates().length,
      workouts: getAllExercises().length,
      weighIns: getAllWeights().length,
      savedFoods: getAllFoods().length,
    };
    Alert.alert('Replace everything on this phone?', restoreConfirmText(inFile, onPhone, summary.exportedAt), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Replace everything', style: 'destructive', onPress: () => void restore(backup, inFile) },
    ]);
  };

  // In the cue's own 24dp slot, so the words beside it do not move when it takes the cue's place.
  const busyMark = (
    <View style={styles.cueSlot}>
      <ActivityIndicator size="small" color={colors.primary} />
    </View>
  );
  return (
    <View>
      <SectionHeader title="Your data" />
      <Group>
        <GroupRow
          icon="export-variant"
          headline="Export backup"
          supporting="Everything but your API key, in one file"
          onPress={() => void exportNow()}
          trailing={busy === 'export' ? busyMark : <Cue />}
        />
        <GroupRow
          icon="backup-restore"
          headline="Restore from backup"
          supporting="Replaces all data, once you confirm"
          onPress={() => void chooseBackup()}
          trailing={busy === 'restore' ? busyMark : <Cue />}
        />
      </Group>
    </View>
  );
}

// ---------------------------------------------------------------- favourites

function FavouritesSection() {
  const { colors } = useTheme();
  const foods = useLiveQuery(getAllFoods, []);
  if (foods.length === 0) return null;
  const count = foods.length > FOODS_SHOWN ? `${FOODS_SHOWN} of ${foods.length}` : `${foods.length} ${foods.length === 1 ? 'food' : 'foods'}`;
  return (
    <View>
      <SectionHeader title="Saved foods" hint={count} />
      <AppText
        variant="bodyMedium"
        color={colors.onSurfaceVariant}
        textBreakStrategy="balanced"
        accessibilityLabel="Starred foods always appear on Today and the widget. The AI reuses your numbers for these."
        style={styles.sectionNote}>
        Starred ones show on Today and the widget
      </AppText>
      <Group>
        {foods.slice(0, FOODS_SHOWN).map((f) => (
          <GroupRow
            key={f.id}
            icon={foodIcon(f.name)}
            // Lit while starred: these are the foods Today and the widget show.
            tone={f.pinned ? 'primary' : 'neutral'}
            headline={f.name}
            // Two short lines, so the words never wrap to leave "times" on a line of its own.
            supporting={keepUnits(`${f.portion || '1 serving'}, ${Math.round(f.calories)} kcal\nLogged ${f.useCount} ${f.useCount === 1 ? 'time' : 'times'}`)}
            trailing={
              <View style={styles.rowButtons}>
                <IconButton
                  icon={f.pinned ? 'star' : 'star-outline'}
                  label={f.pinned ? `Unstar ${f.name}` : `Star ${f.name}`}
                  color={f.pinned ? colors.primary : undefined}
                  onPress={() => {
                    setFoodPinned(f.id, !f.pinned);
                    notifyChanged();
                    void refreshWidgets();
                  }}
                />
                <IconButton
                  icon="trash-can-outline"
                  label={`Forget ${f.name}`}
                  onPress={() => {
                    deleteFood(f.id);
                    notifyChanged();
                    void refreshWidgets();
                  }}
                />
              </View>
            }
          />
        ))}
      </Group>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // 24dp before each section header. No FAB here; the space at the end lets the last row clear a snackbar.
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing.xxl * 2 },
  // The card of fields and the group of rows under it.
  stack: { gap: Spacing.sm },
  fields: { gap: Spacing.sm },
  fieldRow: { alignItems: 'flex-start' },
  fieldWithNote: { gap: Spacing.xs },
  fieldNote: { paddingHorizontal: Spacing.lg },
  choice: { gap: Spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  result: { borderRadius: Shape.largeIncreased, padding: Spacing.lg, gap: Spacing.md },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  end: { alignSelf: 'flex-end' },
  cueSlot: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  // Wraps, so buttons that do not fit side by side at a large font size stack instead of clipping.
  buttons: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: Spacing.sm },
  sectionNote: { paddingHorizontal: Spacing.xs, marginBottom: Spacing.md },
  // Two icon buttons side by side. Their icons sit 8dp inside their 40dp circles, so the pair is
  // pulled out by that much and the last icon lines up with the switches and cues of other rows.
  rowButtons: { flexDirection: 'row', marginRight: -Spacing.sm },
});

import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useEffectEvent, useState } from 'react';
import { BackHandler, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShapeAvatar } from '@/components/expressive';
import { ItemEditor, MealPicker } from '@/components/item-editor';
import { MacroFigures, Note, SheetHeader } from '@/components/sheet-parts';
import { AppText, Button, Group, GroupRow, Icon, SectionHeader, SegmentedButtons, Tappable, TextField } from '@/components/ui';
import { VOICE_LOGGING } from '@/constants/features';
import { Alpha, Shape, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { applySavedFoods, newItemKey, type ParsedMeal } from '@/lib/ai-parse';
import { formatDayLabel, mealForTime, todayKey } from '@/lib/dates';
import { getKnownFoods } from '@/lib/db';
import { parseMealText, transcribeAudio } from '@/lib/groq';
import { logFoods } from '@/lib/logging';
import { formatKcal, sumMacros } from '@/lib/nutrition';
import { askForNotificationsOnce } from '@/lib/reminders';
import { getSettings } from '@/lib/settings';
import { MEAL_LABELS, MEALS, type DraftItem, type EntrySource, type LogMode, type Meal } from '@/lib/types';

type Phase = 'input' | 'working' | 'review';

const MAX_RECORDING_SECONDS = 60;

const isMeal = (v: unknown): v is Meal => typeof v === 'string' && (MEALS as string[]).includes(v);
const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');
const needsSettings = (message: string) => /settings|api key/i.test(message);

const blankItem = (): DraftItem => ({
  key: newItemKey(),
  name: '',
  portion: '',
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  confidence: 'high',
});

const MODES = [
  { value: 'voice' as const, label: 'Say it', icon: 'microphone-outline' as const },
  { value: 'text' as const, label: 'Type it', icon: 'pencil-outline' as const },
];

export default function LogScreen() {
  const { back, canGoBack, replace, push } = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ mode?: string; meal?: string; date?: string; from?: string }>();

  const initialMode: LogMode = VOICE_LOGGING && params.mode === 'voice' ? 'voice' : 'text';
  const fromWidget = params.from === 'widget';
  const date = isDateKey(params.date) ? params.date : todayKey();

  const [mode, setMode] = useState<LogMode>(initialMode);
  const [meal, setMeal] = useState<Meal>(isMeal(params.meal) ? params.meal : mealForTime());
  const [phase, setPhase] = useState<Phase>('input');
  const [status, setStatus] = useState('');
  const [text, setText] = useState('');
  const [transcript, setTranscript] = useState('');
  const [items, setItems] = useState<DraftItem[]>([]);
  const [note, setNote] = useState('');
  const [source, setSource] = useState<EntrySource>('text');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const close = () => {
    // Opened from the home-screen widget: go straight back to the home screen.
    if (fromWidget && Platform.OS === 'android') BackHandler.exitApp();
    else if (canGoBack()) back();
    else replace('/');
  };
  /** The close button: back to where the screen was opened from, like the system back gesture. */
  const dismiss = () => {
    if (canGoBack()) back();
    else replace('/');
  };

  const runAi = async (task: () => Promise<ParsedMeal>, label: string, from: EntrySource) => {
    setError(null);
    setPhase('working');
    setStatus(label);
    try {
      const result = await task();
      if (result.items.length === 0) {
        setError(result.note || 'No food found in that. Try naming the dish and how much you had.');
        setPhase('input');
        return;
      }
      setItems(applySavedFoods(result.items, getKnownFoods()));
      setNote(result.note);
      setSource(from);
      setPhase('review');
    } catch (e) {
      setError(errorText(e));
      setPhase('input');
    }
  };

  const estimateText = (description: string, from: EntrySource) => {
    const { textModel } = getSettings();
    return runAi(() => parseMealText(description, textModel, getKnownFoods()), 'Working out the calories', from);
  };

  const startRecording = async () => {
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError('Microphone access is off. Turn it on in Android settings to log by voice.');
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setElapsed(0);
      setRecording(true);
    } catch (e) {
      setError(errorText(e));
    }
  };

  const stopRecording = async () => {
    if (!recording) return;
    setRecording(false);
    try {
      await recorder.stop();
      await setAudioModeAsync({ allowsRecording: false }).catch(() => {});
      const uri = recorder.uri;
      if (!uri) throw new Error('The recording failed. Try again.');
      setPhase('working');
      setStatus('Listening back');
      const heard = await transcribeAudio(uri, getSettings().speechModel);
      if (!heard) {
        setError('Nothing was heard. Hold the phone a little closer and try again.');
        setPhase('input');
        return;
      }
      setTranscript(heard);
      setText(heard);
      await estimateText(heard, 'voice');
    } catch (e) {
      setError(errorText(e));
      setPhase('input');
    }
  };

  // Recording timer, with an automatic stop so a forgotten recording doesn't run forever.
  const onAutoStop = useEffectEvent(() => void stopRecording());
  useEffect(() => {
    if (!recording) return;
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    const autoStop = setTimeout(onAutoStop, MAX_RECORDING_SECONDS * 1000);
    return () => {
      clearInterval(tick);
      clearTimeout(autoStop);
    };
  }, [recording]);

  // From the widget or Today's "Say it", start listening once the screen has slid in.
  const onAutoStart = useEffectEvent(() => {
    if (initialMode === 'voice') void startRecording();
  });
  useEffect(() => {
    const t = setTimeout(onAutoStart, 300);
    return () => clearTimeout(t);
  }, []);

  const switchMode = (next: LogMode) => {
    if (recording) return;
    setError(null);
    setMode(next);
  };

  const enterManually = () => {
    setItems([{ ...blankItem(), name: text.trim() }]);
    setNote('');
    setSource('manual');
    setPhase('review');
  };

  const startOver = () => {
    setItems([]);
    setNote('');
    setTranscript('');
    setError(null);
    setPhase('input');
  };

  const save = async () => {
    const valid = items.filter((i) => i.name.trim());
    if (valid.length === 0) {
      setError('Give at least one food a name before saving.');
      return;
    }
    setSaving(true);
    try {
      const saved = await logFoods({
        date,
        meal,
        items: valid.map(({ name, portion, calories, protein, carbs, fat }) => ({ name, portion, calories, protein, carbs, fat })),
        source,
      });
      // Reminders are on from the start, but Android shows nothing until notifications are allowed.
      // The first food logged is the moment to ask: once per phone, and before the screen closes,
      // because closing can leave the app (when it was opened from the widget).
      if (saved.length > 0) await askForNotificationsOnce();
      close();
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  };

  const total = sumMacros(items);
  const seconds = `0:${String(elapsed).padStart(2, '0')}`;
  const mealName = MEAL_LABELS[meal].toLowerCase();

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.surface }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top }]} keyboardShouldPersistTaps="handled">
        {/* A full-screen page, so no drag handle. Close goes back the way the system back gesture does. */}
        <SheetHeader title="Log food" supporting={formatDayLabel(date)} onClose={dismiss} handle={false} />

        <MealPicker value={meal} onChange={setMeal} />

        {VOICE_LOGGING && phase === 'input' ? <SegmentedButtons value={mode} onChange={switchMode} options={MODES} /> : null}

        {error ? (
          <View style={[styles.alert, { backgroundColor: colors.errorContainer }]}>
            <View style={styles.alertText}>
              <Icon name="alert-circle-outline" color={colors.onErrorContainer} />
              <AppText variant="bodyMedium" color={colors.onErrorContainer} textBreakStrategy="balanced" style={styles.fill}>
                {error}
              </AppText>
            </View>
            {needsSettings(error) ? (
              <Button title="Open Settings" icon="cog-outline" variant="error" hitSlop={4} onPress={() => push('/settings')} style={styles.alertAction} />
            ) : null}
          </View>
        ) : null}

        {phase === 'working' ? (
          <View style={styles.center} accessibilityLiveRegion="polite">
            <ShapeAvatar shape="cookie9" size={96} color={colors.primaryContainer} icon="auto-fix" iconColor={colors.onPrimaryContainer} spin />
            <AppText variant="titleLarge" emphasized style={styles.centerText}>
              {status}
            </AppText>
            {transcript ? (
              <AppText variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.quote}>
                {`“${transcript}”`}
              </AppText>
            ) : null}
          </View>
        ) : null}

        {phase === 'input' && mode === 'voice' ? (
          <View style={styles.center}>
            <Tappable
              scale={0.95}
              onPress={() => void (recording ? stopRecording() : startRecording())}
              accessibilityLabel={recording ? 'Stop recording' : 'Start recording'}
              hitSlop={8}
              rippleColor={withAlpha(recording ? colors.onErrorContainer : colors.onPrimaryContainer, Alpha.pressed)}
              style={[styles.mic, { backgroundColor: recording ? colors.errorContainer : colors.primaryContainer }]}>
              <Icon name={recording ? 'stop' : 'microphone'} size={56} color={recording ? colors.onErrorContainer : colors.onPrimaryContainer} />
            </Tappable>
            <AppText variant={recording ? 'displayMedium' : 'headlineSmall'} emphasized tabular={recording} style={styles.centerText}>
              {recording ? seconds : 'Tap and say what you ate'}
            </AppText>
            <AppText variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.quote}>
              {recording ? 'Tap again when you’re done.' : 'Include amounts, like “a bowl of oats with half a banana and a black coffee”.'}
            </AppText>
          </View>
        ) : null}

        {phase === 'input' && mode === 'text' ? (
          <View style={styles.block}>
            <TextField
              label="What did you eat?"
              value={text}
              onChangeText={setText}
              placeholder="2 eggs, toast with butter, black coffee"
              multiline
              autoFocus={initialMode === 'text'}
              supportingText="Amounts make it more accurate"
            />
            <View style={styles.actions}>
              <Button title="Estimate calories" icon="auto-fix" size="large" disabled={!text.trim()} onPress={() => void estimateText(text, 'text')} />
              <Button title="Enter numbers myself" variant="text" hitSlop={4} onPress={enterManually} style={styles.quiet} />
            </View>
          </View>
        ) : null}

        {phase === 'review' ? (
          <View>
            <SectionHeader
              title={source === 'manual' ? 'Enter the numbers' : 'Check the estimate'}
              hint={`${items.length} item${items.length === 1 ? '' : 's'}`}
            />
            <View style={styles.block}>
              {transcript ? (
                <AppText variant="bodyMedium" color={colors.onSurfaceVariant} style={styles.inset}>{`You said “${transcript}”`}</AppText>
              ) : null}
              {note ? <Note style={styles.inset}>{note}</Note> : null}
              <Group>
                {items.map((item) => (
                  <ItemEditor
                    key={item.key}
                    item={item}
                    onChange={(next) => setItems((list) => list.map((i) => (i.key === item.key ? next : i)))}
                    onRemove={() => setItems((list) => list.filter((i) => i.key !== item.key))}
                  />
                ))}
                <GroupRow
                  key="add"
                  icon="plus"
                  tone="ring"
                  headline="Add item"
                  onPress={() => setItems((l) => [...l, blankItem()])}
                  accessibilityLabel="Add item"
                />
              </Group>
              <Button title="Start over" icon="refresh" variant="text" hitSlop={4} onPress={startOver} style={styles.quiet} />
            </View>
          </View>
        ) : null}
      </ScrollView>

      {phase === 'review' ? (
        // The total and the one main action stay in reach under the list, however long it is.
        <View style={[styles.bottomBar, { paddingBottom: insets.bottom + Spacing.lg, backgroundColor: colors.surfaceContainer }]}>
          {/* The meal's one number, and what it is made of as three figures in their category colours. */}
          <View style={styles.total}>
            <AppText variant="titleLarge" emphasized tabular>{`${formatKcal(total.calories)} kcal`}</AppText>
            <MacroFigures totals={total} />
          </View>
          <Button title={`Add to ${mealName}`} size="large" loading={saving} onPress={() => void save()} />
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** The round button that starts and stops a recording (dp). */
const MIC_SIZE = 176;

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  // Room under the last field, so it can be scrolled clear of the keyboard.
  content: { paddingHorizontal: Spacing.lg, gap: Spacing.xl, paddingBottom: Spacing.xxl * 5 },
  block: { gap: Spacing.md },
  actions: { gap: Spacing.sm, paddingTop: Spacing.xs },
  quiet: { alignSelf: 'center' },
  inset: { paddingHorizontal: Spacing.xs },
  center: { alignItems: 'center', gap: Spacing.lg, paddingVertical: Spacing.xl },
  centerText: { textAlign: 'center' },
  quote: { textAlign: 'center', maxWidth: 320 },
  mic: { width: MIC_SIZE, height: MIC_SIZE, borderRadius: Shape.full, alignItems: 'center', justifyContent: 'center' },
  alert: { gap: Spacing.sm, padding: Spacing.lg, borderRadius: Shape.largeIncreased },
  alertText: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  alertAction: { alignSelf: 'flex-end' },
  bottomBar: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    borderTopLeftRadius: Shape.extraLarge,
    borderTopRightRadius: Shape.extraLarge,
  },
  // The figure, and what it is made of under it.
  total: { gap: Spacing.xs, paddingHorizontal: Spacing.xs },
});

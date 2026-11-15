import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';

import { categoryColors } from '@/constants/category-colors';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MiniRing } from '@/components/expressive';
import { GlanceGrid, HeadlineTile, InsightCards, ListRow, WhatShowsUpTile, type SectionKey } from '@/components/insight-cards';
import { useSnackbar } from '@/components/snackbar';
import { keepUnits } from '@/components/screen-text';
import { AppText, Avatar, groupCorners, Icon, IconButton, ScreenHeader, SectionHeader, SegmentedButtons, type IconName } from '@/components/ui';
import { Alpha, AVATAR_SIZE, Spacing, withAlpha } from '@/constants/theme';
import { setInsightPeriod, useInsightPeriod } from '@/hooks/use-insight-period';
import { useLiveQuery, useToday } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { INSIGHT_PERIODS, type DaySummary, type InsightAction } from '@/lib/insights';
import { loadInsights } from '@/lib/insights-data';
import { formatKcal } from '@/lib/nutrition';
import { budgetProgress, dayRowText, overBudgetShare, periodRangeText, plural, type DayRowText } from '@/lib/progress-view';
import { applyCalculatedTargets, getSettings, updateSettings } from '@/lib/settings';
import { formatKg } from '@/lib/weight';
import { refreshWidgets } from '@/widget/refresh';

const PERIOD_OPTIONS = INSIGHT_PERIODS.map((days) => ({ value: String(days), label: `${days} days` }));

/** The least of a ring an over-budget day's second lap covers, so a day 10 kcal over still shows it. */
const MIN_OVER_ARC = 0.04;
const RING_STROKE = 4;

/** One small figure of a day: a mark in its subject's colour (a dot for a macro, an icon otherwise) and the figure. */
function DayFact({ dot, icon, color, children }: { dot?: string; icon?: IconName; color: string; children: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.fact}>
      {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : icon ? <Icon name={icon} size={16} color={color} /> : null}
      <AppText variant="bodyMedium" tabular color={colors.onSurfaceVariant} numberOfLines={1}>
        {keepUnits(children)}
      </AppText>
    </View>
  );
}

/**
 * What a day held, as small figures instead of a sentence: protein, carbs and fat with their
 * category dots (as on Today's tiles), the workout and the weigh-in with their icons, and in words
 * only what sets the day apart ("Over budget", "Not a full day"), so it is never only a colour.
 */
function DayFacts({ text }: { text: DayRowText }) {
  const { colors, dark } = useTheme();
  const palette = categoryColors(colors.primary, dark);
  return (
    <View style={styles.facts}>
      {text.grams ? (
        <>
          <DayFact dot={palette.protein.color} color={colors.onSurfaceVariant}>
            {text.grams.protein}
          </DayFact>
          <DayFact dot={palette.carbs.color} color={colors.onSurfaceVariant}>
            {text.grams.carbs}
          </DayFact>
          <DayFact dot={palette.fat.color} color={colors.onSurfaceVariant}>
            {text.grams.fat}
          </DayFact>
        </>
      ) : null}
      {text.exercise ? (
        <DayFact icon="run" color={colors.tertiary}>
          {text.exercise}
        </DayFact>
      ) : null}
      {text.weight ? (
        <DayFact icon="scale-bathroom" color={colors.primary}>
          {text.weight}
        </DayFact>
      ) : null}
      {text.flag ? (
        <AppText variant="labelMedium" color={colors.onSurfaceVariant} numberOfLines={1}>
          {text.flag}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * One day in "Every day": how full its budget was, what was eaten, and anything else logged. A day
 * over budget has a full ring with a second lap over it for the part that went over, the way its
 * bar on the Calories chart is marked only above the budget. The rows are one segmented group, so
 * each takes its corners from its place in the list. The row's sentence is its spoken label.
 */
function DayRow({ day, today, index, count, onOpen }: { day: DaySummary; today: string; index: number; count: number; onOpen: (date: string) => void }) {
  const { colors } = useTheme();
  const text = dayRowText(day, today);
  const workoutOnly = day.workouts > 0;
  return (
    <ListRow
      leading={
        day.logged ? (
          <MiniRing
            progress={budgetProgress(day.calories, day.budget)}
            size={AVATAR_SIZE}
            stroke={RING_STROKE}
            color={colors.primary}
            trackColor={withAlpha(colors.onSurface, Alpha.track)}>
            {day.over ? (
              <MiniRing
                progress={Math.max(MIN_OVER_ARC, overBudgetShare(day.calories, day.budget))}
                size={AVATAR_SIZE}
                stroke={RING_STROKE}
                color={colors.error}
                trackColor="transparent"
              />
            ) : null}
          </MiniRing>
        ) : (
          // A day with a workout or a weigh-in but no food: an avatar for what it does have, in that subject's colour.
          <Avatar icon={workoutOnly ? 'run' : 'scale-bathroom'} tone={workoutOnly ? 'tertiary' : 'primary'} />
        )
      }
      headline={text.title}
      below={<DayFacts text={text} />}
      figure={day.logged ? { value: formatKcal(day.calories), label: 'kcal' } : undefined}
      corners={groupCorners(index, count)}
      onPress={() => onOpen(day.date)}
      spoken={text.spoken}
    />
  );
}

function RowGap() {
  return <View style={styles.rowGap} />;
}

export default function ProgressScreen() {
  const { push, navigate } = useRouter();
  const { colors } = useTheme();
  const showSnack = useSnackbar();
  const today = useToday();
  const days = useInsightPeriod();
  const insights = useLiveQuery(() => loadInsights(today, days), [today, days]);
  const everyDay = insights.everyDay;
  const rows = everyDay.ready ? everyDay.days : [];

  // Where each section starts in the list, so a glance tile or the header button can scroll to it.
  const list = useRef<FlatList<DaySummary>>(null);
  const sectionTops = useRef<Partial<Record<SectionKey, number>>>({});
  const placeSection = (section: SectionKey, y: number) => {
    sectionTops.current[section] = y;
  };
  const jumpTo = (section: SectionKey) => {
    const y = sectionTops.current[section];
    if (y === undefined) return;
    list.current?.scrollToOffset({ offset: Math.max(0, y - Spacing.sm), animated: true });
  };

  const act = (action: InsightAction) => {
    switch (action) {
      case 'log-weight':
        push('/weight');
        break;
      case 'log-food':
        push({ pathname: '/log', params: { mode: 'text' } });
        break;
      case 'log-exercise':
        push('/exercise');
        break;
      case 'set-goal':
        // The target weight is set on the Settings tab.
        navigate('/settings');
        break;
      case 'longer-period':
        // A figure that a week cannot support: show the month it needs.
        void Haptics.selectionAsync();
        setInsightPeriod(30);
        break;
    }
  };

  /** Use the targets worked out for the current weight. One tap, with an Undo. */
  const recalculate = (toKg: number) => {
    const before = getSettings();
    if (!before.profile) return;
    applyCalculatedTargets({ ...before.profile, weightKg: toKg });
    void refreshWidgets();
    showSnack(`Targets updated for ${formatKg(toKg)}`, {
      label: 'Undo',
      onPress: () => {
        updateSettings({
          calorieGoal: before.calorieGoal,
          proteinGoal: before.proteinGoal,
          carbsGoal: before.carbsGoal,
          fatGoal: before.fatGoal,
          profile: before.profile,
          targetsWeightKg: before.targetsWeightKg,
        });
        void refreshWidgets();
      },
    });
  };

  /**
   * Decline the suggestion: the targets stay as they are, and this weight becomes the one they
   * count as set at, so the suggestion comes back only after the weight has moved as far again.
   */
  const keepTargets = (toKg: number) => {
    const before = getSettings().targetsWeightKg;
    updateSettings({ targetsWeightKg: toKg });
    showSnack('Targets kept', {
      label: 'Undo',
      onPress: () => {
        updateSettings({ targetsWeightKg: before });
      },
    });
  };

  const openDay = (date: string) => push({ pathname: '/day/[date]', params: { date } });

  const switchPeriod = (value: string) => {
    void Haptics.selectionAsync();
    setInsightPeriod(Number(value));
  };

  return (
    <SafeAreaView edges={['top']} style={[styles.screen, { backgroundColor: colors.surface }]}>
      <FlatList
        ref={list}
        data={rows}
        keyExtractor={(d) => d.date}
        renderItem={({ item, index }) => <DayRow day={item} today={today} index={index} count={rows.length} onOpen={openDay} />}
        ItemSeparatorComponent={RowGap}
        contentContainerStyle={styles.content}
        initialNumToRender={6}
        ListHeaderComponent={
          <View style={styles.sections}>
            <View>
              {/* The dates the page covers sit above its title. The button at the right skips the cards
                  and lands on the list of days, the way to any past day. */}
              <ScreenHeader
                title="Progress"
                supporting={periodRangeText(insights.period.from, insights.period.to)}
                trailing={
                  rows.length ? <IconButton icon="chevron-double-down" variant="tonal" label="Jump to every day" onPress={() => jumpTo('everyDay')} /> : undefined
                }
              />
              <View style={styles.top}>
                <SegmentedButtons value={String(days)} onChange={switchPeriod} options={PERIOD_OPTIONS} accessibilityLabel="Period" />
                <View style={styles.tiles}>
                  <HeadlineTile insights={insights} onAction={act} />
                  {insights.empty ? null : <GlanceGrid insights={insights} onAction={act} onJump={jumpTo} />}
                </View>
              </View>
            </View>
            {insights.empty ? (
              // Nothing logged in the period: one tile says what will show up, in place of an empty tile per card.
              <WhatShowsUpTile />
            ) : (
              <>
                <InsightCards
                  insights={insights}
                  onAction={act}
                  onRecalculate={recalculate}
                  onKeepTargets={keepTargets}
                  onOpenDay={openDay}
                  onSectionLayout={placeSection}
                />
                <View onLayout={(e) => placeSection('everyDay', e.nativeEvent.layout.y)}>
                  <SectionHeader title="Every day" hint={rows.length ? plural(rows.length, 'day') : undefined} />
                </View>
              </>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  // No FAB on this tab: the last day only has to clear the end of the page.
  content: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl },
  // 24dp before each section header. Section tops are measured against this view, which starts at the top of the list.
  sections: { gap: Spacing.xl },
  // The period switch, then the focal tile and the glance grid as one block of tiles.
  top: { gap: Spacing.lg },
  tiles: { gap: Spacing.sm },
  // The days are one segmented group: 2dp apart, with only the outer corners fully rounded.
  rowGap: { height: Spacing.xxs },
  facts: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Spacing.md, rowGap: 2, paddingTop: 2 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});

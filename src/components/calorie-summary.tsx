/**
 * The top of Today: the calories hero with its ring, and the three macro tiles under it.
 *
 * The ring is the screen's one hero moment (docs/DESIGN.md). Everything else here is quiet on
 * purpose: one display number, three small facts, three bars.
 */
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { categoryColors, type Category } from '@/constants/category-colors';
import { Alpha, Shape, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DayActivity } from '@/lib/health';
import { burnedForBudget, formatKcal } from '@/lib/nutrition';
import type { Settings } from '@/lib/settings';
import type { Macros } from '@/lib/types';
import { BudgetRing, MeterBar } from './expressive';
import { AppText, Icon, Tappable } from './ui';

const MACROS: { key: Category; label: string; goal: 'proteinGoal' | 'carbsGoal' | 'fatGoal' }[] = [
  { key: 'protein', label: 'Protein', goal: 'proteinGoal' },
  { key: 'carbs', label: 'Carbs', goal: 'carbsGoal' },
  { key: 'fat', label: 'Fat', goal: 'fatGoal' },
];

/**
 * Protein, carbs and fat as three category tiles: the name, the grams so far as the figure with
 * the target beside it, and a thick bar in the category colour. The bars spring to a new value
 * and remember the last one, so opening Today does not replay them.
 */
export function MacroTiles({ totals, settings }: { totals: Macros; settings: Settings }) {
  const { colors, dark } = useTheme();
  const { fontScale } = useWindowDimensions();
  const palette = categoryColors(colors.primary, dark);
  // At a large font size "150 of 230 g" no longer fits a third of the screen on one line. All three
  // tiles then put the target under the figure, so they still match each other.
  const stacked = fontScale > 1.15;
  return (
    <View style={styles.tiles}>
      {MACROS.map((m) => {
        const c = palette[m.key];
        const value = Math.round(totals[m.key]);
        const goal = settings[m.goal];
        return (
          <View
            key={m.key}
            style={[styles.tile, { backgroundColor: c.container }]}
            accessible
            accessibilityLabel={`${m.label}, ${value} of ${goal} grams`}>
            <View>
              <AppText variant="titleSmall" color={c.onContainer} numberOfLines={1}>
                {m.label}
              </AppText>
              <View style={stacked ? null : styles.amount}>
                <AppText variant="titleLarge" emphasized tabular color={c.onContainer} numberOfLines={1}>
                  {value}
                </AppText>
                <AppText variant="bodySmall" color={c.onContainer} numberOfLines={1}>
                  {`of ${goal} g`}
                </AppText>
              </View>
            </View>
            <MeterBar
              value={goal > 0 ? value / goal : 0}
              color={c.color}
              trackColor={withAlpha(c.onContainer, Alpha.track)}
              memory={`macro-${m.key}`}
            />
          </View>
        );
      })}
    </View>
  );
}

/** One fact under the ring: the figure, and what it is underneath with the colour of its mark. */
function Fact({ value, label, dot, color }: { value: string; label: string; dot?: string; color: string }) {
  return (
    <View style={styles.fact}>
      <AppText variant="titleMedium" emphasized tabular color={color} numberOfLines={1}>
        {value}
      </AppText>
      <View style={styles.factLabel}>
        {dot ? <View style={[styles.dot, { backgroundColor: dot }]} /> : null}
        <AppText variant="bodySmall" color={color} numberOfLines={1}>
          {label}
        </AppText>
      </View>
    </View>
  );
}

/**
 * The calories hero: the day's budget as a ring with what is left in the middle, and the three
 * figures it is made of underneath. The header band opens the day. Over budget the tile keeps its
 * colour; only the overshoot on the ring is drawn in the error colour and the words say "over".
 */
export function CaloriesTile({
  totals,
  settings,
  activity,
  exerciseKcal,
  onOpenDay,
}: {
  totals: Macros;
  settings: Settings;
  activity: DayActivity | null;
  /** Calories burned by workouts logged in the app today. */
  exerciseKcal: number;
  onOpenDay: () => void;
}) {
  const { colors } = useTheme();
  const burned = burnedForBudget(exerciseKcal, activity?.activeCalories ?? 0, settings.countExerciseCalories);
  const budget = settings.calorieGoal + burned;
  const left = Math.round(budget - totals.calories);
  const over = left < 0;
  const on = colors.onPrimaryContainer;

  return (
    <View style={[styles.hero, { backgroundColor: colors.primaryContainer }]}>
      <Tappable
        scale={0.98}
        onPress={onOpenDay}
        accessibilityLabel="Calories, see today’s details"
        rippleColor={withAlpha(on, Alpha.pressed)}
        style={styles.heroHeader}>
        <Icon name="fire" size={24} color={on} />
        <AppText variant="titleMedium" color={on} style={styles.fill}>
          Calories
        </AppText>
        <Icon name="chevron-right" size={24} color={on} />
      </Tappable>

      <View style={styles.ring}>
        <BudgetRing eaten={totals.calories} goal={settings.calorieGoal} burned={burned}>
          <View
            style={styles.number}
            accessible
            accessibilityLabel={`${formatKcal(Math.abs(left))} calories ${over ? 'over your budget' : 'left today'}`}>
            {/* One line that shrinks to the room inside the ring; the cap keeps a large font size from outgrowing it. */}
            <AppText variant="displayMedium" emphasized tabular color={on} numberOfLines={1} adjustsFontSizeToFit maxFontSizeMultiplier={1.15}>
              {formatKcal(Math.abs(left))}
            </AppText>
            <AppText variant="bodyMedium" color={on} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              {over ? 'kcal over' : 'kcal left'}
            </AppText>
          </View>
        </BudgetRing>
      </View>

      <View style={styles.facts}>
        <Fact value={formatKcal(totals.calories)} label="Eaten" dot={colors.primary} color={on} />
        {burned > 0 ? <Fact value={formatKcal(burned)} label="Burned" dot={colors.tertiary} color={on} /> : null}
        <Fact value={formatKcal(settings.calorieGoal)} label="Goal" color={on} />
      </View>
    </View>
  );
}

/**
 * The same day at a glance for the day view: a small ring drawn in place, the calories eaten with
 * how far under or over the budget that is, the three macros, and what the budget was made of when
 * exercise added to it. A sibling of the hero, and quieter: no display number.
 */
export function DaySummaryTile({
  totals,
  goal,
  burned,
}: {
  totals: Macros;
  /** The calorie goal. */
  goal: number;
  /** Calories burned that count toward the day's budget. */
  burned: number;
}) {
  const { colors, dark } = useTheme();
  const palette = categoryColors(colors.primary, dark);
  const on = colors.onPrimaryContainer;
  // Rounded exactly as Today's hero does, so the two never disagree by one.
  const left = Math.round(goal + burned - totals.calories);
  const over = left < 0;
  return (
    <View style={[styles.day, { backgroundColor: colors.primaryContainer }]}>
      <View style={styles.dayTop}>
        <BudgetRing eaten={totals.calories} goal={goal} burned={burned} size={88} stroke={8} memory={null}>
          <Icon name="fire" size={24} color={on} />
        </BudgetRing>
        <View style={styles.fill}>
          <AppText variant="headlineMedium" emphasized tabular color={on}>
            {`${formatKcal(totals.calories)}\u00A0kcal`}
          </AppText>
          <AppText variant="bodyLarge" tabular color={on}>
            {`${formatKcal(Math.abs(left))} ${over ? 'over' : 'under'} ${burned > 0 ? 'budget' : 'goal'}`}
          </AppText>
        </View>
      </View>
      <View style={styles.dayFacts}>
        {MACROS.map((m) => (
          <Fact key={m.key} value={`${Math.round(totals[m.key])}\u00A0g`} label={m.label} dot={palette[m.key].color} color={on} />
        ))}
      </View>
      {burned > 0 ? (
        <AppText variant="bodyMedium" color={on} style={styles.dayNote} textBreakStrategy="balanced">
          {`Budget ${formatKcal(goal + burned)}: ${formatKcal(goal)} goal plus ${formatKcal(burned)} burned`}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  tiles: { flexDirection: 'row', gap: Spacing.sm },
  tile: {
    flex: 1,
    minHeight: 96,
    justifyContent: 'space-between',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Shape.largeIncreased,
  },
  amount: { flexDirection: 'row', alignItems: 'baseline', gap: Spacing.xs },
  hero: { borderRadius: Shape.extraLargeIncreased, paddingBottom: Spacing.xl },
  // A full-width 56dp band, so the link has a proper touch target and its ripple follows the tile's top corners.
  heroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 56,
    paddingHorizontal: Spacing.xl,
    borderTopLeftRadius: Shape.extraLargeIncreased,
    borderTopRightRadius: Shape.extraLargeIncreased,
  },
  ring: { alignItems: 'center', paddingTop: Spacing.xs },
  number: { alignItems: 'center', alignSelf: 'stretch' },
  facts: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  fact: { flex: 1, alignItems: 'center' },
  factLabel: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  dot: { width: 8, height: 8, borderRadius: Shape.full },
  day: { borderRadius: Shape.extraLargeIncreased, padding: Spacing.xl, gap: Spacing.lg },
  dayTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  dayFacts: { flexDirection: 'row', alignItems: 'flex-start' },
  dayNote: { textAlign: 'center' },
});

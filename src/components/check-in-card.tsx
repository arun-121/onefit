import { StyleSheet, View } from 'react-native';

import { Disclosure, GlanceFigure, RangeBar, useToneColors } from '@/components/glance';
import { AppText, Avatar, Button } from '@/components/ui';
import type { Category } from '@/constants/category-colors';
import { Shape, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { checkInScale, type CheckIn } from '@/lib/check-in';
import { formatKcal } from '@/lib/nutrition';

/**
 * The weekly check-in on Today, shown rather than told (docs/DESIGN.md, "Show, don't tell"):
 *
 *  - the new calorie target as the one figure, with how far it moves as a chip;
 *  - one picture: what the owner burns as a band and the new target as a dot on the same scale,
 *    so the gap between eating and burning is seen, not read;
 *  - the new protein, carbs and fat as three figures in their own colours;
 *  - one line saying what the target is for, the decision, and the whole reasoning one tap away.
 *
 * A quiet card on purpose: the calories ring stays the one lit hero, and "Update targets" is the
 * strongest fill here, as the main action should be.
 */
export function CheckInCard({ checkIn, onApply, onSkip }: { checkIn: CheckIn; onApply: () => void; onSkip: () => void }) {
  const { colors } = useTheme();
  const c = checkIn;
  const { min, max } = checkInScale(c);
  const burn = `${formatKcal(c.burnLow)}–${formatKcal(c.burnHigh)}`;
  const now = c.current.calories;
  const target = c.targets.calories;
  const change = Math.abs(c.change);
  const figure = c.onTrack
    ? {
        value: formatKcal(now),
        unit: 'kcal a day',
        delta: { direction: 'flat' as const, amount: 'On track', towardGoal: true, accessibilityLabel: 'On track: your target still fits' },
      }
    : {
        value: formatKcal(target),
        unit: 'kcal a day',
        delta: {
          direction: c.change > 0 ? ('up' as const) : ('down' as const),
          amount: `${formatKcal(change)} kcal`,
          // The check-in's change is what the goal asks for, so it is always a step toward it.
          towardGoal: true,
          accessibilityLabel: `${formatKcal(change)} kcal ${c.change > 0 ? 'more' : 'less'} than your ${formatKcal(now)} kcal target now`,
        },
      };

  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceContainerHigh }]}>
      <View style={styles.head}>
        <Avatar icon="calendar-check-outline" tone="primary" size={36} />
        <AppText variant="titleMedium" emphasized style={styles.fill}>
          Weekly check-in
        </AppText>
      </View>

      <GlanceFigure
        value={figure.value}
        unit={figure.unit}
        delta={figure.delta}
        accessibilityLabel={c.onTrack ? `Your target of ${formatKcal(now)} kcal a day still fits` : `New target: ${formatKcal(target)} kcal a day. ${figure.delta.accessibilityLabel}`}
      />

      <RangeBar
        min={min}
        max={max}
        low={c.burnLow}
        high={c.burnHigh}
        // Calories burned are movement, so the band is tertiary; the targets are food, so primary.
        tone="tertiary"
        bandLabel={{ label: 'You burn', figure: burn }}
        // The target the card is about as a dot. Today's target is not drawn too: the chip already says how far it moves.
        marks={[{ value: c.onTrack ? now : target, label: 'Target', kind: 'dot', tone: 'primary' }]}
        accessibilityLabel={c.burnText}
      />

      <MacroTargets targets={c.targets} />

      <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
        {c.line}
      </AppText>

      <View style={styles.buttons}>
        {c.onTrack ? (
          <Button title="Done" icon="check" onPress={onSkip} hitSlop={4} />
        ) : (
          <>
            <Button title="Not now" variant="text" onPress={onSkip} hitSlop={4} />
            <Button title="Update targets" icon="check" onPress={onApply} hitSlop={4} />
          </>
        )}
      </View>

      {/* The reasoning, last, as on every card: the decision does not wait on reading it. */}
      <Disclosure>{c.body}</Disclosure>
    </View>
  );
}

const MACROS: { key: Category; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
];

/**
 * The new protein, carbs and fat as three figures, each in its category's colour, the way Today's
 * macro tiles colour them, with its name underneath. No dots or bars: the colour is the key.
 */
function MacroTargets({ targets }: { targets: { protein: number; carbs: number; fat: number } }) {
  return (
    <View style={styles.macros}>
      {MACROS.map((m) => (
        <MacroFigure key={m.key} category={m.key} label={m.label} grams={targets[m.key]} />
      ))}
    </View>
  );
}

function MacroFigure({ category, label, grams }: { category: Category; label: string; grams: number }) {
  const { colors } = useTheme();
  const tone = useToneColors(category);
  return (
    <View style={styles.macro} accessible accessibilityLabel={`${label}, ${Math.round(grams)} grams a day`}>
      <AppText variant="titleMedium" emphasized tabular color={tone.color} numberOfLines={1}>
        {`${Math.round(grams)} g`}
      </AppText>
      <AppText variant="bodySmall" color={colors.onSurfaceVariant} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  // 20dp, like the Heads up and Next step cards under it: one family of quiet cards below the 32dp hero.
  card: { borderRadius: Shape.largeIncreased, padding: Spacing.lg, gap: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  fill: { flex: 1 },
  macros: { flexDirection: 'row', gap: Spacing.md },
  macro: { flex: 1, minWidth: 0 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
});

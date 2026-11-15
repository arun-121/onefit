import { StyleSheet, View } from 'react-native';

import { ProportionBar } from '@/components/charts';
import { GlanceFigure, useToneColors } from '@/components/glance';
import { AppText, Avatar, Button, Chip } from '@/components/ui';
import { Shape, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CoachTip } from '@/lib/coach';
import { formatKcal } from '@/lib/nutrition';
import type { SavedFood } from '@/lib/types';

/**
 * Today's next step, shown rather than told: the coach's answer is the card's title and its one
 * figure ("55 g protein to go"), a protein bar of what is eaten against the goal with the calories
 * left at its end, at most one short line, the saved foods that fit (a tap logs one, like Log
 * again), and the way into the Assistant tab for anything more. The tip's whole sentence is what a
 * screen reader says.
 */
export function CoachCard({ tip, onLog, onAsk }: { tip: CoachTip; onLog: (food: SavedFood) => void; onAsk: () => void }) {
  const { colors } = useTheme();
  // On a Build muscle evening the foods are there to fill the calories, so each chip says how many it brings.
  const byCalories = tip.kind === 'surplus';
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceContainerHigh }]}>
      <View style={styles.head}>
        {/* 36dp, like the check-in's and Heads up's avatars: the cards between the tiles and the meals are one family. */}
        <Avatar icon="auto-fix" tone="secondary" size={36} />
        <View style={styles.fill}>
          {tip.figure ? (
            <GlanceFigure value={tip.figure.value} unit={tip.figure.unit} accessibilityLabel={`${tip.title}. ${tip.body}`} />
          ) : (
            <AppText variant="titleMedium" emphasized accessibilityLabel={`${tip.title}. ${tip.body}`}>
              {tip.title}
            </AppText>
          )}
        </View>
      </View>
      {tip.protein ? (
        <ProteinMeter
          eaten={tip.protein.eaten}
          goal={tip.protein.goal}
          kcalLeft={tip.kcalLeft}
          // The figure above already says what is eaten (protein reached) or the calories left (surplus): not twice.
          eatenInFigure={tip.kind === 'protein-done'}
          kcalInFigure={tip.kind === 'surplus'}
        />
      ) : null}
      {tip.line ? (
        <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
          {tip.line}
        </AppText>
      ) : null}
      {tip.suggestions.length ? (
        <View style={styles.chips}>
          {tip.suggestions.map((f) => (
            <Chip
              key={f.id}
              kind="tonal"
              icon="plus"
              label={f.name}
              trailing={!byCalories && f.protein >= 8 ? `${Math.round(f.protein)} g protein` : `${formatKcal(f.calories)} kcal`}
              onPress={() => onLog(f)}
            />
          ))}
        </View>
      ) : null}
      <Button title="Ask the assistant" variant="text" onPress={onAsk} style={styles.ask} hitSlop={4} />
    </View>
  );
}

/**
 * Protein eaten against the goal, as a bar in protein's colour: under it, the grams on the left and
 * the calories left in the day at the right, which is the room the suggested foods must fit.
 * A number the card's figure already gives is not written again: with the eaten grams in the
 * figure the left label is only the goal, and with the calories left in the figure the right
 * label goes. Drawn in place: Today's macro tile above already springs to each new value.
 */
function ProteinMeter({
  eaten,
  goal,
  kcalLeft,
  eatenInFigure = false,
  kcalInFigure = false,
}: {
  eaten: number;
  goal: number;
  kcalLeft: number;
  eatenInFigure?: boolean;
  kcalInFigure?: boolean;
}) {
  const { colors } = useTheme();
  const protein = useToneColors('protein');
  const left = Math.max(0, kcalLeft);
  return (
    <View
      style={styles.meter}
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Protein: ${eaten} of ${goal} grams eaten. ${formatKcal(left)} kcal left today.`}>
      <ProportionBar value={goal > 0 ? eaten / goal : 0} color={protein.color} height={8} />
      <View style={styles.meterLabels}>
        {eatenInFigure ? (
          <AppText variant="labelMedium" tabular color={colors.onSurfaceVariant} numberOfLines={1} style={styles.shrink}>
            {'Goal '}
            <AppText variant="labelMedium" emphasized tabular color={colors.onSurface}>
              {`${goal} g`}
            </AppText>
          </AppText>
        ) : (
          <AppText variant="labelMedium" tabular color={colors.onSurfaceVariant} numberOfLines={1} style={styles.shrink}>
            <AppText variant="labelMedium" emphasized tabular color={colors.onSurface}>
              {String(eaten)}
            </AppText>
            {` of ${goal} g protein`}
          </AppText>
        )}
        {kcalInFigure ? null : (
          <AppText variant="labelMedium" tabular color={colors.onSurfaceVariant} numberOfLines={1} style={styles.shrink}>
            <AppText variant="labelMedium" emphasized tabular color={colors.onSurface}>
              {formatKcal(left)}
            </AppText>
            {' kcal left'}
          </AppText>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Shape.largeIncreased, padding: Spacing.lg, paddingBottom: Spacing.sm, gap: Spacing.md },
  head: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  fill: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  meter: { gap: Spacing.sm },
  meterLabels: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  // A text button whose label lines up with the content's left edge; its padding and ripple reach into the card's.
  ask: { alignSelf: 'flex-start', marginLeft: -Spacing.md },
});

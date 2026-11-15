import { StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button, Chip } from '@/components/ui';
import { Shape, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CoachTip } from '@/lib/coach';
import { formatKcal } from '@/lib/nutrition';
import type { SavedFood } from '@/lib/types';

/**
 * Today's next step: one sentence from the coach, the saved foods that fit what is left (a tap logs
 * one, like Log again), and the way into the Assistant tab for anything more.
 */
export function CoachCard({ tip, onLog, onAsk }: { tip: CoachTip; onLog: (food: SavedFood) => void; onAsk: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceContainerHigh }]}>
      <View style={styles.head}>
        <Avatar icon="auto-fix" tone="secondary" />
        <View style={styles.text}>
          <AppText variant="titleMedium" emphasized>
            {tip.title}
          </AppText>
          <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
            {tip.body}
          </AppText>
        </View>
      </View>
      {tip.suggestions.length ? (
        <View style={styles.chips}>
          {tip.suggestions.map((f) => (
            <Chip
              key={f.id}
              kind="tonal"
              icon="plus"
              label={f.name}
              trailing={f.protein >= 8 ? `${Math.round(f.protein)} g protein` : `${formatKcal(f.calories)} kcal`}
              onPress={() => onLog(f)}
            />
          ))}
        </View>
      ) : null}
      <Button title="Ask the assistant" variant="text" onPress={onAsk} style={styles.ask} hitSlop={4} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Shape.largeIncreased, padding: Spacing.lg, paddingBottom: Spacing.sm, gap: Spacing.md },
  head: { flexDirection: 'row', gap: Spacing.lg, alignItems: 'flex-start' },
  text: { flex: 1, gap: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  ask: { alignSelf: 'flex-end' },
});

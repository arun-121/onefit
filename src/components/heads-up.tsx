import { StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button, IconButton, type IconName } from '@/components/ui';
import { Shape, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Nudge, NudgeKind } from '@/lib/nudges';

const LOOK: Record<NudgeKind, { icon: IconName; tone: 'primary' | 'secondary' | 'tertiary' }> = {
  unusual: { icon: 'chart-line', tone: 'primary' },
  tip: { icon: 'lightbulb-on-outline', tone: 'secondary' },
  win: { icon: 'medal-outline', tone: 'tertiary' },
};

/**
 * What the app noticed, on Today: one row per nudge with its reason, the step it suggests and a
 * way to dismiss it for good. Quiet rows on the unlit surface, so the screen's focal tile stays
 * the calories hero.
 */
export function HeadsUp({ nudges, onAction, onDismiss }: { nudges: readonly Nudge[]; onAction: (n: Nudge) => void; onDismiss: (n: Nudge) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.list}>
      {nudges.map((n) => (
        <View key={n.id} style={[styles.card, { backgroundColor: colors.surfaceContainerHigh }]}>
          <View style={styles.head}>
            <Avatar icon={LOOK[n.kind].icon} tone={LOOK[n.kind].tone} />
            <View style={styles.text}>
              <AppText variant="titleMedium" emphasized>
                {n.title}
              </AppText>
              <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
                {n.body}
              </AppText>
            </View>
            <IconButton icon="close" label={`Dismiss: ${n.title}`} onPress={() => onDismiss(n)} />
          </View>
          {n.action ? <Button title={n.action.label} variant="tonal" onPress={() => onAction(n)} style={styles.action} /> : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: Spacing.sm },
  card: { borderRadius: Shape.largeIncreased, padding: Spacing.lg, paddingRight: Spacing.xs, gap: Spacing.md },
  head: { flexDirection: 'row', gap: Spacing.lg, alignItems: 'flex-start' },
  text: { flex: 1, gap: Spacing.xs },
  action: { alignSelf: 'flex-end', marginRight: Spacing.md },
});

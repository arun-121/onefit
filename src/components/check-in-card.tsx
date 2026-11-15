import { StyleSheet, View } from 'react-native';

import { AppText, Avatar, Button } from '@/components/ui';
import { Shape, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { CheckIn } from '@/lib/check-in';

/**
 * The weekly check-in on Today: what the owner really burns and the targets that follow for their
 * goal. Lit like the screen's focal tile, because it changes what every day after it counts against.
 */
export function CheckInCard({ checkIn, onApply, onSkip }: { checkIn: CheckIn; onApply: () => void; onSkip: () => void }) {
  const { colors } = useTheme();
  const on = colors.onPrimaryContainer;
  return (
    <View style={[styles.card, { backgroundColor: colors.primaryContainer }]}>
      <View style={styles.head}>
        <Avatar icon="calendar-check-outline" tint={on} />
        <View style={styles.text}>
          <AppText variant="titleMedium" emphasized color={on}>
            {checkIn.title}
          </AppText>
          <AppText variant="bodyMedium" color={on}>
            {checkIn.body}
          </AppText>
        </View>
      </View>
      <View style={styles.buttons}>
        {checkIn.onTrack ? (
          <Button title="Done" icon="check" onPress={onSkip} />
        ) : (
          <>
            <Button title="Not now" variant="text" onPress={onSkip} />
            <Button title="Update targets" icon="check" onPress={onApply} />
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: Shape.extraLarge, padding: Spacing.lg, gap: Spacing.lg },
  head: { flexDirection: 'row', gap: Spacing.lg, alignItems: 'flex-start' },
  text: { flex: 1, gap: Spacing.xs },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.sm },
});

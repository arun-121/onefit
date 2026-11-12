/**
 * The pieces of Settings that are not in ui.tsx. Settings is segmented groups of rows
 * (docs/DESIGN.md); these are the rows a plain `GroupRow` cannot draw, and the card the number
 * fields sit in:
 *
 *  - `FieldCard`: the 20dp card that holds text fields.
 *  - `ActionRow`: a row whose button sits under its words, at the right, so a long supporting
 *    line keeps the full width.
 *  - `ButtonRow`: a row with a short button at its end, which moves under the words at a large
 *    font size.
 *  - `ExpanderRow` and `Panel`: a row that opens, and the part that opens under it. Both are rows
 *    of the same `Group`, so the open part reads as belonging to the row above it.
 *  - `Cue`: the small icon at the end of a row that says what a tap does.
 */
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Shape, Spacing, Springs } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AppText, Avatar, GroupItem, GroupRow, Icon, type AvatarTone, type IconName } from './ui';

/**
 * Up to this font scale three fields fit side by side and a short button fits beside a row's
 * words. Past it, rows of fields hold two and the button moves under the words.
 */
export const ROOMY_FONT_SCALE = 1.15;

/** The tone of an avatar that is lit while its setting is on, and a "not yet" ring while it is off. */
export function litTone(on: boolean, tone: AvatarTone): AvatarTone {
  return on ? tone : 'ring';
}

/** The words of a row, laid out as `GroupRow` lays them out. */
function RowText({ headline, supporting }: { headline: string; supporting?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.rowText}>
      <AppText variant="titleMedium" numberOfLines={2} textBreakStrategy="balanced">
        {headline}
      </AppText>
      {supporting ? (
        <AppText variant="bodyMedium" color={colors.onSurfaceVariant} textBreakStrategy="balanced">
          {supporting}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * The card text fields sit in: 20dp corners on the ground rows and chart cards use, one step
 * below the fields' own fill. Its 16dp padding leaves the fields' 4dp corners concentric with its
 * own. Not a row of a `Group`; put it above one with 8dp between.
 */
export function FieldCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  return <View style={[styles.card, { backgroundColor: colors.surfaceContainerHigh }, style]}>{children}</View>;
}

/**
 * A row of a `Group` that says how something stands and offers what to do about it: the avatar
 * and the words as in a `GroupRow`, and the buttons under the words at the right. With `onPress`
 * the whole row is a button as well.
 */
export function ActionRow({
  icon,
  tone,
  headline,
  supporting,
  actions,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  tone: AvatarTone;
  headline: string;
  supporting?: string;
  /** One or two `Button`s. Left out, the row is the words alone. */
  actions?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <GroupItem onPress={onPress} accessibilityLabel={accessibilityLabel} style={styles.actionRow}>
      <View style={styles.rowTop}>
        <Avatar icon={icon} tone={tone} />
        <RowText headline={headline} supporting={supporting} />
      </View>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </GroupItem>
  );
}

/**
 * A row of a `Group` with one short button ("Allow"). The button sits at the end of the row while
 * the words fit beside it; at a large font size it moves under them, so the headline is not
 * squeezed into a column that leaves its last word alone on a line.
 */
export function ButtonRow({
  icon,
  tone,
  headline,
  supporting,
  button,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  tone: AvatarTone;
  headline: string;
  supporting?: string;
  button: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { fontScale } = useWindowDimensions();
  if (fontScale > ROOMY_FONT_SCALE) {
    return (
      <ActionRow
        icon={icon}
        tone={tone}
        headline={headline}
        supporting={supporting}
        actions={button}
        onPress={onPress}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  return (
    <GroupRow
      icon={icon}
      tone={tone}
      headline={headline}
      supporting={supporting}
      trailing={button}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
    />
  );
}

/** The chevron of a row that opens. It turns over as the row opens, with the spring every selection uses. */
function Chevron({ open }: { open: boolean }) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(withSpring(open ? 1 : 0, Springs.spatial));
  }, [open, turn]);
  const turned = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get() * 180}deg` }] }));
  return (
    <Animated.View style={turned} importantForAccessibility="no-hide-descendants">
      <Icon name="chevron-down" />
    </Animated.View>
  );
}

/**
 * A row of a `Group` that opens and closes what is under it. The whole row is the button; a
 * screen reader is told whether it is open. Follow it with a `Panel` while `open`.
 */
export function ExpanderRow({
  icon,
  tone,
  headline,
  supporting,
  open,
  onPress,
}: {
  icon: IconName;
  tone: AvatarTone;
  headline: string;
  supporting?: string;
  open: boolean;
  onPress: () => void;
}) {
  return (
    <GroupItem onPress={onPress} accessibilityState={{ expanded: open }} style={[styles.row, { minHeight: supporting ? 72 : 56 }]}>
      <Avatar icon={icon} tone={tone} />
      <RowText headline={headline} supporting={supporting} />
      <Chevron open={open} />
    </GroupItem>
  );
}

/**
 * The open part of a row: fields, choices and the button that uses them, on the lighter ground
 * sheets use, so chips and fields show on it. It is its own row of the `Group`, straight after
 * the row it belongs to.
 *
 * With `appear`, its content fades and settles in when it is added (180 ms, ease-out): the rows
 * under it have just jumped down, and content that arrived with no transition would read as a
 * glitch. Opened perhaps once a month, so the motion costs nothing. Leave `appear` off for a
 * panel that is always there.
 */
export function Panel({ children, appear = false }: { children: ReactNode; appear?: boolean }) {
  const { colors } = useTheme();
  const shown = useSharedValue(appear ? 0 : 1);
  useEffect(() => {
    shown.set(withTiming(1, { duration: 180, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));
  }, [shown]);
  const settle = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: (shown.get() - 1) * Spacing.sm }] }));
  return (
    <GroupItem color={colors.surfaceContainerLow}>
      <Animated.View style={[styles.panel, settle]}>{children}</Animated.View>
    </GroupItem>
  );
}

/** The small icon at the end of a pressable row. Only a cue: the row is the button. */
export function Cue({ icon = 'chevron-right' }: { icon?: IconName }) {
  return (
    <View importantForAccessibility="no-hide-descendants">
      <Icon name={icon} />
    </View>
  );
}

const styles = StyleSheet.create({
  rowText: { flex: 1, minWidth: 0 },
  // The same measures as a GroupRow, so custom rows line up with standard ones.
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  actionRow: { paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, minHeight: 56 },
  // Wraps, so two buttons that do not fit side by side at a large font size stack instead of clipping.
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.sm,
  },
  card: { borderRadius: Shape.largeIncreased, padding: Spacing.lg, gap: Spacing.lg },
  panel: { padding: Spacing.lg, gap: Spacing.lg },
});

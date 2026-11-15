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
 *    of the same `Group`, so the open part reads as belonging to the row above it. `Chevron` is
 *    that row's cue, for a sheet row that opens the same way (the exercise sheet's drafts).
 *  - `Cue`: the small icon at the end of a row that says what a tap does.
 *  - `SyncIcons`: what syncs with Health Connect, one lit or unlit icon each.
 *  - `Pill`: a quiet fact on a lit card, such as the calculator's result.
 */
import { useEffect, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { AVATAR_SIZE, Shape, Spacing, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { SyncItem, SyncKey } from './screen-text';
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
  extra,
  onPress,
  accessibilityLabel,
}: {
  icon: IconName;
  tone: AvatarTone;
  headline: string;
  supporting?: string;
  /** One or two `Button`s. Left out, the row is the words alone. */
  actions?: ReactNode;
  /** A small picture under the words, lined up with them, such as `SyncIcons`. */
  extra?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <GroupItem onPress={onPress} accessibilityLabel={accessibilityLabel} style={styles.actionRow}>
      <View style={styles.rowTop}>
        <Avatar icon={icon} tone={tone} />
        <RowText headline={headline} supporting={supporting} />
      </View>
      {extra ? <View style={styles.extra}>{extra}</View> : null}
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

/** Emil Kowalski's strong ease-out, the curve "How it's worked out" opens on: the movement starts at once. */
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);
/** Opening takes 200ms, closing 150ms, as the disclosure does: the answer to a tap is quick, going away quicker. */
const OPEN_MS = 200;
const CLOSE_MS = 150;

/**
 * The chevron of a row that opens. It turns over as the row opens, on the same timing as the
 * chevron of "How it's worked out", so every chevron in the app turns alike (a timing can be
 * turned round mid-way by a second tap). Also the cue on a sheet's row that opens its editor
 * under it (the exercise sheet).
 */
export function Chevron({ open }: { open: boolean }) {
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.set(withTiming(open ? 1 : 0, { duration: open ? OPEN_MS : CLOSE_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.System }));
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
 * With `appear`, its content fades and settles in when it is added (200 ms on the strong ease-out,
 * with the chevron above it): the rows under it have just jumped down, and content that arrived
 * with no transition would read as a glitch. Opened now and then, so the motion costs nothing.
 * With the phone's "Remove animations" on it only fades, as the disclosure does. Leave `appear`
 * off for a panel that is always there.
 *
 * `color` is for a group that sits on a sheet, whose ground is already `surfaceContainerLow`: there
 * the panel takes the rows' own fill, so it does not read as a hole in the group.
 */
export function Panel({ children, appear = false, color }: { children: ReactNode; appear?: boolean; color?: string }) {
  const { colors } = useTheme();
  const reduceMotion = useReducedMotion();
  const shown = useSharedValue(appear ? 0 : 1);
  useEffect(() => {
    // Reduced motion is handled here, not by the system default, which would also skip the fade.
    shown.set(withTiming(1, { duration: OPEN_MS, easing: EASE_OUT, reduceMotion: ReduceMotion.Never }));
  }, [shown]);
  const rise = reduceMotion ? 0 : Spacing.sm;
  const settle = useAnimatedStyle(() => ({ opacity: shown.get(), transform: [{ translateY: (shown.get() - 1) * rise }] }));
  return (
    <GroupItem color={color ?? colors.surfaceContainerLow}>
      <Animated.View style={[styles.panel, settle]}>{children}</Animated.View>
    </GroupItem>
  );
}

const SYNC_LOOK: Record<SyncKey, { icon: IconName; tone: AvatarTone }> = {
  meals: { icon: 'silverware-fork-knife', tone: 'primary' },
  workouts: { icon: 'run', tone: 'tertiary' },
  weight: { icon: 'scale-bathroom', tone: 'primary' },
  activity: { icon: 'shoe-print', tone: 'tertiary' },
};

/**
 * What syncs with Health Connect, as a row of small avatars with a word under each: lit in the
 * subject's container colour while it syncs (food and weight primary, movement tertiary), a plain
 * ring while it does not, the way Today lights a tile. One element to a screen reader, which says
 * `label`, the sentence the icons stand for.
 */
export function SyncIcons({ items, label }: { items: readonly SyncItem[]; label: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sync} accessible accessibilityLabel={label}>
      {items.map((item) => (
        <View key={item.key} style={styles.syncItem}>
          <Avatar icon={SYNC_LOOK[item.key].icon} tone={item.on ? SYNC_LOOK[item.key].tone : 'ring'} size={32} />
          <AppText variant="labelSmall" color={item.on ? colors.onSurface : colors.onSurfaceVariant} numberOfLines={1} maxFontSizeMultiplier={1.5}>
            {item.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/**
 * A quiet fact on a lit card: an icon and a few words in the card's on-colour, on a faint tint of
 * it. Not pressable. For a lit card the delta chip cannot sit on, since its filled state is the
 * card's own container colour.
 */
export function Pill({ icon, label, color }: { icon: IconName; label: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: withAlpha(color, 0.1) }]}>
      <Icon name={icon} size={16} color={color} />
      <AppText variant="labelLarge" emphasized tabular color={color} numberOfLines={2} style={styles.pillText}>
        {label}
      </AppText>
    </View>
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
  // Under the words, so it starts where the headline does.
  extra: { paddingLeft: AVATAR_SIZE + Spacing.lg, paddingBottom: Spacing.xs },
  sync: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md },
  syncItem: { alignItems: 'center', gap: Spacing.xs, minWidth: 48 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.xs,
    minHeight: 28,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.md,
    paddingVertical: 2,
    borderRadius: Shape.full,
  },
  pillText: { flexShrink: 1 },
  panel: { padding: Spacing.lg, gap: Spacing.lg },
});

/**
 * What every bottom sheet is built from (docs/DESIGN.md, "Sheets"): the scrolling ground, the
 * title row with its icon buttons, the value box with quiet − and + either side of one large
 * number, and the tile of a grid of choices.
 *
 * A sheet reads top to bottom as: title row, value box, choices, then ONE full-width 56dp primary
 * button that says what it does. Nothing sits below that button; delete lives in the title row.
 */
import { useEffect, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Easing, interpolateColor, ReduceMotion, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { Alpha, Shape, Spacing, Springs, TOUCH_TARGET, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AppText, Icon, IconButton, Tappable, type IconName, type SelectionTone } from './ui';

/** The round − and + of a value box (dp). Larger than an icon button: they are held, not just tapped. */
const STEPPER_SIZE = 56;
/** How strongly the circle behind − and + is tinted with the subject's colour (an M3 state-layer step). */
const STEPPER_TINT = 0.12;

// ---------------------------------------------------------------- ground

/**
 * The scrolling ground of a sheet: `surfaceContainerLow`, the screen's 16dp gutter, 24dp between
 * the blocks. Taps on a button land while the keyboard is up.
 */
export function Sheet({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  return (
    <ScrollView style={{ backgroundColor: colors.surfaceContainerLow }} contentContainerStyle={styles.sheet} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  );
}

// ---------------------------------------------------------------- title row

/**
 * The title row of a sheet: the title in `headlineSmall` emphasised with the day (or one quiet
 * line) underneath, and the icon buttons at the right: delete in the error colour when the sheet
 * is editing something, then close. Above it sits the drag handle of a sheet that can be pulled;
 * a full-screen page (Log food) leaves the handle out.
 */
export function SheetHeader({
  title,
  supporting,
  onClose,
  onDelete,
  deleteLabel = 'Delete',
  handle = true,
}: {
  title: string;
  /** The line under the title: the day the sheet is about. */
  supporting?: string;
  onClose: () => void;
  /** Given when the sheet edits something that can be deleted. */
  onDelete?: () => void;
  deleteLabel?: string;
  /** The drag handle of a bottom sheet. */
  handle?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <View style={handle ? null : styles.noHandle}>
      {handle ? (
        <View style={styles.handleArea} importantForAccessibility="no-hide-descendants">
          <View style={[styles.handle, { backgroundColor: colors.outlineVariant }]} />
        </View>
      ) : null}
      <View style={styles.titleRow}>
        <View style={styles.fill}>
          <AppText variant="headlineSmall" emphasized accessibilityRole="header" numberOfLines={2}>
            {title}
          </AppText>
          {supporting ? (
            <AppText variant="bodyMedium" color={colors.onSurfaceVariant} textBreakStrategy="balanced">
              {supporting}
            </AppText>
          ) : null}
        </View>
        <View style={styles.actions}>
          {onDelete ? <IconButton icon="trash-can-outline" label={deleteLabel} color={colors.error} onPress={onDelete} /> : null}
          <IconButton icon="close" variant="tonal" label="Close" onPress={onClose} />
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- value box

/** One of the two round buttons of a value box. `onLongPress` and `onPressOut` are for a button that repeats while held. */
export interface StepAction {
  /** What a screen reader says: "5 minutes less". */
  label: string;
  onPress: () => void;
  onLongPress?: () => void;
  onPressOut?: () => void;
  delayLongPress?: number;
}

function useValueTone(tone: SelectionTone): { container: string; on: string; accent: string } {
  const { colors } = useTheme();
  return tone === 'tertiary'
    ? { container: colors.tertiaryContainer, on: colors.onTertiaryContainer, accent: colors.tertiary }
    : { container: colors.primaryContainer, on: colors.onPrimaryContainer, accent: colors.primary };
}

/** The colour of what sits on a value box of this tone: its number, its unit. */
export function useValueColor(tone: SelectionTone): string {
  return useValueTone(tone).on;
}

function StepButton({ icon, action, tone }: { icon: IconName; action: StepAction; tone: SelectionTone }) {
  const look = useValueTone(tone);
  return (
    <Tappable
      scale={0.95}
      onPress={action.onPress}
      onLongPress={action.onLongPress}
      onPressOut={action.onPressOut}
      delayLongPress={action.delayLongPress}
      accessibilityLabel={action.label}
      rippleColor={withAlpha(look.on, Alpha.pressed)}
      style={[styles.stepper, { backgroundColor: withAlpha(look.accent, STEPPER_TINT) }]}>
      <Icon name={icon} size={24} color={look.on} />
    </Tappable>
  );
}

/**
 * The value box of a sheet: the one large number, in its subject's container colour (primary for
 * weight, tertiary for movement) with 28dp corners, and a quiet round − and + either side. The
 * steppers are a soft tint, so the sheet's save button stays its only strong fill. The children
 * are the number and its unit; colour them with `useValueColor(tone)`.
 */
export function ValueBox({
  tone,
  minus,
  plus,
  children,
}: {
  tone: SelectionTone;
  minus: StepAction;
  plus: StepAction;
  children: ReactNode;
}) {
  const look = useValueTone(tone);
  return (
    <View style={[styles.valueBox, { backgroundColor: look.container }]}>
      <StepButton icon="minus" action={minus} tone={tone} />
      <View style={styles.value}>{children}</View>
      <StepButton icon="plus" action={plus} tone={tone} />
    </View>
  );
}

// ---------------------------------------------------------------- choice tiles

/**
 * One tile of a grid of exclusive choices (the activities of a workout): an icon over a label.
 * Unselected it is a quiet `surfaceContainerHigh` tile with 20dp corners; selected it takes the
 * selection fill with an emphasised label and its corners spring rounder, the way the selected
 * segment of a connected button group does. Put the tiles in a wrapping row with 8dp gaps and
 * give the row the `radiogroup` role.
 */
export function ChoiceTile({
  icon,
  label,
  selected,
  onPress,
  tone = 'primary',
}: {
  icon: IconName;
  label: string;
  selected: boolean;
  onPress: () => void;
  tone?: SelectionTone;
}) {
  const { colors } = useTheme();
  const fillColor = tone === 'tertiary' ? colors.tertiary : colors.primary;
  const onFill = tone === 'tertiary' ? colors.onTertiary : colors.onPrimary;
  // Two values, because the shape may overshoot a little as it settles and a fill must not.
  const shape = useSharedValue(selected ? 1 : 0);
  const fill = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    shape.set(withSpring(selected ? 1 : 0, Springs.spatial));
    fill.set(withTiming(selected ? 1 : 0, { duration: 150, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));
  }, [selected, shape, fill]);
  const rest = colors.surfaceContainerHigh;
  const surface = useAnimatedStyle(() => ({
    // The fill is the surface's own colour, so the ripple still shows on a selected tile.
    backgroundColor: interpolateColor(fill.get(), [0, 1], [rest, fillColor]),
    borderRadius: Shape.largeIncreased + (Shape.extraLargeIncreased - Shape.largeIncreased) * Math.max(0, shape.get()),
  }));
  const fg = selected ? onFill : colors.onSurfaceVariant;
  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      rippleColor={withAlpha(fg, Alpha.pressed)}
      style={[styles.choice, surface]}>
      <Icon name={icon} size={24} color={fg} />
      {/* One line always: a long name at a very large font size gets a little smaller instead of being cut. */}
      <AppText variant="labelLarge" emphasized={selected} color={fg} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </AppText>
    </Tappable>
  );
}

// ---------------------------------------------------------------- notes

/**
 * One quiet line with a small icon in front: what a figure is built on, or what to check. It has
 * no padding of its own; under a value box, indent it by the box's own padding with `style`.
 */
export function Note({
  icon = 'information-outline',
  color,
  style,
  children,
}: {
  icon?: IconName;
  color?: string;
  style?: StyleProp<ViewStyle>;
  children: string;
}) {
  const { colors } = useTheme();
  const fg = color ?? colors.onSurfaceVariant;
  return (
    <View style={[styles.note, style]}>
      <Icon name={icon} size={20} color={fg} />
      <AppText variant="bodyMedium" color={fg} textBreakStrategy="balanced" style={styles.fill}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  sheet: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.xl },
  noHandle: { paddingTop: Spacing.lg },
  handleArea: { alignItems: 'center', paddingTop: Spacing.md, paddingBottom: Spacing.md },
  handle: { width: Spacing.xxl, height: Spacing.xs, borderRadius: Shape.full },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, paddingHorizontal: Spacing.xs, minHeight: TOUCH_TARGET },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  valueBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.lg,
    borderRadius: Shape.extraLarge,
  },
  value: { flex: 1, minWidth: 0, alignItems: 'center' },
  stepper: { width: STEPPER_SIZE, height: STEPPER_SIZE, borderRadius: Shape.full, alignItems: 'center', justifyContent: 'center' },
  choice: {
    // Four to a row: a little under a quarter each, and they grow to fill it.
    width: '23%',
    flexGrow: 1,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.xs,
    paddingVertical: Spacing.md,
  },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
});

/**
 * Material Design 3 building blocks, sized and coloured per the M3 spec and driven by the
 * device's Material You scheme. Only colour roles in their intended pairs are used.
 *
 * docs/DESIGN.md says where each one belongs. In short: every pressable thing is a `Tappable`
 * (or a `Button`, `IconButton`, `Chip`, `GroupRow` or `ExtendedFab`, which are built on it), every
 * list is a `Group` of `GroupRow`s, and an exclusive choice is `SegmentedButtons`.
 */
import type MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { SymbolView, type AndroidSymbol } from 'expo-symbols';
import { Children, createContext, isValidElement, useContext, useEffect, useState, type ComponentProps, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import Animated, {
  Easing,
  interpolateColor,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  type AnimatedStyle,
} from 'react-native-reanimated';

import { Alpha, AVATAR_SIZE, EmphasizedWeight, Shape, Spacing, Springs, TOUCH_TARGET, Type, withAlpha, type TypeRole } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { cleanNumberText, parseNumberText } from './screen-text';

/** Icon names used across the app; each maps to a Google Material Symbol below. */
export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** App icon names → Material Symbols (the icon set Google's own apps use). */
const SYMBOLS: Partial<Record<IconName, AndroidSymbol>> = {
  'chart-bar-stacked': 'data_thresholding',
  'lock-outline': 'lock',
  'alert-circle-outline': 'error',
  'auto-fix': 'auto_awesome',
  'bell-outline': 'notifications',
  'calculator-variant-outline': 'calculate',
  'calendar-blank-outline': 'calendar_today',
  'calendar-check-outline': 'event_available',
  'calendar-month-outline': 'calendar_month',
  check: 'check',
  'chevron-down': 'expand_more',
  'chevron-up': 'expand_less',
  'chevron-right': 'chevron_right',
  close: 'close',
  'cog-outline': 'settings',
  'content-copy': 'content_copy',
  'cookie-outline': 'cookie',
  egg: 'egg',
  'egg-outline': 'egg_alt',
  'bread-slice-outline': 'bakery_dining',
  'water-outline': 'water_drop',
  fire: 'local_fire_department',
  'flag-variant-outline': 'flag',
  'food-apple-outline': 'nutrition',
  'heart-pulse': 'ecg_heart',
  'information-outline': 'info',
  'key-outline': 'key',
  'link-variant': 'link',
  microphone: 'mic',
  'microphone-outline': 'mic',
  numeric: 'numbers',
  'pencil-outline': 'edit',
  plus: 'add',
  send: 'send',
  'delete-sweep-outline': 'delete_sweep',
  refresh: 'refresh',
  'shoe-print': 'directions_walk',
  'silverware-fork-knife': 'restaurant',
  star: 'star',
  'star-outline': 'star',
  stop: 'stop',
  'trash-can-outline': 'delete',
  'tune-variant': 'tune',
  'weather-night': 'bedtime',
  'weather-sunset-up': 'wb_twilight',
  'white-balance-sunny': 'sunny',
  'widgets-outline': 'widgets',
  history: 'history',
  walk: 'directions_walk',
  run: 'directions_run',
  'run-fast': 'sprint',
  bike: 'directions_bike',
  dumbbell: 'fitness_center',
  yoga: 'self_improvement',
  swim: 'pool',
  soccer: 'sports_soccer',
  'lightning-bolt': 'bolt',
  minus: 'remove',
  'calendar-today': 'today',
  coffee: 'coffee',
  rice: 'rice_bowl',
  'bowl-mix-outline': 'ramen_dining',
  // Progress, weight and backup
  'scale-bathroom': 'monitor_weight',
  'trending-down': 'trending_down',
  'trending-up': 'trending_up',
  'trending-neutral': 'trending_flat',
  'arrow-down': 'arrow_downward',
  'arrow-up': 'arrow_upward',
  'chart-line': 'show_chart',
  'chart-bar': 'bar_chart',
  'chart-timeline-variant': 'insights',
  'calendar-check': 'event_available',
  'calendar-range': 'date_range',
  'flag-checkered': 'sports_score',
  target: 'target',
  'lightbulb-on-outline': 'lightbulb',
  'timer-outline': 'timer',
  'medal-outline': 'military_tech',
  'check-circle-outline': 'check_circle',
  'export-variant': 'ios_share',
  'file-upload-outline': 'upload_file',
  'backup-restore': 'settings_backup_restore',
  'database-outline': 'database',
  'food-outline': 'restaurant',
  finance: 'monitoring',
  'calendar-week': 'calendar_view_week',
  'bell-off-outline': 'notifications_off',
  'chevron-double-down': 'keyboard_double_arrow_down',
  undo: 'undo',
  // Spare names for rows and headers
  'arrow-right': 'arrow_forward',
  'arrow-left': 'arrow_back',
  'chevron-left': 'chevron_left',
  'clock-outline': 'schedule',
  'account-outline': 'person',
  'human-male-height': 'height',
  'cake-variant-outline': 'cake',
  'robot-outline': 'smart_toy',
  'content-save-outline': 'save',
  'open-in-new': 'open_in_new',
};

export function Icon({ name, size = 24, color }: { name: IconName; size?: number; color?: string }) {
  const { colors } = useTheme();
  const symbol = SYMBOLS[name] ?? 'circle';
  return <SymbolView name={{ android: symbol, web: symbol }} size={size} tintColor={color ?? colors.onSurfaceVariant} />;
}

// ---------------------------------------------------------------- text

export function AppText({
  variant = 'bodyLarge',
  color,
  emphasized,
  tabular,
  style,
  ...rest
}: TextProps & {
  variant?: TypeRole;
  color?: string;
  emphasized?: boolean;
  /** Digits of equal width, for a figure that sits in a column or changes in place. */
  tabular?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        Type[variant],
        emphasized ? { fontWeight: EmphasizedWeight[variant] } : null,
        tabular ? styles.tabular : null,
        { color: color ?? colors.onSurface },
        style,
      ]}
    />
  );
}

// ---------------------------------------------------------------- screen and section headers

/** Google-app style screen title: regular weight, modest size, optional supporting line. Older screens; new ones use ScreenHeader. */
export function TopBar({ title, subtitle, trailing }: { title: string; subtitle?: string; trailing?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.topBar}>
      <View style={{ flex: 1 }}>
        <AppText variant="headlineSmall" accessibilityRole="header">
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {trailing}
    </View>
  );
}

/**
 * The header of a tab screen: a quiet supporting line (the date, the period) above the title in
 * `headlineMedium` emphasised, and one optional thing at the right (a badge, an icon button),
 * centred on the two lines. No avatar in front: the title is the landmark.
 */
export function ScreenHeader({
  title,
  supporting,
  trailing,
  style,
}: {
  title: string;
  /** Shown above the title. */
  supporting?: string;
  trailing?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.screenHeader, style]}>
      <View style={styles.fill}>
        {supporting ? (
          <AppText variant="bodyLarge" color={colors.onSurfaceVariant}>
            {supporting}
          </AppText>
        ) : null}
        <AppText variant="headlineMedium" emphasized accessibilityRole="header">
          {title}
        </AppText>
      </View>
      {trailing}
    </View>
  );
}

/**
 * The label of a section: `titleMedium` emphasised, with an optional hint at the right that says
 * what the section adds up to or is built on ("1,160 kcal", "24 weigh-ins"). It sits 24dp below
 * the section before it and 8dp above its own content (the 8dp is built in).
 */
export function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <AppText variant="titleMedium" emphasized accessibilityRole="header" numberOfLines={2} style={styles.fill}>
        {title}
      </AppText>
      {hint ? (
        <AppText variant="bodyMedium" tabular color={colors.onSurfaceVariant} style={styles.sectionHint}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- cards

type CardVariant = 'filled' | 'elevated' | 'outlined' | 'primary' | 'error';

export function Card({
  children,
  variant = 'filled',
  style,
}: {
  children: ReactNode;
  variant?: CardVariant;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const look: Record<CardVariant, ViewStyle> = {
    filled: { backgroundColor: colors.surfaceContainerHighest },
    elevated: { backgroundColor: colors.surfaceContainerLow, elevation: 1 },
    outlined: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.outlineVariant },
    primary: { backgroundColor: colors.primaryContainer },
    error: { backgroundColor: colors.errorContainer },
  };
  return <View style={[styles.card, look[variant], style]}>{children}</View>;
}

// ---------------------------------------------------------------- pressing

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type TappableProps = Omit<PressableProps, 'style' | 'children' | 'android_ripple'> & {
  /**
   * How far the surface shrinks while pressed. 0.97 unless said otherwise; 0.98 for full-width
   * rows and cards, 0.95 for round icon buttons and the FAB.
   */
  scale?: number;
  /** The ripple: the surface's content colour at `Alpha.pressed`. Left out, `onSurface`. */
  rippleColor?: string;
  /** Must carry the `borderRadius`: the ripple is clipped to it. Animated styles are welcome. */
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  children?: ReactNode;
};

/**
 * The one pressable surface in the app. It answers a press at once by shrinking a little
 * (`Springs.fast`, no overshoot) and lets go with `Springs.spatial`, on top of the Android ripple,
 * which it clips to its own corners. Everything else passes through to `Pressable`. It is a
 * button to a screen reader unless `accessibilityRole` says otherwise.
 *
 * Text fields and switches are not Tappables; everything else that can be pressed is.
 */
export function Tappable({ scale = 0.97, rippleColor, style, onPressIn, onPressOut, children, ...rest }: TappableProps) {
  const { colors } = useTheme();
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: 1 - (1 - scale) * pressed.get() }] }));
  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      onPressIn={(e) => {
        pressed.set(withSpring(1, Springs.fast));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        pressed.set(withSpring(0, Springs.spatial));
        onPressOut?.(e);
      }}
      android_ripple={{ color: rippleColor ?? withAlpha(colors.onSurface, Alpha.pressed) }}
      style={[styles.tappable, style, animated]}>
      {children}
    </AnimatedPressable>
  );
}

// ---------------------------------------------------------------- buttons

type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'elevated' | 'error';

/**
 * A pill button. `filled` (primary) is for the one main action of a screen or sheet, `tonal`
 * (secondary container) for a quiet second action, `text` for the least important, `error` for
 * delete. `size="large"` is the 56dp button that ends a sheet; make it full width.
 */
export function Button({
  title,
  onPress,
  variant = 'filled',
  size = 'small',
  icon,
  disabled,
  loading,
  style,
  accessibilityLabel,
  hitSlop,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** small = 40dp with a `labelLarge` label; large = 56dp with a `titleMedium` label. `medium` is the old name for large. */
  size?: 'small' | 'medium' | 'large';
  icon?: IconName;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  /** Extra touch area around the button (dp). 4 takes a small button to the 48dp minimum target. */
  hitSlop?: number;
}) {
  const { colors } = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string; elevation?: number }> = {
    filled: { bg: colors.primary, fg: colors.onPrimary },
    tonal: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
    outlined: { bg: 'transparent', fg: colors.primary, border: colors.outline },
    text: { bg: 'transparent', fg: colors.primary },
    elevated: { bg: colors.surfaceContainerLow, fg: colors.primary, elevation: 1 },
    error: { bg: colors.errorContainer, fg: colors.onErrorContainer },
  };
  const p = palette[variant];
  const inactive = !!(disabled || loading);
  const large = size !== 'small';
  const fg = inactive ? withAlpha(colors.onSurface, Alpha.disabledContent) : p.fg;
  const bg = inactive && p.bg !== 'transparent' ? withAlpha(colors.onSurface, Alpha.disabledContainer) : p.bg;
  const iconSize = large ? 24 : 18;
  return (
    <Tappable
      onPress={onPress}
      disabled={inactive}
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      hitSlop={hitSlop}
      rippleColor={withAlpha(p.fg, Alpha.pressed)}
      style={[
        styles.button,
        {
          minHeight: large ? 56 : 40,
          paddingLeft: large ? Spacing.xl : variant === 'text' ? Spacing.md : icon || loading ? Spacing.lg : Spacing.xl,
          paddingRight: large ? Spacing.xl : variant === 'text' ? (icon ? Spacing.lg : Spacing.md) : Spacing.xl,
          backgroundColor: bg,
          borderWidth: p.border ? 1 : 0,
          borderColor: inactive ? withAlpha(colors.onSurface, Alpha.disabledContainer) : p.border,
          elevation: inactive ? 0 : (p.elevation ?? 0),
        },
        style,
      ]}>
      {loading ? <ActivityIndicator size={iconSize} color={fg} /> : icon ? <Icon name={icon} size={iconSize} color={fg} /> : null}
      <AppText variant={large ? 'titleMedium' : 'labelLarge'} emphasized={variant === 'filled'} color={fg} numberOfLines={1} style={styles.shrink}>
        {title}
      </AppText>
    </Tappable>
  );
}

type IconButtonVariant = 'standard' | 'filled' | 'tonal' | 'outlined';

/** A round 40dp icon button with a 48dp touch target. `tonal` is the quiet filled one (close, add, steppers). */
export function IconButton({
  icon,
  onPress,
  label,
  variant = 'standard',
  color,
  disabled,
  onLongPress,
  onPressOut,
  delayLongPress,
}: {
  icon: IconName;
  onPress: () => void;
  label: string;
  variant?: IconButtonVariant;
  color?: string;
  disabled?: boolean;
  /**
   * For a button that repeats while held (a stepper): called once the press has lasted
   * `delayLongPress` ms (500 by default). `onPress` is then not called when the finger lifts.
   */
  onLongPress?: () => void;
  /** Called when the finger lifts or slides off, after a tap as well as after a hold. */
  onPressOut?: () => void;
  delayLongPress?: number;
}) {
  const { colors } = useTheme();
  const look: Record<IconButtonVariant, { bg: string; fg: string; border?: string }> = {
    standard: { bg: 'transparent', fg: colors.onSurfaceVariant },
    filled: { bg: colors.primary, fg: colors.onPrimary },
    tonal: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
    outlined: { bg: 'transparent', fg: colors.onSurfaceVariant, border: colors.outlineVariant },
  };
  const l = look[variant];
  const fg = disabled ? withAlpha(colors.onSurface, Alpha.disabledContent) : (color ?? l.fg);
  return (
    <Tappable
      scale={0.95}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressOut={onPressOut}
      delayLongPress={delayLongPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={(TOUCH_TARGET - 40) / 2}
      rippleColor={withAlpha(fg, Alpha.pressed)}
      style={[styles.iconButton, { backgroundColor: l.bg, borderWidth: l.border ? 1 : 0, borderColor: l.border }]}>
      <Icon name={icon} size={24} color={fg} />
    </Tappable>
  );
}

/**
 * The extended FAB: the main action of a tab screen. 56dp tall, an icon and a label, `primary`,
 * 16dp corners (the one squarish shape among the pills) and the only shadow in the app. Place it
 * with `style` (absolute, bottom right, 16dp from the edges) inside the screen's root view, and
 * give the scroll content `FAB_CLEARANCE` of bottom padding.
 */
export function ExtendedFab({
  icon,
  label,
  onPress,
  accessibilityLabel,
  style,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <Tappable
      scale={0.95}
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? label}
      rippleColor={withAlpha(colors.onPrimary, Alpha.pressed)}
      style={[styles.fab, { backgroundColor: colors.primary }, style]}>
      <Icon name={icon} size={24} color={colors.onPrimary} />
      <AppText variant="titleMedium" emphasized color={colors.onPrimary} numberOfLines={1}>
        {label}
      </AppText>
    </Tappable>
  );
}

/** The fill and content colour of a selected choice: `primary`, or `tertiary` on screens about movement. */
export type SelectionTone = 'primary' | 'tertiary';

function useSelection(tone: SelectionTone): { fill: string; on: string } {
  const { colors } = useTheme();
  return tone === 'tertiary' ? { fill: colors.tertiary, on: colors.onTertiary } : { fill: colors.primary, on: colors.onPrimary };
}

// ---------------------------------------------------------------- chips

type ChipKind = 'assist' | 'filter' | 'suggestion' | 'tonal';

/**
 * A 32dp pill (48dp touch target). `filter` is one of several choices: selected, it takes the
 * selection fill and an emphasised label; unselected, like `assist` and `suggestion`, it is a quiet
 * `surfaceContainerHigh` fill. Nothing is outline-only. `tonal` is a 40dp secondary-container pill
 * for a quick action, with optional secondary text after the label.
 */
export function Chip({
  label,
  onPress,
  kind = 'assist',
  selected,
  icon,
  trailing,
  tone = 'primary',
}: {
  label: string;
  onPress: () => void;
  kind?: ChipKind;
  selected?: boolean;
  icon?: IconName;
  /** Secondary text after the label, e.g. "5 kcal". */
  trailing?: string;
  /** The selection fill of a selected filter chip. */
  tone?: SelectionTone;
}) {
  const { colors } = useTheme();
  const selection = useSelection(tone);
  if (kind === 'tonal') {
    const fg = colors.onSecondaryContainer;
    return (
      <Tappable
        scale={0.96}
        onPress={onPress}
        accessibilityLabel={trailing ? `${label}, ${trailing}` : label}
        hitSlop={{ top: 4, bottom: 4 }}
        rippleColor={withAlpha(fg, Alpha.pressed)}
        style={[styles.chip, styles.tonalChip, { paddingLeft: icon ? Spacing.md : Spacing.lg, backgroundColor: colors.secondaryContainer }]}>
        {icon ? <Icon name={icon} size={18} color={fg} /> : null}
        <AppText variant="labelLarge" emphasized color={fg} numberOfLines={1}>
          {label}
        </AppText>
        {trailing ? (
          <AppText variant="labelLarge" color={withAlpha(fg, 0.72)} numberOfLines={1}>
            {trailing}
          </AppText>
        ) : null}
      </Tappable>
    );
  }
  const isSelected = kind === 'filter' && !!selected;
  const fg = isSelected ? selection.on : kind === 'assist' ? colors.onSurface : colors.onSurfaceVariant;
  return (
    <Tappable
      scale={0.96}
      onPress={onPress}
      accessibilityRole={kind === 'filter' ? 'checkbox' : 'button'}
      accessibilityState={kind === 'filter' ? { checked: isSelected } : undefined}
      hitSlop={{ top: 8, bottom: 8 }}
      rippleColor={withAlpha(fg, Alpha.pressed)}
      style={[styles.chip, { paddingLeft: icon ? Spacing.md : Spacing.lg, backgroundColor: isSelected ? selection.fill : colors.surfaceContainerHigh }]}>
      {icon ? <Icon name={icon} size={18} color={isSelected ? selection.on : colors.primary} /> : null}
      <AppText variant="labelLarge" emphasized={isSelected} color={fg} numberOfLines={1}>
        {label}
      </AppText>
    </Tappable>
  );
}

// ---------------------------------------------------------------- connected button group

/** A corner radius no segment is ever taller than twice of, so it reads as fully round. */
const SEGMENT_ROUND = Shape.extraLargeIncreased;

/**
 * Material's connected button group, for an exclusive choice (a period, an intensity). Equal-width
 * segments at least 48dp tall with 2dp gaps; the ends of the group are fully round and the corners
 * between segments are 4dp. The selected segment becomes fully round and takes the selection fill
 * with an emphasised label: its corners spring while the fill cross-fades. Use `tone="tertiary"`
 * on screens about movement. Up to four short labels; more choices are a row of `Chip`s.
 */
export function SegmentedButtons<T extends string>({
  value,
  onChange,
  options,
  tone = 'primary',
  accessibilityLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: IconName }[];
  tone?: SelectionTone;
  /** What is being chosen, for a screen reader ("Period"). */
  accessibilityLabel?: string;
}) {
  return (
    <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={accessibilityLabel}>
      {options.map((o, i) => (
        <Segment
          key={o.value}
          label={o.label}
          icon={o.icon}
          selected={o.value === value}
          first={i === 0}
          last={i === options.length - 1}
          tone={tone}
          onPress={() => onChange(o.value)}
        />
      ))}
    </View>
  );
}

function Segment({
  label,
  icon,
  selected,
  first,
  last,
  tone,
  onPress,
}: {
  label: string;
  icon?: IconName;
  selected: boolean;
  first: boolean;
  last: boolean;
  tone: SelectionTone;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const selection = useSelection(tone);
  // Two values, because the shape may overshoot a little as it settles and a fill must not.
  const shape = useSharedValue(selected ? 1 : 0);
  const fill = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    shape.set(withSpring(selected ? 1 : 0, Springs.spatial));
    fill.set(withTiming(selected ? 1 : 0, { duration: 150, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System }));
  }, [selected, shape, fill]);
  const rest = colors.surfaceContainerHigh;
  const surface = useAnimatedStyle(() => {
    const inner = Shape.extraSmall + (SEGMENT_ROUND - Shape.extraSmall) * Math.max(0, shape.get());
    return {
      // The fill is the surface's own colour, so the ripple still shows on a selected segment.
      backgroundColor: interpolateColor(fill.get(), [0, 1], [rest, selection.fill]),
      borderTopLeftRadius: first ? SEGMENT_ROUND : inner,
      borderBottomLeftRadius: first ? SEGMENT_ROUND : inner,
      borderTopRightRadius: last ? SEGMENT_ROUND : inner,
      borderBottomRightRadius: last ? SEGMENT_ROUND : inner,
    };
  });
  const fg = selected ? selection.on : colors.onSurfaceVariant;
  return (
    <Tappable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      rippleColor={withAlpha(fg, Alpha.pressed)}
      style={[styles.segment, surface]}>
      {icon ? <Icon name={icon} size={20} color={fg} /> : null}
      <AppText variant="labelLarge" emphasized={selected} color={fg} numberOfLines={1} style={styles.shrink}>
        {label}
      </AppText>
    </Tappable>
  );
}

// ---------------------------------------------------------------- progress

/** M3 linear progress indicator: 4dp, rounded, with a gap and stop indicator. */
export function ProgressBar({
  value,
  color,
  trackColor,
  height = 4,
}: {
  value: number;
  color?: string;
  trackColor?: string;
  height?: number;
}) {
  const { colors } = useTheme();
  const v = Math.max(0, Math.min(1, value));
  const indicator = color ?? colors.primary;
  const track = trackColor ?? colors.secondaryContainer;
  return (
    <View
      style={{ height, flexDirection: 'row', alignItems: 'center', gap: v > 0 && v < 1 ? 4 : 0 }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(v * 100) }}>
      {v > 0 ? <View style={{ flex: v, height, borderRadius: height / 2, backgroundColor: indicator }} /> : null}
      {v < 1 ? (
        <View style={{ flex: 1 - v, height, borderRadius: height / 2, backgroundColor: track, alignItems: 'flex-end', justifyContent: 'center' }}>
          <View style={{ width: height, height, borderRadius: height / 2, backgroundColor: indicator }} />
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- text fields (M3 filled)

export function TextField({
  label,
  supportingText,
  style,
  multiline,
  ...props
}: TextInputProps & { label?: string; supportingText?: string }) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: Spacing.xs, flexShrink: 1 }}>
      <View
        style={[
          styles.field,
          {
            minHeight: multiline ? 112 : 56,
            backgroundColor: colors.surfaceContainerHighest,
            borderBottomWidth: focused ? 2 : 1,
            borderBottomColor: focused ? colors.primary : colors.onSurfaceVariant,
          },
        ]}>
        {label ? (
          <AppText variant="bodySmall" color={focused ? colors.primary : colors.onSurfaceVariant} numberOfLines={1}>
            {label}
          </AppText>
        ) : null}
        <TextInput
          placeholderTextColor={withAlpha(colors.onSurfaceVariant, 0.55)}
          selectionColor={withAlpha(colors.primary, 0.4)}
          cursorColor={colors.primary}
          accessibilityLabel={label}
          multiline={multiline}
          {...props}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          style={[
            Type.bodyLarge,
            { color: colors.onSurface, padding: 0, flexGrow: 1 },
            multiline ? { textAlignVertical: 'top' } : null,
            style,
          ]}
        />
      </View>
      {supportingText ? (
        <AppText variant="bodySmall" color={colors.onSurfaceVariant} style={{ paddingHorizontal: Spacing.lg }}>
          {supportingText}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * The text of a number input and the number it stands for, kept in step both ways. Typing reports
 * a number (0 while the text is empty or not a number yet). A number set from outside, by a
 * stepper or by recalculated targets, replaces the text unless it is what the text already says.
 * `NumberField` is built on it; a screen that draws its own input (the weight sheet's large
 * number) uses it directly, so there is one way of reading a typed number.
 */
export function useNumberText({
  value,
  onChange,
  format,
  maxDecimals,
}: {
  value: number;
  onChange: (n: number) => void;
  /** How a number set from outside is written. */
  format: (n: number) => string;
  /** Digits kept after the decimal point while typing. Left out, any number of them. */
  maxDecimals?: number;
}): { text: string; onChangeText: (typed: string) => void; tidy: () => void } {
  const [text, setText] = useState(() => format(value));
  const [lastValue, setLastValue] = useState(value);
  if (value !== lastValue) {
    // The value changed from outside (e.g. targets recalculated): show it, unless it's what the user is typing.
    setLastValue(value);
    if (parseNumberText(text) !== value) setText(format(value));
  }
  return {
    text,
    onChangeText: (typed) => {
      const cleaned = cleanNumberText(typed, maxDecimals);
      setText(cleaned);
      onChange(parseNumberText(cleaned));
    },
    /** Write the number out in full again once typing is over ("80" becomes "80.0"). */
    tidy: () => setText(format(value)),
  };
}

/** Numeric filled text field that lets the user type freely ("12.") and reports a number. */
export function NumberField({
  label,
  value,
  onChange,
  suffix,
  style,
  decimals = 0,
  maxDecimals,
  selectOnFocus,
  onBlur,
}: {
  label?: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  style?: StyleProp<ViewStyle>;
  /** Decimal places a value set from outside is shown with. */
  decimals?: number;
  /** Decimal places that can be typed. Left out, any number of them. */
  maxDecimals?: number;
  /** Select the whole number when the field is tapped, so typing replaces it. */
  selectOnFocus?: boolean;
  onBlur?: () => void;
}) {
  const { text, onChangeText } = useNumberText({
    value,
    onChange,
    maxDecimals,
    format: (n) => (n === 0 ? '' : String(decimals ? Math.round(n * 10 ** decimals) / 10 ** decimals : Math.round(n))),
  });
  return (
    <View style={[{ flex: 1, minWidth: 72 }, style]}>
      <TextField
        label={suffix && label ? `${label} (${suffix})` : label}
        value={text}
        keyboardType="decimal-pad"
        placeholder="0"
        selectTextOnFocus={selectOnFocus}
        onBlur={onBlur}
        onChangeText={onChangeText}
      />
    </View>
  );
}

// ---------------------------------------------------------------- switch (M3)

export function Switch({
  value,
  onValueChange,
  accessibilityLabel,
  disabled,
}: {
  value: boolean;
  onValueChange: (v: boolean) => void;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const thumb = value ? 24 : 16;
  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      hitSlop={8}
      style={[
        styles.switchTrack,
        {
          opacity: disabled ? Alpha.disabledContent : 1,
          backgroundColor: value ? colors.primary : colors.surfaceContainerHighest,
          borderColor: value ? colors.primary : colors.outline,
          justifyContent: value ? 'flex-end' : 'flex-start',
        },
      ]}>
      <View
        style={{
          width: thumb,
          height: thumb,
          borderRadius: thumb / 2,
          marginHorizontal: value ? 2 : 6,
          backgroundColor: value ? colors.onPrimary : colors.outline,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {value ? <Icon name="check" size={16} color={colors.onPrimaryContainer} /> : null}
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------- avatars

/**
 * primary, secondary, tertiary and error use that container colour with its on-container icon;
 * neutral is `surfaceContainerHighest`; ring has no fill, a 1dp `outlineVariant` ring and an
 * `onSurfaceVariant` icon, and means "not yet".
 */
export type AvatarTone = 'primary' | 'secondary' | 'tertiary' | 'error' | 'neutral' | 'ring';

/**
 * A round icon avatar, 40dp unless `size` says otherwise: the leading mark of a list row or a
 * tile. The tone says the subject (primary for food and weight, tertiary for movement, secondary
 * for a logged meal) and whether there is anything yet (`ring` when there is not).
 *
 * On a tile that is itself lit in a container colour, pass that tile's on-container colour as
 * `tint`: the avatar becomes a soft tint of it, so it shows on any container.
 */
export function Avatar({
  icon,
  tone = 'neutral',
  tint,
  size = AVATAR_SIZE,
  children,
}: {
  icon?: IconName;
  tone?: AvatarTone;
  /** The on-container colour of the lit tile the avatar sits on. Overrides `tone`. */
  tint?: string;
  size?: number;
  /** Shown instead of an icon, e.g. a number. */
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const looks: Record<AvatarTone, { bg: string; fg: string }> = {
    primary: { bg: colors.primaryContainer, fg: colors.onPrimaryContainer },
    secondary: { bg: colors.secondaryContainer, fg: colors.onSecondaryContainer },
    tertiary: { bg: colors.tertiaryContainer, fg: colors.onTertiaryContainer },
    error: { bg: colors.errorContainer, fg: colors.onErrorContainer },
    neutral: { bg: colors.surfaceContainerHighest, fg: colors.onSurfaceVariant },
    ring: { bg: 'transparent', fg: colors.onSurfaceVariant },
  };
  const look = tint ? { bg: withAlpha(tint, Alpha.track), fg: tint } : looks[tone];
  const ring = !tint && tone === 'ring';
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, backgroundColor: look.bg, borderWidth: ring ? 1 : 0, borderColor: colors.outlineVariant },
      ]}>
      {icon ? <Icon name={icon} size={Math.round(size * 0.6)} color={look.fg} /> : null}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- segmented groups (lists)

export type GroupPosition = 'only' | 'first' | 'middle' | 'last';

/** The four corner radii of one row of a segmented group, ready to spread into a style. */
export interface GroupCorners {
  borderTopLeftRadius: number;
  borderTopRightRadius: number;
  borderBottomLeftRadius: number;
  borderBottomRightRadius: number;
}

function cornersAt(position: GroupPosition): GroupCorners {
  const top = position === 'only' || position === 'first' ? Shape.largeIncreased : Shape.extraSmall;
  const bottom = position === 'only' || position === 'last' ? Shape.largeIncreased : Shape.extraSmall;
  return { borderTopLeftRadius: top, borderTopRightRadius: top, borderBottomLeftRadius: bottom, borderBottomRightRadius: bottom };
}

/**
 * The corners of row `index` in a group of `count` rows: 20dp where the group ends, 4dp between
 * rows. For rows that cannot be children of a `Group`, such as the items of a FlatList; give those
 * rows a `Spacing.xxs` gap and the `surfaceContainerHigh` fill yourself, or wrap each in a `GroupItem`
 * with `corners`.
 */
export function groupCorners(index: number, count: number): GroupCorners {
  return cornersAt(count <= 1 ? 'only' : index <= 0 ? 'first' : index >= count - 1 ? 'last' : 'middle');
}

const GroupContext = createContext<GroupPosition>('only');

/** For a custom row inside a `Group`: the corners its position gives it (those of a single row outside one). */
export function useGroupCorners(): GroupCorners {
  return cornersAt(useContext(GroupContext));
}

/**
 * A segmented group: the list everywhere in the app. Rows that belong together are stacked with
 * 2dp gaps; the group's outer corners are 20dp and every corner between rows is 4dp. Each row is
 * its own filled surface, so the gaps show the page ground. No dividers, no card around it.
 *
 * Children are `GroupRow`s, `GroupItem`s or custom rows that call `useGroupCorners()`. Each direct
 * child is one row, so leave a row out with `cond ? <GroupRow/> : null`, not with a component that
 * renders nothing, and do not wrap rows in a fragment.
 */
export function Group({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const rows = Children.toArray(children);
  return (
    <View style={[styles.group, style]}>
      {rows.map((row, i) => (
        <GroupContext.Provider
          key={isValidElement(row) && row.key != null ? row.key : i}
          value={rows.length === 1 ? 'only' : i === 0 ? 'first' : i === rows.length - 1 ? 'last' : 'middle'}>
          {row}
        </GroupContext.Provider>
      ))}
    </View>
  );
}

/**
 * The bare surface of one row of a group, for a row with its own layout: the fill, the corners its
 * position gives it, and the press behaviour when `onPress` is given. `GroupRow` is this plus the
 * standard row layout.
 */
export function GroupItem({
  children,
  onPress,
  onLongPress,
  color,
  corners,
  style,
  accessibilityLabel,
  accessibilityHint,
  accessibilityRole,
  accessibilityState,
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  /** The fill. Left out, `surfaceContainerHigh`. */
  color?: string;
  /** From `groupCorners()`, for a row outside a `Group`. Left out, the row's position in its `Group`. */
  corners?: GroupCorners;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityRole?: PressableProps['accessibilityRole'];
  accessibilityState?: PressableProps['accessibilityState'];
}) {
  const { colors } = useTheme();
  const own = useGroupCorners();
  const surface = [corners ?? own, { backgroundColor: color ?? colors.surfaceContainerHigh }, style];
  if (!onPress) return <View style={[styles.groupItem, surface]}>{children}</View>;
  return (
    <Tappable
      scale={0.98}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityRole={accessibilityRole ?? 'button'}
      accessibilityState={accessibilityState}
      style={surface}>
      {children}
    </Tappable>
  );
}

/**
 * One row of a `Group`: an optional round avatar, a headline (`titleMedium`, up to two lines), an
 * optional supporting line (`bodyMedium`, `onSurfaceVariant`) and one thing at the right: a string
 * (drawn in `labelLarge`) or any node, such as a figure, a `Switch` or an icon. With `onPress` the
 * whole row is the button and shrinks a little when pressed. 56dp tall at least, 72dp with a
 * supporting line. It replaces `ListItem`.
 */
export function GroupRow({
  icon,
  tone = 'neutral',
  leading,
  headline,
  supporting,
  supportingLines,
  trailing,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  corners,
  style,
}: {
  /** The icon of a leading `Avatar` in `tone`. */
  icon?: IconName;
  tone?: AvatarTone;
  /** Anything else in the leading slot, instead of the icon avatar. */
  leading?: ReactNode;
  headline: string;
  supporting?: string;
  /** Cut the supporting text off after this many lines. Left out, it wraps as far as it needs, balanced. */
  supportingLines?: number;
  /** A string, or a node such as a figure, a switch or a cue icon. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  /** From `groupCorners()`, for a row outside a `Group`. */
  corners?: GroupCorners;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  return (
    <GroupItem
      onPress={onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      corners={corners}
      style={[styles.groupRow, { minHeight: supporting ? 72 : 56 }, style]}>
      {leading ?? (icon ? <Avatar icon={icon} tone={tone} /> : null)}
      <View style={styles.rowText}>
        <AppText variant="titleMedium" numberOfLines={2}>
          {headline}
        </AppText>
        {supporting ? (
          <AppText variant="bodyMedium" color={colors.onSurfaceVariant} numberOfLines={supportingLines} textBreakStrategy="balanced">
            {supporting}
          </AppText>
        ) : null}
      </View>
      {typeof trailing === 'string' ? (
        <AppText variant="labelLarge" tabular color={colors.onSurfaceVariant}>
          {trailing}
        </AppText>
      ) : (
        trailing
      )}
    </GroupItem>
  );
}

// ---------------------------------------------------------------- older list pieces

/** The old list row, for screens not yet moved to `Group` and `GroupRow`. */
export function ListItem({
  headline,
  supporting,
  leadingIcon,
  trailing,
  onPress,
  accessibilityLabel,
}: {
  headline: string;
  supporting?: string;
  leadingIcon?: IconName;
  /** Trailing supporting text, or a control such as a switch. */
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const content = (
    <>
      {leadingIcon ? <Icon name={leadingIcon} size={24} color={colors.onSurfaceVariant} /> : null}
      <View style={{ flex: 1 }}>
        {/* Two lines for the headline and as many as it takes underneath: the row grows, so a large
            font size wraps the words instead of cutting them off. The supporting lines are balanced,
            so the last one is never a single word. */}
        <AppText variant="bodyLarge" numberOfLines={2}>
          {headline}
        </AppText>
        {supporting ? (
          <AppText variant="bodyMedium" color={colors.onSurfaceVariant} textBreakStrategy="balanced">
            {supporting}
          </AppText>
        ) : null}
      </View>
      {typeof trailing === 'string' ? (
        <AppText variant="labelLarge" color={colors.onSurfaceVariant}>
          {trailing}
        </AppText>
      ) : (
        trailing
      )}
    </>
  );
  const style = [styles.listItem, { minHeight: supporting ? 72 : 56 }];
  if (!onPress) return <View style={style}>{content}</View>;
  return (
    <Tappable scale={0.98} onPress={onPress} accessibilityLabel={accessibilityLabel} style={style}>
      {content}
    </Tappable>
  );
}

export function Divider({ inset = false }: { inset?: boolean }) {
  const { colors } = useTheme();
  return <View style={{ height: 1, backgroundColor: colors.outlineVariant, marginLeft: inset ? Spacing.lg : 0 }} />;
}

/** Quiet section label for older screens; new ones use SectionHeader. */
export function Subheader({ children, action }: { children: string; action?: ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.subheader}>
      <AppText variant="titleSmall" color={colors.onSurfaceVariant} accessibilityRole="header">
        {children}
      </AppText>
      {action}
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.row, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  shrink: { flexShrink: 1 },
  topBar: { flexDirection: 'row', alignItems: 'flex-end', paddingTop: Spacing.xl, paddingBottom: Spacing.sm, gap: Spacing.sm },
  screenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.lg,
    paddingHorizontal: Spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  sectionHint: { flexShrink: 1, textAlign: 'right' },
  card: { borderRadius: Shape.medium, padding: Spacing.lg, gap: Spacing.md, overflow: 'hidden' },
  tappable: { overflow: 'hidden' },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    borderRadius: Shape.full,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: Shape.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xl,
    borderRadius: Shape.large,
    elevation: 3,
  },
  chip: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
    borderRadius: Shape.full,
  },
  tonalChip: { minHeight: 40 },
  segmented: { flexDirection: 'row', gap: Spacing.xxs },
  segment: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  field: {
    borderTopLeftRadius: Shape.extraSmall,
    borderTopRightRadius: Shape.extraSmall,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    justifyContent: 'center',
  },
  switchTrack: { width: 52, height: 32, borderRadius: Shape.full, borderWidth: 2, flexDirection: 'row', alignItems: 'center' },
  avatar: { borderRadius: Shape.full, alignItems: 'center', justifyContent: 'center' },
  group: { gap: Spacing.xxs },
  groupItem: { overflow: 'hidden' },
  groupRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  rowText: { flex: 1, minWidth: 0 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, paddingHorizontal: Spacing.lg, paddingVertical: Spacing.sm },
  subheader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.xs, minHeight: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  tabular: { fontVariant: ['tabular-nums'] },
});

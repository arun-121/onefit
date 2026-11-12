/**
 * Material 3 Expressive pieces: the calorie ring with its wavy arc, shape-library avatars, a
 * thick bar and a small ring for figures measured against a target, a connected button group, and
 * press-to-morph surfaces driven by springs.
 * Shared values use .get()/.set() so they stay compatible with the React Compiler.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { Alpha, Shape, Spacing, Springs, withAlpha } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AppText, Icon, type IconName } from './ui';

// The presets live with the other tokens; re-exported so older imports keep working.
export { Springs };

// ---------------------------------------------------------------- shape library

/**
 * A subset of the M3 Expressive shape library as smooth polar curves:
 * radius = R · (1 + amplitude · cos(lobes · θ)).
 */
export type ShapeName = 'circle' | 'cookie9' | 'cookie12' | 'sunny' | 'clover4' | 'flower' | 'burst';

const SHAPES: Record<ShapeName, { lobes: number; amplitude: number }> = {
  circle: { lobes: 0, amplitude: 0 },
  cookie9: { lobes: 9, amplitude: 0.055 },
  cookie12: { lobes: 12, amplitude: 0.04 },
  sunny: { lobes: 8, amplitude: 0.085 },
  clover4: { lobes: 4, amplitude: 0.16 },
  flower: { lobes: 6, amplitude: 0.13 },
  burst: { lobes: 10, amplitude: 0.075 },
};

export function shapePath(shape: ShapeName, size: number, steps = 180): string {
  const { lobes, amplitude } = SHAPES[shape];
  const c = size / 2;
  const R = c / (1 + amplitude);
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const r = R * (1 + amplitude * Math.cos(lobes * t));
    const x = c + r * Math.cos(t - Math.PI / 2);
    const y = c + r * Math.sin(t - Math.PI / 2);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d}Z`;
}

/** A shape-library avatar with an icon in the middle. `spin` slowly rotates the shape. */
export function ShapeAvatar({
  shape,
  size = 48,
  color,
  icon,
  iconColor,
  iconSize,
  children,
  spin = false,
}: {
  shape: ShapeName;
  size?: number;
  color: string;
  icon?: IconName;
  iconColor?: string;
  iconSize?: number;
  children?: ReactNode;
  spin?: boolean;
}) {
  const d = useMemo(() => shapePath(shape, size), [shape, size]);
  const rotation = useSharedValue(0);
  useEffect(() => {
    rotation.set(
      spin
        ? withRepeat(withTiming(360, { duration: 8000, easing: Easing.linear, reduceMotion: ReduceMotion.System }), -1)
        : withSpring(0, Springs.spatial),
    );
  }, [spin, rotation]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.get()}deg` }] }));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={[StyleSheet.absoluteFill, spinStyle]}>
        <Svg width={size} height={size}>
          <Path d={d} fill={color} />
        </Svg>
      </Animated.View>
      {icon ? <Icon name={icon} size={iconSize ?? Math.round(size * 0.46)} color={iconColor} /> : null}
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- values that spring

const lastShown = new Map<string, number>();

/**
 * A shared value that springs to `target` whenever it changes (`Springs.value`: no overshoot,
 * because a measure must never show more than it holds, even for a moment).
 *
 * With `memory`, it starts from what was last shown under that name in this app run, and from 0
 * the first time. A screen that is opened twenty times a day then never replays its entrance: the
 * ring draws once from zero when the app starts, and after that only moves when the figure does.
 * Without `memory` it starts on the target and only moves when the target changes.
 */
export function useValueSpring(target: number, memory?: string): SharedValue<number> {
  const value = useSharedValue(memory ? (lastShown.get(memory) ?? 0) : target);
  useEffect(() => {
    value.set(withSpring(target, Springs.value));
    if (memory) lastShown.set(memory, target);
  }, [target, memory, value]);
  return value;
}

// ---------------------------------------------------------------- the calorie ring

const AnimatedPath = Animated.createAnimatedComponent(Path);

/**
 * An arc of a circle as a path, from angle `from` to `to` (radians, clockwise from 12 o'clock),
 * and its length. With an `amplitude`, the radius ripples `waves` times round the full circle,
 * which is Material's wavy progress track bent into a ring.
 */
function arcPath(c: number, r: number, from: number, to: number, amplitude = 0, waves = 0): { d: string; length: number } {
  if (!(to > from)) return { d: '', length: 0 };
  const steps = Math.max(2, Math.ceil(((to - from) * 180) / Math.PI / (amplitude ? 1 : 3)));
  let d = '';
  let length = 0;
  let px = 0;
  let py = 0;
  for (let i = 0; i <= steps; i++) {
    const t = from + ((to - from) * i) / steps;
    // cos, so the wave is the same either side of 12 o'clock and a full ring closes on itself.
    const rho = r + amplitude * Math.cos(waves * t);
    const x = c + rho * Math.sin(t);
    const y = c - rho * Math.cos(t);
    if (i > 0) length += Math.hypot(x - px, y - py);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    px = x;
    py = y;
  }
  return { d, length };
}

/**
 * The dash offset that hides the first `skipped` of a path of `length` drawn with the dash pattern
 * [length, length]. It is the same as an offset of minus `skipped`, written as its positive twin
 * one whole pattern on, so no renderer is ever handed a negative dash phase.
 */
function skipStart(length: number, skipped: number): number {
  'worklet';
  return skipped <= 0 ? 0 : 2 * length - Math.min(length, skipped);
}

/**
 * Where the eaten arc ends, as a distance round the ring from 12 o'clock, for a share `v` of the
 * budget eaten. `h` is half the room one gap between two segments takes; `c` is the circumference.
 * Anything eaten at all shows at least a dot.
 */
function eatenHead(v: number, c: number, h: number): number {
  'worklet';
  if (v <= 0) return 0;
  const span = c - 2 * h;
  const share = Math.min(1, Math.max(0.5 / span, (Math.min(v, 1) * c - 2 * h) / span));
  return h + share * span;
}

/**
 * The day's calorie budget as a ring: the hero of Today. The whole ring is the budget (the goal
 * plus calories burned), read clockwise from 12 o'clock:
 *
 *  - what has been eaten is a wavy arc in `primary`;
 *  - what is left of the goal is a flat track;
 *  - the part of the budget that exercise added is a flat stretch in `tertiary` at the end;
 *  - over budget, the ring stays `primary` and the overshoot is a flat `error` arc from the top,
 *    at most one lap. The tile around it does not change colour.
 *
 * Segments have round ends and a gap between them. The arc springs from the share it showed last
 * to the new one (`memory`), so it draws from zero once per app run and never replays after that.
 * Whatever goes in the middle (the number) is passed as children.
 */
export function BudgetRing({
  eaten,
  goal,
  burned = 0,
  size = 196,
  stroke = 12,
  trackColor,
  memory = 'budget-ring',
  children,
}: {
  eaten: number;
  goal: number;
  burned?: number;
  /** Outer diameter (dp). */
  size?: number;
  stroke?: number;
  /** The unfilled part. Left out, `onPrimaryContainer` at `Alpha.track`, for a ring on a `primaryContainer` tile. */
  trackColor?: string;
  /**
   * The name the last shown value is kept under (see `useValueSpring`). Pass `null` for a ring that
   * is drawn in place without an entrance, such as the ring of a past day.
   */
  memory?: string | null;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const safe = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const eatenKcal = safe(eaten);
  const burnedKcal = safe(burned);
  const budget = Math.max(1, safe(goal) + burnedKcal);

  // The wave, tuned by eye at 196dp: under a quarter of the stroke either side of the circle and
  // nearly four strokes long, which is twelve waves round the ring. Shorter waves read as a rough
  // edge, taller ones as a cog; this one is the calm scallop of Material's wavy progress.
  const amplitude = stroke * 0.225;
  const c = size / 2;
  const r = c - stroke / 2 - amplitude;
  const circumference = 2 * Math.PI * r;
  const waves = Math.max(6, Math.round(circumference / (stroke * 3.85)));
  // Round caps reach stroke/2 past each end of a segment, so this leaves a visible gap of a third of the stroke.
  const h = (stroke + stroke / 3) / 2;
  const hasBurned = burnedKcal > 0;
  // Where the goal ends and the exercise stretch begins. The stretch is never too short to draw.
  const goalAt = hasBurned ? Math.min((safe(goal) / budget) * circumference, circumference - 2 * h - 1) : circumference;
  const trackSpan = Math.max(0, (hasBurned ? goalAt - h : circumference - h) - h);
  const burnedSpan = hasBurned ? circumference - goalAt - 2 * h : 0;

  const full = useMemo(() => {
    const from = h / r;
    const to = (circumference - h) / r;
    return { eaten: arcPath(c, r, from, to, amplitude, waves), over: arcPath(c, r, from, to) };
  }, [c, r, h, circumference, amplitude, waves]);
  const rest = useMemo(
    () => ({
      track: arcPath(c, r, h / r, (h + trackSpan) / r),
      burned: burnedSpan > 0 ? arcPath(c, r, (goalAt + h) / r, (circumference - h) / r) : null,
    }),
    [c, r, h, circumference, goalAt, trackSpan, burnedSpan],
  );
  const eatenLength = full.eaten.length;
  const overLength = full.over.length;
  const trackLength = rest.track.length;
  const burnedLength = rest.burned?.length ?? 0;

  // One value drives every segment: the share of the budget eaten, up to two laps.
  const share = useValueSpring(Math.min(2, eatenKcal / budget), memory ?? undefined);
  const span = circumference - 2 * h;

  const eatenProps = useAnimatedProps(() => {
    const v = share.get();
    const lap = Math.min(1, Math.max(0, v - 1));
    if (lap > 0) {
      // Over budget: the arc starts after the overshoot instead of at the top.
      const start = (lap * span + 2 * h) / span;
      return { strokeDashoffset: skipStart(eatenLength, eatenLength * start), strokeOpacity: start >= 1 ? 0 : 1 };
    }
    const shown = (eatenHead(v, circumference, h) - h) / span;
    return { strokeDashoffset: eatenLength * (1 - Math.max(0, shown)), strokeOpacity: Math.min(1, Math.max(0, (v * circumference) / 2)) };
  });
  const trackProps = useAnimatedProps(() => {
    const v = share.get();
    const skipped = v <= 0 ? 0 : eatenHead(v, circumference, h) + h;
    const hidden = trackSpan <= 0 || skipped >= trackSpan - 0.5;
    return { strokeDashoffset: hidden ? 0 : skipStart(trackLength, trackLength * (skipped / trackSpan)), strokeOpacity: hidden ? 0 : 1 };
  });
  const burnedProps = useAnimatedProps(() => {
    const v = share.get();
    const skipped = v <= 0 ? 0 : Math.max(0, eatenHead(v, circumference, h) + 2 * h - (goalAt + h));
    const hidden = burnedSpan <= 0 || skipped >= burnedSpan - 0.5;
    return { strokeDashoffset: hidden ? 0 : skipStart(burnedLength, burnedLength * (skipped / burnedSpan)), strokeOpacity: hidden ? 0 : 1 };
  });
  const overProps = useAnimatedProps(() => {
    const lap = Math.min(1, Math.max(0, share.get() - 1));
    return { strokeDashoffset: overLength * (1 - Math.max(0.5 / span, lap)), strokeOpacity: Math.min(1, (lap * span) / 2) };
  });

  const left = Math.round(budget - eatenKcal);
  const arc = { strokeWidth: stroke, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${Math.round(eatenKcal)} eaten, ${Math.round(burnedKcal)} burned, ${Math.abs(left)} ${left < 0 ? 'over' : 'left'}`}
        accessibilityValue={{ min: 0, max: Math.round(budget), now: Math.round(Math.min(eatenKcal, budget)) }}>
        <Svg width={size} height={size}>
          {trackLength > 0 ? (
            <AnimatedPath
              d={rest.track.d}
              stroke={trackColor ?? withAlpha(colors.onPrimaryContainer, Alpha.track)}
              strokeDasharray={[trackLength, trackLength]}
              animatedProps={trackProps}
              {...arc}
            />
          ) : null}
          {rest.burned && burnedLength > 0 ? (
            <AnimatedPath d={rest.burned.d} stroke={colors.tertiary} strokeDasharray={[burnedLength, burnedLength]} animatedProps={burnedProps} {...arc} />
          ) : null}
          <AnimatedPath d={full.eaten.d} stroke={colors.primary} strokeDasharray={[eatenLength, eatenLength]} animatedProps={eatenProps} {...arc} />
          <AnimatedPath d={full.over.d} stroke={colors.error} strokeDasharray={[overLength, overLength]} animatedProps={overProps} {...arc} />
        </Svg>
      </View>
      {/* The room inside the ring, so a long number shrinks to fit instead of touching the arc. */}
      <View style={{ width: size - 2 * (stroke + 2 * amplitude) - Spacing.xl, alignItems: 'center' }}>{children}</View>
    </View>
  );
}

// ---------------------------------------------------------------- bars and small rings

/**
 * A thick, fully round bar for a figure measured against its target (a macro against its goal).
 * `value` is the share from 0 to 1. It springs to a new value, and with `memory` starts from the
 * one it showed last (see `useValueSpring`). Anything above zero shows at least a dot.
 */
export function MeterBar({
  value,
  color,
  trackColor,
  height = 8,
  memory,
}: {
  value: number;
  color: string;
  /** The on-container colour of the tile at `Alpha.track`. */
  trackColor: string;
  height?: number;
  memory?: string;
}) {
  const [width, setWidth] = useState(0);
  const share = useValueSpring(Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0, memory);
  // The bar is as wide as the track and slides in from the left, so only a transform is animated
  // and its leading end stays round.
  const slide = useAnimatedStyle(() => {
    const v = share.get();
    const shown = v > 0 ? Math.max(height, v * width) : 0;
    return { transform: [{ translateX: shown - width }] };
  });
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, borderRadius: height / 2, backgroundColor: trackColor, overflow: 'hidden' }}>
      {width > 0 ? <Animated.View style={[{ width, height, borderRadius: height / 2, backgroundColor: color }, slide]} /> : null}
    </View>
  );
}

/** A small determinate ring, e.g. around a category icon. */
export function MiniRing({
  progress,
  size = 32,
  stroke = 3,
  color,
  trackColor,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color: string;
  trackColor: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, progress));
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={trackColor} strokeWidth={stroke} fill="none" />
        {v > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={[c * v, c]}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

// ---------------------------------------------------------------- press morph

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** A pressable surface whose corners spring toward another radius while pressed (M3 Expressive shape morph). */
export function MorphPressable({
  onPress,
  radius,
  pressedRadius,
  style,
  children,
  accessibilityLabel,
  rippleColor,
  disabled,
}: {
  onPress: () => void;
  radius: number;
  pressedRadius: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  accessibilityLabel?: string;
  rippleColor?: string;
  disabled?: boolean;
}) {
  const pressed = useSharedValue(0);
  const animated = useAnimatedStyle(() => ({ borderRadius: radius + (pressedRadius - radius) * pressed.get() }));
  return (
    <AnimatedPressable
      onPress={onPress}
      disabled={disabled}
      onPressIn={() => pressed.set(withSpring(1, Springs.fast))}
      onPressOut={() => pressed.set(withSpring(0, Springs.spatial))}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      android_ripple={rippleColor ? { color: rippleColor } : undefined}
      style={[{ overflow: 'hidden' }, style, animated]}>
      {children}
    </AnimatedPressable>
  );
}

// ---------------------------------------------------------------- connected button group

export interface GroupButton {
  label: string;
  icon: IconName;
  onPress: () => void;
  /** The hero action is filled; the rest are tonal. */
  variant?: 'filled' | 'tonal';
}

/** M3 Expressive connected button group: 2dp gaps, small inner corners, full outer corners. */
export function ButtonGroup({ items, height = 64 }: { items: GroupButton[]; height?: number }) {
  const { colors } = useTheme();
  const full = height / 2;
  const inner = Shape.small;
  return (
    <View style={styles.group}>
      {items.map((item, i) => {
        const first = i === 0;
        const last = i === items.length - 1;
        const filled = item.variant === 'filled';
        const bg = filled ? colors.primary : colors.secondaryContainer;
        const fg = filled ? colors.onPrimary : colors.onSecondaryContainer;
        return (
          <MorphPressable
            key={item.label}
            onPress={item.onPress}
            radius={inner}
            pressedRadius={full}
            rippleColor={withAlpha(fg, Alpha.pressed)}
            accessibilityLabel={item.label}
            style={[
              styles.groupItem,
              {
                height,
                flex: filled ? 1.25 : 1,
                backgroundColor: bg,
                borderTopLeftRadius: first ? full : undefined,
                borderBottomLeftRadius: first ? full : undefined,
                borderTopRightRadius: last ? full : undefined,
                borderBottomRightRadius: last ? full : undefined,
              },
            ]}>
            <Icon name={item.icon} size={24} color={fg} />
            <AppText variant="titleMedium" emphasized color={fg} numberOfLines={1}>
              {item.label}
            </AppText>
          </MorphPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row', gap: 2 },
  groupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
});

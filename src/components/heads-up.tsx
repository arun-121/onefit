import { StyleSheet, View } from 'react-native';

import { BarRows, DayDots, Disclosure, GlanceFigure, RangeBar, toneColors } from '@/components/glance';
import { AppText, Avatar, Button, IconButton, type IconName } from '@/components/ui';
import { Shape, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Nudge, NudgeKind, NudgePicture, NudgeVisual } from '@/lib/nudges';
import { formatKcal } from '@/lib/nutrition';

const LOOK: Record<NudgeKind, { icon: IconName; tone: 'primary' | 'secondary' | 'tertiary' }> = {
  unusual: { icon: 'chart-line', tone: 'primary' },
  tip: { icon: 'lightbulb-on-outline', tone: 'secondary' },
  win: { icon: 'medal-outline', tone: 'tertiary' },
};

/**
 * What the app noticed, on Today: one quiet card per nudge, shown rather than told. Each has its
 * kind's avatar, a heading of a few words and a dismiss that is remembered, then the one picture
 * that fits what was noticed (a row of days, a day against the usual, a set with what it gained,
 * a rate against the goal's pace, a weigh-in against the ones before), at most one short line, the
 * step it suggests, and the whole message one tap away under "How it's worked out" as the last row. The cards stay on the unlit surface, so the calories ring stays the hero.
 */
export function HeadsUp({ nudges, onAction, onDismiss }: { nudges: readonly Nudge[]; onAction: (n: Nudge) => void; onDismiss: (n: Nudge) => void }) {
  return (
    <View style={styles.list}>
      {nudges.map((n) => (
        <NudgeCard key={n.id} nudge={n} onAction={() => onAction(n)} onDismiss={() => onDismiss(n)} />
      ))}
    </View>
  );
}

function NudgeCard({ nudge: n, onAction, onDismiss }: { nudge: Nudge; onAction: () => void; onDismiss: () => void }) {
  const { colors, dark } = useTheme();
  // A nudge without a visual (one from an older rule) is shown as its title and body, as before.
  const v: NudgeVisual = n.visual ?? { heading: n.title, line: n.body };
  // A win takes the colour of what was won, as its picture does: a lift is movement (tertiary), a
  // logging streak food (primary), a protein streak protein's own. Tertiary on a logging streak
  // would put movement's colour on food. The other kinds keep their kind's quiet tone.
  const won = n.kind === 'win' ? (v.figure?.tone ?? v.picture?.tone) : undefined;
  const avatarTint = won === 'protein' ? toneColors('protein', colors, dark).color : undefined;
  const avatarTone = won && won !== 'protein' ? won : LOOK[n.kind].tone;
  // The whole message, for a screen reader: the heading alone would drop the sentence it replaced.
  const spoken = `${n.title}. ${n.body}`;
  // The disclosure only when the body says more than the line already does.
  const more = n.body !== v.line;
  return (
    <View style={[styles.card, { backgroundColor: colors.surfaceContainerHigh }]}>
      <View style={styles.head}>
        <Avatar icon={LOOK[n.kind].icon} tone={avatarTone} tint={avatarTint} size={36} />
        <AppText variant="titleMedium" emphasized numberOfLines={2} style={styles.fill} accessibilityLabel={n.title}>
          {v.heading}
        </AppText>
        <View style={styles.dismiss}>
          <IconButton icon="close" label={`Dismiss: ${n.title}`} onPress={onDismiss} />
        </View>
      </View>

      {v.figure ? (
        <GlanceFigure
          value={v.figure.value}
          unit={v.figure.unit}
          delta={
            v.figure.change
              ? {
                  direction: v.figure.change.direction,
                  amount: v.figure.change.amount,
                  towardGoal: v.figure.change.towardGoal,
                  tone: v.figure.tone === 'tertiary' ? 'tertiary' : 'primary',
                  accessibilityLabel: v.figure.change.spoken,
                }
              : undefined
          }
          // With no picture to carry it, the figure says the whole message.
          accessibilityLabel={v.picture ? undefined : spoken}
        />
      ) : null}

      {v.picture ? <NudgePictureView picture={v.picture} spoken={spoken} /> : null}

      {v.line ? (
        <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
          {v.line}
        </AppText>
      ) : null}

      {/* The step comes straight after what it is for, on the content's left edge; the whole message stays the card's last row, as on every card. */}
      {n.action ? <Button title={n.action.label} variant="tonal" onPress={onAction} hitSlop={4} style={styles.action} /> : null}

      {/* Named as on every other card (check-in, Progress), so the owner learns one foot, not two. */}
      {more ? <Disclosure>{n.body}</Disclosure> : null}
    </View>
  );
}

/** The one picture of a nudge, from the glance kit, speaking the whole message. */
function NudgePictureView({ picture: p, spoken }: { picture: NudgePicture; spoken: string }) {
  switch (p.kind) {
    case 'days': {
      // A short run of days is kept to a width where its dots still read as a row, not as scattered marks.
      const narrow = p.days.length <= 5;
      return (
        <View style={narrow ? { width: p.days.length * DAY_COLUMN } : null}>
          <DayDots days={p.days.map((d) => d.mark)} labels={p.days.length <= 10 ? p.days.map((d) => d.label) : undefined} tone={p.tone} accessibilityLabel={spoken} />
        </View>
      );
    }
    case 'compare': {
      const top = Math.max(p.day.kcal, p.usualKcal, 1);
      return (
        <View accessible accessibilityRole="image" accessibilityLabel={spoken}>
          <View importantForAccessibility="no-hide-descendants">
            <BarRows
              tone={p.tone}
              items={[
                { name: p.day.name, figure: `${formatKcal(p.day.kcal)} kcal`, share: p.day.kcal / top },
                { name: 'Your usual', figure: `${formatKcal(p.usualKcal)} kcal`, share: p.usualKcal / top },
              ]}
            />
          </View>
        </View>
      );
    }
    case 'pace': {
      const values = [0, p.kgPerWeek, p.goalKgPerWeek];
      const lo = Math.min(...values);
      const hi = Math.max(...values);
      const pad = Math.max(0.1, (hi - lo) * 0.2);
      return (
        <RangeBar
          min={lo - pad}
          max={hi + pad}
          tone={p.tone}
          marks={[
            // Zero, so the side of it each mark is on (losing or gaining) is seen, not read off a sign.
            { value: 0, label: 'Steady', kind: 'tick' },
            { value: p.goalKgPerWeek, label: 'Goal', figure: signedKg(p.goalKgPerWeek), kind: 'tick' },
            { value: p.kgPerWeek, label: 'You', figure: signedKg(p.kgPerWeek), kind: 'dot' },
          ]}
          accessibilityLabel={spoken}
        />
      );
    }
    case 'reading': {
      const lo = Math.min(p.lowKg, p.kg);
      const hi = Math.max(p.highKg, p.kg);
      const pad = Math.max(0.3, (hi - lo) * 0.2);
      const usual = p.lowKg === p.highKg ? `${p.lowKg.toFixed(1)} kg` : `${p.lowKg.toFixed(1)}–${p.highKg.toFixed(1)} kg`;
      return (
        <RangeBar
          min={lo - pad}
          max={hi + pad}
          low={p.lowKg}
          high={p.highKg}
          tone={p.tone}
          bandLabel={{ label: 'Your usual', figure: usual }}
          marks={[{ value: p.kg, label: p.label, kind: 'dot' }]}
          accessibilityLabel={spoken}
        />
      );
    }
  }
}

/** The width each day of a short run takes: a dot and the room for "Wed" under it. */
const DAY_COLUMN = 56;
/** "+0.42 kg a week", "\u22120.5 kg a week": a rate's sign matters when it runs the wrong way. */
const signedKg = (kg: number): string => `${kg < 0 ? '\u2212' : '+'}${Number(Math.abs(kg).toFixed(2))}\u00A0kg a week`;

const styles = StyleSheet.create({
  list: { gap: Spacing.sm },
  card: { borderRadius: Shape.largeIncreased, padding: Spacing.lg, gap: Spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  fill: { flex: 1, minWidth: 0 },
  // The close button's 40dp circle reaches into the card's padding, so its icon lines up with the content's edge.
  dismiss: { marginVertical: -Spacing.sm, marginRight: -Spacing.sm },
  action: { alignSelf: 'flex-start' },
});

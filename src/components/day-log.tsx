import { StyleSheet, View } from 'react-native';

import { AVATAR_SIZE, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatKcal, sumMacros } from '@/lib/nutrition';
import { MEAL_LABELS, MEALS, type Entry, type Meal } from '@/lib/types';
import { MEAL_ICONS } from './today-tiles';
import { AppText, Avatar, Button, Group, GroupItem, GroupRow, IconButton } from './ui';

/**
 * A day's food, meal by meal, for the day view. Each meal is one segmented group: a header row
 * with the meal's avatar (lit once something is logged, a ring until then), its total and an add
 * button, then one row per item, which opens the item to edit.
 */
export function DayLog({
  entries,
  copyableMeals,
  onAdd,
  onCopy,
  onPressEntry,
}: {
  entries: Entry[];
  /** Meals that had entries the day before, offered as "Same as yesterday". */
  copyableMeals: Set<Meal>;
  onAdd: (meal: Meal) => void;
  onCopy: (meal: Meal) => void;
  onPressEntry: (entry: Entry) => void;
}) {
  return (
    <View style={styles.meals}>
      {MEALS.map((meal) => (
        <MealSection
          key={meal}
          meal={meal}
          entries={entries.filter((e) => e.meal === meal)}
          canCopy={copyableMeals.has(meal)}
          onAdd={() => onAdd(meal)}
          onCopy={() => onCopy(meal)}
          onPressEntry={onPressEntry}
        />
      ))}
    </View>
  );
}

function MealSection({
  meal,
  entries,
  canCopy,
  onAdd,
  onCopy,
  onPressEntry,
}: {
  meal: Meal;
  entries: Entry[];
  canCopy: boolean;
  onAdd: () => void;
  onCopy: () => void;
  onPressEntry: (entry: Entry) => void;
}) {
  const { colors } = useTheme();
  const total = sumMacros(entries).calories;
  const hasEntries = entries.length > 0;

  return (
    <Group>
      <GroupItem style={styles.header}>
        <Avatar icon={MEAL_ICONS[meal]} tone={hasEntries ? 'secondary' : 'ring'} />
        <View style={styles.fill}>
          <AppText variant="titleMedium" emphasized>
            {MEAL_LABELS[meal]}
          </AppText>
          {hasEntries ? (
            <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
              {`${entries.length} item${entries.length > 1 ? 's' : ''}`}
            </AppText>
          ) : canCopy ? (
            // Pulled left by its own padding, so its icon lines up with the meal's name.
            <Button title="Same as yesterday" icon="content-copy" variant="text" hitSlop={4} onPress={onCopy} style={styles.copy} />
          ) : (
            <AppText variant="bodyMedium" color={colors.onSurfaceVariant}>
              Nothing logged yet
            </AppText>
          )}
        </View>
        {hasEntries ? (
          <AppText variant="titleMedium" emphasized tabular>
            {`${formatKcal(total)}\u00A0kcal`}
          </AppText>
        ) : null}
        <IconButton icon="plus" variant="tonal" label={`Add to ${MEAL_LABELS[meal]}`} onPress={onAdd} />
      </GroupItem>

      {entries.map((e) => (
        <GroupRow
          key={e.id}
          // Indented by an avatar's width, so an item's name sits under its meal's name.
          leading={<View style={styles.indent} />}
          headline={e.name}
          supporting={e.portion || undefined}
          supportingLines={1}
          trailing={`${formatKcal(e.calories)}\u00A0kcal`}
          onPress={() => onPressEntry(e)}
          accessibilityLabel={`${e.name}, ${e.portion}, ${Math.round(e.calories)} calories. Edit`}
        />
      ))}
    </Group>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  meals: { gap: Spacing.sm },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    minHeight: 72,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  copy: { alignSelf: 'flex-start', marginLeft: -Spacing.md },
  indent: { width: AVATAR_SIZE },
});

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { FoodFields, MealPicker } from '@/components/item-editor';
import { Sheet, SheetHeader } from '@/components/sheet-parts';
import { AppText, Button, Group, GroupItem, GroupRow, Icon } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useLiveQuery } from '@/hooks/use-live-query';
import { useTheme } from '@/hooks/use-theme';
import { formatDayLabel } from '@/lib/dates';
import { findFood, getEntry, notifyChanged, recordFoodUse, setFoodPinned } from '@/lib/db';
import { deleteEntries, editEntry } from '@/lib/logging';
import type { Entry, Meal } from '@/lib/types';

export default function EditEntryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { back } = useRouter();
  const entry = useLiveQuery(() => getEntry(Number(id)), [id]);

  if (!entry) {
    // Seen for a moment while the sheet closes after a delete, or when the food went from elsewhere.
    return (
      <Sheet>
        <SheetHeader title="Edit food" supporting="This entry was deleted." onClose={back} />
      </Sheet>
    );
  }
  return <EntryForm key={entry.id} entry={entry} />;
}

function EntryForm({ entry }: { entry: Entry }) {
  const router = useRouter();
  const { colors } = useTheme();
  const [draft, setDraft] = useState(entry);
  const [saving, setSaving] = useState(false);
  const saved = useLiveQuery(() => findFood(entry.name, entry.portion), [entry.name, entry.portion]);
  const pinned = !!saved?.pinned;

  const set = (patch: Partial<Entry>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    if (!draft.name.trim()) return;
    setSaving(true);
    const { name, portion, calories, protein, carbs, fat, meal } = draft;
    await editEntry(entry.id, { name: name.trim(), portion: portion.trim(), calories, protein, carbs, fat, meal });
    router.back();
  };

  const remove = () => {
    Alert.alert('Delete this food?', `${entry.name} will be removed from ${formatDayLabel(entry.date).toLowerCase()}.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteEntries([entry.id]);
          router.back();
        },
      },
    ]);
  };

  const togglePin = () => {
    const food = saved ?? (recordFoodUse(entry, Date.now(), false), findFood(entry.name, entry.portion));
    if (!food) return;
    setFoodPinned(food.id, !food.pinned);
    notifyChanged();
  };

  return (
    <Sheet>
      <SheetHeader title="Edit food" supporting={formatDayLabel(entry.date)} onDelete={remove} onClose={() => router.back()} />

      <MealPicker value={draft.meal} onChange={(meal: Meal) => set({ meal })} />

      <View style={styles.block}>
        <Group>
          <GroupItem style={styles.fields}>
            <FoodFields value={draft} onChange={set} />
          </GroupItem>
          {/* Lit while the food is a favourite, like a tile on Today; unlit, it says what a tap does. */}
          <GroupRow
            icon={pinned ? 'star' : 'star-outline'}
            tone={pinned ? 'primary' : 'ring'}
            headline={pinned ? 'In your favourites' : 'Add to favourites'}
            supporting={pinned ? 'Tap to take it off Today’s Log again row' : 'Log it again from Today in one tap'}
            trailing={
              <View importantForAccessibility="no-hide-descendants">
                <Icon name={pinned ? 'check' : 'plus'} size={24} color={pinned ? colors.primary : undefined} />
              </View>
            }
            onPress={togglePin}
            accessibilityLabel={pinned ? 'Remove favourite' : 'Add to favourites'}
          />
        </Group>
        <AppText variant="bodySmall" color={colors.onSurfaceVariant} textBreakStrategy="balanced" style={styles.helper}>
          Your corrections are remembered, so next time you log this food the AI uses your numbers.
        </AppText>
      </View>

      <Button title="Save changes" size="large" loading={saving} disabled={!draft.name.trim()} onPress={() => void save()} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.sm },
  fields: { padding: Spacing.lg },
  helper: { paddingHorizontal: Spacing.lg },
});

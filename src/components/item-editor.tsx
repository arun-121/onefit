/**
 * The pieces for editing food, shared by the Log food review list and the Edit food sheet: the
 * meal picker, the fields of one food, and one food as a row of a segmented group.
 */
import { useState, type ReactNode } from 'react';
import { StyleSheet, useWindowDimensions, View, type LayoutChangeEvent } from 'react-native';

import { Spacing } from '@/constants/theme';
import { MEAL_LABELS, MEALS, type DraftItem, type Meal } from '@/lib/types';
import { Note } from './sheet-parts';
import { GroupItem, IconButton, NumberField, SegmentedButtons, TextField } from './ui';

/** The width "Breakfast", the longest meal name, takes as the emphasised label of a segment (dp at font scale 1). */
const LONGEST_MEAL_LABEL = 64;
/** What a segment of a connected button group keeps around its label, either side (dp). */
const SEGMENT_PADDING = Spacing.md;
/** The width "Protein (g)", the longest label of a macro field, takes (dp at font scale 1). */
const LONGEST_MACRO_LABEL = 62;
/** What a text field keeps around its label, either side (dp). */
const FIELD_PADDING = Spacing.lg;

/**
 * The width a block really has, so it can choose a layout whose labels fit. Until the first
 * layout it is `guess`, which on these sheets is right, so nothing jumps when the measure arrives.
 */
function useMeasuredWidth(guess: number): [number, (e: LayoutChangeEvent) => void] {
  const [measured, setMeasured] = useState<number | null>(null);
  return [measured ?? guess, (e) => setMeasured(Math.round(e.nativeEvent.layout.width))];
}

/**
 * The meal a food belongs to, as a connected button group. Four segments fit one row on a Pixel 8
 * at the default font size; when the names would be cut short (a larger font, a narrower screen)
 * they become two rows of two instead, with nothing shortened.
 */
export function MealPicker({ value, onChange }: { value: Meal; onChange: (meal: Meal) => void }) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  // The picker spans the screen inside the 16dp gutters on every sheet that has one.
  const [width, onLayout] = useMeasuredWidth(windowWidth - 2 * Spacing.lg);
  const options = MEALS.map((m) => ({ value: m, label: MEAL_LABELS[m] }));
  // What each of four segments has left for its label, with 2dp between the segments.
  const room = (width - (options.length - 1) * Spacing.xxs) / options.length - 2 * SEGMENT_PADDING;
  const oneRow = LONGEST_MEAL_LABEL * fontScale <= room;
  return (
    <View onLayout={onLayout} style={styles.pickerRows}>
      {oneRow ? (
        <SegmentedButtons value={value} onChange={onChange} options={options} />
      ) : (
        <>
          <SegmentedButtons value={value} onChange={onChange} options={options.slice(0, 2)} />
          <SegmentedButtons value={value} onChange={onChange} options={options.slice(2)} />
        </>
      )}
    </View>
  );
}

/** What the food fields edit: the part a draft item and a logged entry have in common. */
export interface FoodValues {
  name: string;
  portion: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

/**
 * The fields of one food, in three rows: what it is, how much of it and its calories, then the
 * three macros. When three fields no longer fit a row with their labels whole (a large font size),
 * the amount takes a row of its own and the numbers pair up instead.
 */
export function FoodFields({
  value,
  onChange,
  trailing,
  namePlaceholder,
  portionPlaceholder,
}: {
  value: FoodValues;
  onChange: (patch: Partial<FoodValues>) => void;
  /** Sits at the end of the first row, beside the name: the button that removes the food. */
  trailing?: ReactNode;
  namePlaceholder?: string;
  portionPlaceholder?: string;
}) {
  const { width: windowWidth, fontScale } = useWindowDimensions();
  // The fields sit in a padded row of a group, inside the 16dp gutters.
  const [width, onLayout] = useMeasuredWidth(windowWidth - 4 * Spacing.lg);
  // Three macro fields share a row while each still shows its whole label.
  const roomy = LONGEST_MACRO_LABEL * fontScale <= (width - 2 * Spacing.sm) / 3 - 2 * FIELD_PADDING;
  const name = <TextField label="Food" value={value.name} onChangeText={(text) => onChange({ name: text })} placeholder={namePlaceholder} />;
  const portion = (
    <TextField label="Amount" value={value.portion} onChangeText={(text) => onChange({ portion: text })} placeholder={portionPlaceholder} />
  );
  const kcal = <NumberField label="kcal" value={value.calories} onChange={(calories) => onChange({ calories })} />;
  const protein = <NumberField label="Protein" suffix="g" decimals={1} value={value.protein} onChange={(n) => onChange({ protein: n })} />;
  const carbs = <NumberField label="Carbs" suffix="g" decimals={1} value={value.carbs} onChange={(n) => onChange({ carbs: n })} />;
  const fat = <NumberField label="Fat" suffix="g" decimals={1} value={value.fat} onChange={(n) => onChange({ fat: n })} />;
  return (
    <View style={styles.fields} onLayout={onLayout}>
      <View style={styles.row}>
        <View style={styles.fill}>{name}</View>
        {trailing}
      </View>
      {roomy ? (
        <>
          <View style={styles.row}>
            <View style={styles.fill}>{portion}</View>
            {kcal}
          </View>
          <View style={styles.row}>
            {protein}
            {carbs}
            {fat}
          </View>
        </>
      ) : (
        <>
          {portion}
          <View style={styles.row}>
            {kcal}
            {protein}
          </View>
          <View style={styles.row}>
            {carbs}
            {fat}
          </View>
        </>
      )}
    </View>
  );
}

/**
 * One food on the Log food review list, as a row of a segmented group: its fields, a button that
 * takes it off the list, and a note when the estimate was a rough guess.
 */
export function ItemEditor({
  item,
  onChange,
  onRemove,
}: {
  item: DraftItem;
  onChange: (next: DraftItem) => void;
  onRemove: () => void;
}) {
  return (
    <GroupItem style={styles.item}>
      <FoodFields
        value={item}
        onChange={(patch) => onChange({ ...item, ...patch })}
        namePlaceholder="e.g. Scrambled eggs"
        portionPlaceholder="e.g. 2 large"
        trailing={<IconButton icon="close" label={`Remove ${item.name || 'item'}`} onPress={onRemove} />}
      />
      {item.confidence === 'low' ? <Note icon="alert-circle-outline">Rough guess. Check the amount and calories.</Note> : null}
    </GroupItem>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minWidth: 0 },
  pickerRows: { gap: Spacing.xxs },
  fields: { gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  item: { gap: Spacing.md, padding: Spacing.lg },
});

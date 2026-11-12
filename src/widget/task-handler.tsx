/**
 * Runs in the background (Android headless JS) when a widget is added, resized,
 * periodically updated or tapped. Taps on favourites log the food without opening the app.
 */
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';

import { getFood } from '@/lib/db';
import { deleteEntries, logFavourite } from '@/lib/logging';
import { CLICK_LOG_FAVOURITE, CLICK_UNDO } from './CalorieWidgets';
import { renderWidget } from './refresh';
import { rememberWidgetLog, takeWidgetLog } from './widget-data';

async function handleClick(action: string | undefined, data: Record<string, unknown> | undefined) {
  if (action === CLICK_LOG_FAVOURITE) {
    const food = getFood(Number(data?.foodId));
    if (!food) return;
    const entries = await logFavourite(food);
    rememberWidgetLog(`Logged ${food.name}`, entries.map((e) => e.id));
  } else if (action === CLICK_UNDO) {
    const last = takeWidgetLog();
    const ids = Array.isArray(data?.entryIds) ? (data.entryIds as unknown[]).map(Number) : (last?.entryIds ?? []);
    await deleteEntries(ids);
  }
}

export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  const { widgetInfo, widgetAction, clickAction, clickActionData } = props;
  if (widgetAction === 'WIDGET_DELETED') return;
  try {
    if (widgetAction === 'WIDGET_CLICK') await handleClick(clickAction, clickActionData);
  } catch (e) {
    console.warn('Widget action failed', e);
  }
  props.renderWidget(renderWidget(widgetInfo.widgetName));
}

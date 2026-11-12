import { Platform } from 'react-native';
import { requestWidgetUpdate, type WidgetRepresentation } from 'react-native-android-widget';

import { getScheme } from '@/constants/theme';
import { CaloriesLeftWidget, QuickLogWidget, WIDGET_CALORIES_LEFT, WIDGET_QUICK_LOG } from './CalorieWidgets';
import { getWidgetData } from './widget-data';

/** Light and dark versions in the device's Material You colours; Android picks one to match the system theme. */
export function renderWidget(widgetName: string): WidgetRepresentation {
  const data = getWidgetData();
  const Widget = widgetName === WIDGET_CALORIES_LEFT ? CaloriesLeftWidget : QuickLogWidget;
  return {
    light: <Widget data={data} c={getScheme('light')} />,
    dark: <Widget data={data} c={getScheme('dark')} />,
  };
}

/** Redraw every widget on the home screen. Safe to call often; does nothing off Android. */
export async function refreshWidgets(): Promise<void> {
  if (Platform.OS !== 'android') return;
  for (const widgetName of [WIDGET_QUICK_LOG, WIDGET_CALORIES_LEFT]) {
    try {
      await requestWidgetUpdate({ widgetName, renderWidget: () => renderWidget(widgetName) });
    } catch (e) {
      console.warn(`Could not refresh widget ${widgetName}`, e);
    }
  }
}

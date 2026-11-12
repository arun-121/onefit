'use no memo'; // react-native-android-widget renders plain functions; the React Compiler's hooks break it.

/**
 * Home-screen widgets in Material 3 / Material You colours. Android widgets can't hold a
 * text box, so they offer:
 *  - one-tap logging of favourite foods (handled in the background, no app launch),
 *  - a shortcut that opens the app straight into text logging (and voice, when VOICE_LOGGING is on),
 *  - calories left for today.
 * Colours come from the device scheme as '#RRGGBBAA' hex, which RemoteViews accepts.
 */
import { FlexWidget, SvgWidget, TextWidget, type ColorProp, type HexColor } from 'react-native-android-widget';

import { VOICE_LOGGING } from '@/constants/features';
import type { ColorScheme } from '@/constants/theme';
import { formatKcal } from '@/lib/nutrition';
import type { WidgetData } from './widget-data';

export const WIDGET_QUICK_LOG = 'QuickLog';
export const WIDGET_CALORIES_LEFT = 'CaloriesLeft';

export const CLICK_LOG_FAVOURITE = 'LOG_FAVOURITE';
export const CLICK_UNDO = 'UNDO';

/** Android 12+ widget corner radius (system_app_widget_background_radius on Pixel). */
const WIDGET_RADIUS = 28;
const PADDING = 16;

const logUri = (mode: 'voice' | 'text') => `calorietracker://log?mode=${mode}&from=widget`;

const hex = (c: string) => c as HexColor;
const color = (c: string) => c as ColorProp;
/** SVG fill wants #RRGGBB; drop the alpha byte from '#RRGGBBAA'. */
const svgFill = (c: string) => (c.length === 9 ? c.slice(0, 7) : c);

/** Static wavy calorie ring (the app's "plate") as an SVG string for RemoteViews. */
function ringSvg(progress: number, size: number, stroke: number, color: string, track: string) {
  const c = size / 2;
  const amp = stroke * 0.17;
  const r = c - stroke / 2 - amp - 1;
  const waves = Math.max(6, Math.round((2 * Math.PI * r) / 16));
  const p = Math.max(0, Math.min(1, progress));
  const steps = Math.max(2, Math.round(240 * p));
  let d = '';
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2 * p;
    const rr = r + amp * Math.sin(waves * t);
    const x = c + rr * Math.cos(t - Math.PI / 2);
    const y = c + rr * Math.sin(t - Math.PI / 2);
    d += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  const arc = p > 0.004 ? `<path d="${d}" fill="none" stroke="${svgFill(color)}" stroke-width="${(stroke * 0.62).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><circle cx="${c}" cy="${c}" r="${r.toFixed(2)}" fill="none" stroke="${svgFill(track)}" stroke-width="${(stroke * 0.5).toFixed(2)}"/>${arc}</svg>`;
}

// Material Design icon paths (24x24, Apache 2.0).
const ICON_PATHS = {
  voice:
    'M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z',
  text: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  check: 'M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z',
} as const;

function icon(path: string, fill: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${svgFill(fill)}" d="${path}"/></svg>`;
}

function ActionButton({ mode, label, filled, c }: { mode: 'voice' | 'text'; label: string; filled: boolean; c: ColorScheme }) {
  const bg = filled ? c.primary : c.secondaryContainer;
  const fg = filled ? c.onPrimary : c.onSecondaryContainer;
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: logUri(mode) }}
      accessibilityLabel={mode === 'voice' ? 'Log by voice' : VOICE_LOGGING ? 'Log by typing' : 'Log food'}
      style={{
        flex: filled ? 5 : 4,
        height: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 22,
        backgroundColor: color(bg),
        flexGap: 6,
      }}>
      <SvgWidget svg={icon(ICON_PATHS[mode], fg)} style={{ width: 20, height: 20 }} />
      <TextWidget text={label} style={{ fontSize: 14, fontWeight: '700', color: hex(fg) }} />
    </FlexWidget>
  );
}

export function QuickLogWidget({ data, c }: { data: WidgetData; c: ColorScheme }) {
  const numberColor = data.over ? c.error : c.onSurface;
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: color(c.surfaceContainer),
        borderRadius: WIDGET_RADIUS,
        padding: PADDING,
      }}>
      <FlexWidget clickAction="OPEN_APP" style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', flexGap: 12 }}>
        <SvgWidget
          svg={ringSvg(data.progress, 48, 9, data.over ? c.error : c.primary, c.secondaryContainer)}
          style={{ width: 48, height: 48 }}
        />
        <FlexWidget style={{ flex: 1, flexDirection: 'column' }}>
          <TextWidget
            text={formatKcal(Math.abs(data.left))}
            style={{ fontSize: 28, color: hex(numberColor) }}
          />
          <TextWidget
            text={`${data.over ? 'kcal over' : 'kcal left'}, ${data.protein} of ${data.proteinGoal} g protein`}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 13, color: hex(c.onSurfaceVariant) }}
          />
        </FlexWidget>
      </FlexWidget>

      {data.banner ? (
        <FlexWidget
          style={{
            width: 'match_parent',
            height: 32,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderRadius: 8,
            backgroundColor: color(c.secondaryContainer),
            paddingHorizontal: 12,
          }}>
          <FlexWidget style={{ flexDirection: 'row', alignItems: 'center', flexGap: 6 }}>
            <SvgWidget svg={icon(ICON_PATHS.check, c.onSecondaryContainer)} style={{ width: 16, height: 16 }} />
            <TextWidget text={data.banner.text} maxLines={1} truncate="END" style={{ fontSize: 14, color: hex(c.onSecondaryContainer) }} />
          </FlexWidget>
          <TextWidget
            text="Undo"
            clickAction={CLICK_UNDO}
            clickActionData={{ entryIds: data.banner.entryIds }}
            style={{ fontSize: 14, fontWeight: '500', color: hex(c.primary) }}
          />
        </FlexWidget>
      ) : data.favourites.length > 0 ? (
        <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 8 }}>
          {data.favourites.map((f) => (
            <FlexWidget
              key={f.id}
              clickAction={CLICK_LOG_FAVOURITE}
              clickActionData={{ foodId: f.id }}
              accessibilityLabel={`Log ${f.label}`}
              style={{
                flex: 1,
                height: 32,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 8,
                borderWidth: 1,
                borderColor: color(c.outlineVariant),
                paddingHorizontal: 8,
                flexGap: 4,
              }}>
              <SvgWidget svg={icon(ICON_PATHS.add, c.primary)} style={{ width: 16, height: 16 }} />
              <TextWidget text={f.label} maxLines={1} truncate="END" style={{ fontSize: 13, fontWeight: '500', color: hex(c.onSurfaceVariant) }} />
            </FlexWidget>
          ))}
        </FlexWidget>
      ) : (
        <TextWidget
          text="Foods you log often will appear here for one-tap logging."
          maxLines={1}
          truncate="END"
          style={{ fontSize: 12, color: hex(c.onSurfaceVariant) }}
        />
      )}

      <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', flexGap: 8 }}>
        {VOICE_LOGGING ? <ActionButton mode="voice" label="Say it" filled c={c} /> : null}
        <ActionButton mode="text" label={VOICE_LOGGING ? 'Type it' : 'Log food'} filled={!VOICE_LOGGING} c={c} />
      </FlexWidget>
    </FlexWidget>
  );
}

export function CaloriesLeftWidget({ data, c }: { data: WidgetData; c: ColorScheme }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: color(c.surfaceContainer),
        borderRadius: WIDGET_RADIUS,
        paddingHorizontal: PADDING,
        paddingVertical: 8,
      }}>
      <FlexWidget style={{ flexDirection: 'column' }}>
        <TextWidget text={formatKcal(Math.abs(data.left))} style={{ fontSize: 24, color: hex(data.over ? c.error : c.onSurface) }} />
        <TextWidget text={data.over ? 'kcal over' : 'kcal left'} style={{ fontSize: 12, color: hex(c.onSurfaceVariant) }} />
      </FlexWidget>
      <FlexWidget
        clickAction="OPEN_URI"
        clickActionData={{ uri: logUri('text') }}
        accessibilityLabel="Log food"
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: color(c.primaryContainer),
        }}>
        <SvgWidget svg={icon(ICON_PATHS.add, c.onPrimaryContainer)} style={{ width: 24, height: 24 }} />
      </FlexWidget>
    </FlexWidget>
  );
}

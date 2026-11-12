# Calorie Tracker

A personal, Android-first app for keeping track of fitness goals. You log food, exercise and weight each day, and the Progress tab shows what it adds up to after a week, a month or three. You type what you ate and Groq's AI estimates the calories and macros, which you check before saving. Data stays on the phone in SQLite, and can be shared with Google Fit through Health Connect.

What the app is for, and how every figure is worked out, is in `docs/PRODUCT.md`.

## What's in it

- **Log food by typing**, sorted into breakfast, lunch, dinner and snacks. The AI estimate is editable before saving. (Voice logging is built but switched off in `src/constants/features.ts` until it has been tested on a phone. Photo logging was dropped: estimates from photos weren't accurate enough.)
- **Remembers your corrections.** Edit an item and the AI reuses your numbers for that food next time.
- **Favourites.** Foods you log often (or star) become one-tap chips on Today and on the widget.
- **Copy a meal** from yesterday.
- **Log exercise**: activity, minutes and intensity, with the calories burned estimated from your weight. A new workout starts from the last one you logged.
- **Weigh-ins**, one a day, from the Weight tile on Today. Weigh-ins from a smart scale or another app can be read through Health Connect.
- **Daily targets** for calories, protein, carbs and fat, with an optional calculator (Mifflin–St Jeor).
- **Reminders** as local notifications, with no server: one for each meal, and an optional daily weigh-in reminder. Each is skipped once that meal or weight is logged, and the meal ones have *Log now* and *Same as yesterday* buttons. After a week away from the app, a few come-back reminders follow over the next month. The app asks to allow notifications after the first food you log.
- **Health Connect.** Food, workouts and weigh-ins are written to Health Connect, so they show up in Google Fit. Steps and active calories show on Today, and active calories can optionally be added to your budget. Every permission is optional.
- **Home-screen widgets.** *Quick log* (4×2) shows a calorie ring, three one-tap favourites with Undo, and a Log food button. *Calories left* (2×1) shows the number and a + button.
- **Progress** over the last 7, 30 or 90 days: where your weight is heading, what you eat and burn on average, macros, exercise, consistency, patterns and top foods, with every past day one tap away. A figure appears only once there is enough data behind it; until then the app says what to log.
- **Backup and restore.** Settings → Your data exports everything (food, saved foods, workouts, weigh-ins and settings, never the Groq key) as one JSON file, and restores it on this or another phone.

## Design

Calm, Google first-party style (references: Google Home, Wallet, Photos), built on Material 3 / M3 Expressive:

- **Colour:** the Android system's Material You scheme is the only source. The app never generates a palette or imposes a brand colour; it follows your wallpaper/accent like Pixel apps (Google's static M3 baseline only where dynamic colour doesn't exist).
- **Type:** Roboto with the M3 type scale, regular weights, no oversized display text.
- **Icons:** Material Symbols (`expo-symbols`), including the navigation bar.
- **Layout:** one focal point per screen. Today's hero is a thermostat-style calories tile with a wavy line for the day's budget; macros are pastel category tiles on the system containers; lists are rounded tonal items; editing opens a native bottom sheet.
- **Motion:** springs only where something changed (ring fill, pressed buttons, new entries); reduced motion respected.

Tokens live in `src/constants/theme.ts`; components in `src/components/`. The design rules agents must follow are in `AGENTS.md`; `docs/DESIGN.md` turns them into this app's colour, type, shape and layout decisions.

## Install on your phone

The app uses native modules (Health Connect, widgets), so it can't run in Expo Go. You need a build. Pick one option.

**Option A: cloud build, no Android Studio needed (easiest)**

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest build -p android --profile preview
```

When it finishes, open the link on your phone, download the APK and install it. You'll need to allow installs from your browser. This needs a free Expo account.

**Option B: local build over USB**

Install Android Studio (it includes the JDK and Android SDK) and turn on USB debugging on the phone. Then:

```bash
npm install
npx expo run:android
```

## First run

1. **Settings → Groq AI**: paste a free key from <https://console.groq.com/keys>, then tap **Test**. For local builds you can instead put it in `.env.local` (see `.env.example`).
2. **Settings → Google Fit and Health Connect → Connect**, then allow what you want shared: nutrition, exercise, weight, steps and active calories. Each one is optional.
3. **Settings → Reminders**: set your times. The app asks to allow notifications after the first food you log.
4. **Settings → Home screen widget → Add Quick log**, or long-press the home screen → Widgets → Calorie Tracker.

## AI models

The defaults are in `src/lib/settings-schema.ts`: `openai/gpt-oss-20b` for text and `whisper-large-v3-turbo` for voice. Groq retires models from time to time. If a model stops working, the app tells you which one, and you can change it under **Settings → Groq AI → AI models** without rebuilding.

Your API key is stored with SecureStore on the phone. Don't share an APK built with a `.env` key, because the key can be extracted from it.

## Development

```bash
npm start            # dev server (needs a development build on the phone)
npm run typecheck
npx expo lint
npm test             # unit tests for the Progress figures, AI parsing, nutrition maths, backup checks, reminders and dates
npx expo-doctor
```

| Path | What |
|---|---|
| `docs/PRODUCT.md` | What the app is for, the data model, and the definition of every figure on Progress |
| `src/app/` | Screens (Expo Router): Today, Progress, Settings, Log food, Exercise, Weight, Meal, Edit food, Day |
| `src/lib/db.ts` | SQLite schema and queries (sync API, also used by the widget) |
| `src/lib/logging.ts` | Every change to the food, exercise and weight logs goes through here, keeping DB, Health Connect, widget and reminders in step |
| `src/lib/insights.ts` | The figures on Progress, as pure functions with unit tests |
| `src/lib/backup.ts`, `backup-format.ts` | Export and restore, and the check a file must pass before anything is replaced |
| `src/lib/groq.ts`, `ai-parse.ts` | Groq client, prompt, JSON schema and response validation |
| `src/lib/health.ts` | Health Connect read and write |
| `src/lib/reminders.ts`, `reminder-plan.ts` | Meal, weigh-in and come-back reminders: scheduling, and which ones are due |
| `src/widget/` | Widget UI, data and background click handler |
| `src/constants/theme.ts` | All colours, radii and type sizes (shared with the widget) |

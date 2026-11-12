This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## What this app is for

Read `docs/PRODUCT.md` before changing any feature. It records, in the owner's words, what the app is for (one app to get to know your own fitness: daily logging of food, exercise and weight; insights worth opening after a month), the data model, and the exact definition of every figure on the Progress tab. A feature that makes daily logging slower, or shows a number the data cannot support, is wrong even if it looks good.

Read `docs/DESIGN.md` before changing any screen. It turns the design rules below into this app's concrete colour, type, shape and layout decisions, and ends with the checklist every screen is reviewed against.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## UI Design Philosophy — Refined Material 3

Design a visually appealing, polished Android-first React Native application inspired by Google's first-party applications.
The goal is to combine simplicity, usability and visual sophistication.

Design principles

1. Follow Google Material Design 3 and Material 3 Expressive guidelines.
2. Use Roboto typography with restrained, consistent font scales.
3. Create beautiful color palettes using Material tonal color roles.
4. Use subtle surface layering and tonal elevation.
5. Establish strong visual hierarchy through spacing, color and composition.
6. Use rounded shapes consistently and purposefully.
7. Use Material Symbols for consistent iconography.
8. Add subtle spring animations and smooth transitions.
9. Make empty states, loading states and error states visually polished.
10. Maintain excellent light and dark themes.

Visual quality

- Clean does not mean empty or boring.
- Minimal does not mean visually flat.
- Use accent colors strategically.
- Create visual interest through composition, subtle contrast and depth.
- Make important actions immediately recognizable.
- Give every screen a clear focal point.
- Make components feel cohesive rather than independently designed.

Avoid

- Excessive gradients and glassmorphism.
- Unnecessary decorative elements.
- Oversized typography.
- Random colors and inconsistent corner radii.
- Excessive cards and shadows.
- Generic AI-generated dashboard layouts.
- Unnecessary animations.

Implementation

- Use React Native Paper where appropriate.
- Follow platform-specific Android interaction patterns.
- Support edge-to-edge layouts.
- Use reusable design tokens.
- Respect accessibility and touch-target guidelines.
- Review screenshots and refine every screen before completion.

The final application should feel like a polished Google product: intuitive, distinctive, elegant and delightful to use.

## Design Philosophy — Google-inspired Android UI

Create a clean, minimal, intuitive Android application inspired by Google's first-party apps.

Visual language

- Follow Google Material Design 3.
- Use Roboto as the primary typeface.
- Use restrained typography with clear hierarchy.
- Prefer neutral surfaces with subtle tonal color variations.
- Use Google's Material color system.
- Use consistent spacing and alignment.
- Use rounded corners consistently, not excessively.
- Keep icons simple and recognizable.

UX principles

- Make navigation predictable.
- Prioritize content over decoration.
- Use familiar Android interaction patterns.
- Use bottom sheets, dialogs and menus appropriately.
- Provide subtle, meaningful animations.
- Ensure excellent touch targets and accessibility.

Avoid

- Oversized display typography.
- Unnecessary gradients.
- Neon colors.
- Excessive shadows.
- Random card layouts.
- Excessive whitespace.
- Decorative animations.
- Unnecessary visual elements.
- Dribbble-style concepts that compromise usability.

Overall objective: the application should feel like a polished Google-made Android app — calm, cohesive, familiar, functional and visually refined. Visual references: Google Home (pastel category tiles, thermostat hero tile), Google Wallet (rounded tonal list items with circular avatars), Google Photos (pill chips, floating toolbars).

## System-wide Android Material You Theming

The application must respect the user's existing Android system color preference.
Use the Android system's Material You dynamic color scheme as the source of truth.

- Retrieve the system's selected Material 3 color palette.
- Do not generate an independent color palette.
- Do not impose a fixed application brand color.
- Apply system primary, secondary, tertiary, surface and container color roles.
- Support corresponding light and dark schemes.
- Reflect system theme changes and color preference changes.
- Maintain proper contrast and accessibility.

The app should visually blend with Google Pixel first-party applications when the user changes their system accent color. Use native Android APIs through a compatible React Native module where necessary. (Here: `getMaterialColors()` from `@expo/ui`, read in `src/constants/theme.ts`; Google's static M3 baseline only when dynamic colour is unavailable.) One deliberate exception, chosen so Today looks like Google Home: protein, carbs and fat use Home-style category colours (Google blue, yellow and orange) harmonised toward the system primary with `@material/material-color-utilities`, in `src/constants/category-colors.ts`. Don't add other fixed colours.

Where these sections conflict with the one below, these win.

## Android UI/UX Design Philosophy

Act as a senior Android product designer.

The goal is to create visually stunning, intuitive,
production-quality Android applications.

Design principles:

- Follow Material Design 3 and Material 3 Expressive.
- Avoid generic AI-generated layouts.
- Establish a distinctive visual identity.
- Use intentional typography and color palettes.
- Create strong visual hierarchy.
- Use meaningful animations and transitions.
- Pay attention to spacing, alignment and proportions.
- Use edge-to-edge layouts appropriately.
- Prioritize usability over decorative elements.
- Support light and dark themes.
- Use native Android interaction patterns.

Before implementing a screen:
1. Understand its purpose and user journey.
2. Establish its visual direction.
3. Define reusable design tokens.
4. Consider loading, empty, error and success states.
5. Implement and visually review the result.

Never settle for the first acceptable design.
Critique and refine it before considering it complete.

In this project that means: use the `material-3` skill (.claude/skills/material-3) for tokens and components, the tokens in `src/constants/theme.ts` for every colour, type style and shape, Material Symbols through the `Icon` component, and review every UI change on the Pixel_8 emulator with screenshots before calling it done. React Native Paper is deliberately not used: the app has one M3 component set in `src/components`, and a second implementation would make buttons and fields inconsistent.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

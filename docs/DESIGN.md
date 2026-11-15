# Design plan

The look and feel of the app, decided once so every screen is built to the same idea. `AGENTS.md` holds the
owner's design rules and `docs/PRODUCT.md` says what each screen is for; this file says how those turn into
pixels. Where they disagree, `AGENTS.md` wins.

This is the second version (12 November 2026). The first version produced screens that were correct and calm
but flat: nine identical grey pills under the calories tile, one text weight everywhere, selection states you
had to look for, and the main action small and at the top of the screen. The owner asked three times for it to
be beautiful, and to take Material's own philosophy from the source. This version does that.

## The brief

- **Subject:** one person's fitness, day by day and over a month: what they ate, how they moved, what they weigh.
- **Audience:** the owner, on a Pixel 8 (phone only, no watch), opening it several times a day. Nobody else.
- **Job:** log in seconds; after a month, read something true without effort. One app to know your own fitness.
- **Direction the owner chose:** Google's own apps. Google Home (tonal tiles, a hero tile), Google Wallet
  (rounded list rows with circular avatars), Google Photos (pill chips). Material 3 Expressive. Roboto only.
  The phone's Material You colours, plus three category colours for protein, carbs and fat.

The identity is **"the Google Home of your body"**: a home screen of tonal tiles that each show one live fact
and do one thing when tapped. A tile is **lit** in its subject's colour when it holds something from today, and
**unlit** (neutral) when it is waiting, the way Home shows a lamp that is on or off.

The one motif that belongs to this app is **the wave**: Material's wavy progress and its scalloped "cookie"
shapes share the same edge. It appears where the app measures you against something: the calorie ring, the
streak badge, the good days on the calendar. Nowhere else.

## What Material says, and what we do about it

From m3.material.io (Start building with Material 3 Expressive; Usability, Applying M3 Expressive; Shape;
Color roles; Typography). Material names seven tactics. Each one is a rule here.

| Material's tactic | In this app |
| --- | --- |
| Use a variety of shapes; mix round and square for tension | Four shape families, each with one job: a ring (the day's budget), big-radius tiles (live facts), segmented groups with small inner corners (lists), full pills (actions and chips). The FAB is the one 16dp square-ish shape among pills. |
| Apply rich, nuanced colour; use contrast to emphasise the main takeaway | Colour tells the subject (below). Selection is a strong fill, never a faint tint. Neutral grey is for unlit tiles only. |
| Guide attention with typography; emphasised styles for key information and actions | Screen titles, hero numbers, tile figures and section headers are emphasised (one step heavier). Supporting text stays regular. |
| Contain content for emphasis; group similar content | Related rows are one segmented group, not loose pills. The most important thing on a screen gets the most space and the strongest container. |
| Add fluid, natural motion | Springs answer the user's own action: press, select, log. Nothing moves on its own. See Motion. |
| Leverage component flexibility | Connected button groups for exclusive choices, an extended FAB for the main action, segmented lists. |
| Combine tactics for hero moments, one or two per product | Two: the calorie ring on Today, and the focal sentence on Progress. Everything else is quiet on purpose. |

From Material's usability example (the Aura app): the primary action is large, low on the screen and in
`primary` on a soft ground; settings are in secondary containers and less emphasised; a progress screen is
subtler than the hero screen, with key numbers large in emphasised type and shapes marking the good days on
its calendar.

## Colour

All colour comes from the phone's Material You scheme through `useTheme()`. No hex values in components.
Use roles only in their pairs (`primary` with `onPrimary`, a container with its `on…Container`).

| Role | Used for |
| --- | --- |
| `surface` | page ground |
| `surfaceContainerHigh` | unlit tiles, list rows, chart cards |
| `surfaceContainerLow` | sheets |
| `primaryContainer` / `onPrimaryContainer` | the focal tile on a screen; a tile lit by food or weight |
| `primary` / `onPrimary` | the one main action on a screen (the FAB, Save); a selected choice about food or the screen itself; weight and food data marks |
| `tertiaryContainer`, `tertiary` | everything about movement: a lit exercise tile, workout avatars, a selected activity or intensity, calories burned |
| `secondaryContainer` / `onSecondaryContainer` | quiet tonal buttons, a logged meal's avatar, the streak tile, the nav pill |
| `error`, `errorContainer` | only the part of a day that went over budget, and destructive actions |
| `outline`, `outlineVariant` | reference marks (goal lines, targets), the ring around a not-yet avatar |
| category colours (`categoryColors()`) | protein, carbs and fat only, wherever they appear |

- **Subject keeps its colour everywhere.** Food and weight are `primary`, movement is `tertiary`, macros are
  their three category colours. A reader can tell what a mark measures before reading a label.
- **Lit and unlit.** A tile or avatar takes its subject's container colour when it holds something from today
  (a logged meal, a workout, today's weigh-in). Otherwise it is neutral and says what to do. This replaces the
  old filled/outlined rule: nothing is outlined except the 1dp ring of a not-yet avatar.
- **Selection is a fill.** A selected segment, chip or tile is `primary`/`onPrimary` (or `tertiary`/`onTertiary`
  on movement screens) and its label is emphasised. Unselected is `surfaceContainerHigh`. `secondaryContainer`
  next to `surfaceContainerHigh` is not enough contrast to carry a selection and must not be used for one.
- **Over budget is information, not an alarm.** A bar or ring is `primary` up to the budget and only the part
  above it is `error`. The calories tile does not turn red.

## Type

Roboto only, the M3 scale in `theme.ts`, sentence case, no all-caps labels. "Emphasised" means `emphasized`
on `AppText` (one weight step up).

| Style | Used for |
| --- | --- |
| `displayMedium` emphasised, tabular | the one hero number on a screen: calories left on Today, the value in a sheet |
| `headlineMedium` emphasised | a tab screen's title (Today, Progress, Settings) |
| `headlineSmall` emphasised | a sheet's title; the focal sentence on Progress |
| `titleLarge` emphasised, tabular | a tile's figure; the answer at the top of a chart card |
| `titleMedium` emphasised | section headers |
| `titleMedium` | a list row's headline; button labels on large buttons |
| `bodyMedium` on `onSurfaceVariant` | supporting lines: what a figure is built on |
| `labelMedium` / `labelSmall` | chart axes, legends and the small unit under a figure |

Figures that sit in a column or change in place use tabular numerals. A card opens with its answer in words,
then the figure, then the picture. No display type anywhere except the one hero number.

## Shape

| Shape | Token | Used for |
| --- | --- | --- |
| 32dp | `extraLargeIncreased` | the hero tile on Today, the focal tile on Progress |
| 28dp | `extraLarge` | chart cards, sheets, the value box inside a sheet |
| 20dp | `largeIncreased` | tiles in a grid; the outer corners of a segmented group |
| 16dp | `large` | the FAB |
| 4dp | `extraSmall` | the inner corners of a segmented group and of a connected button group |
| full | `full` | buttons, chips, avatars, bars; the selected segment of a connected button group |
| cookie | `ShapeAvatar` `cookie9` | the streak badge; a day within budget on the calendar |
| sunny | `ShapeAvatar` `sunny` | a goal reached |

**Segmented group** (`Group` in `ui.tsx`): rows that belong together are stacked with 2dp gaps; the first row
has 20dp top corners, the last has 20dp bottom corners, every other corner is 4dp. Each row is its own filled
surface, so the gaps show the page ground. This is the list everywhere: meals, workouts, weeks, foods, days,
settings.

**Connected button group** (`SegmentedButtons` in `ui.tsx`): an exclusive choice. Equal-width segments, 2dp gaps,
4dp inner corners, full outer corners; the selected segment becomes fully round and takes the selection fill.

## Layout

One column, 16dp gutters, 8dp between tiles in a group, 24dp between sections, section header 8dp above its
content. Left aligned throughout; figures right aligned in rows. Every touch target is at least 48dp.

### Today

```
Wednesday 11 November                         (cookie 12)   streak badge, opens Progress
Today
+--------------------------------------------------------+
| (fire) Calories                                      > |  primaryContainer, 32dp; header opens the day
|                   .-~~~~~~~~~-.                        |
|                 /    1,160     \                       |  the ring: wavy primary arc = eaten,
|                 \   kcal left  /                       |  track = left, tertiary stretch = burned
|                   '-~~~~~~~~~-'                        |
|   * 1,160 eaten      * 320 burned       2,000 goal     |
+--------------------------------------------------------+
[ Protein  55 /110 g ][ Carbs 150 /230 g ][ Fat 38 /65 g ]   category tiles, a thick bar each
[ (scale) 74.2 kg            ][ (run) 320 kcal            ]   weight tile and exercise tile,
[ Losing 0.5 kg a week       ][ Run, 30 min               ]   each lit when it has something from today
Log again
( coffee  Filter coffee 90 )( Oats with banana 320 )( ... )   one row of pills, scrolls sideways
Meals                                           1,160 kcal
| (sun)  Breakfast   Oats with banana, Filter coffee  410 |  segmented group; a logged meal's avatar
| (sun)  Lunch       Chicken biryani, Curd            750 |  is lit, an unlogged one is a ring
| ( o )  Dinner      Not logged                         + |
| ( o )  Snacks      Not logged                         + |
Exercise                                                      only when a workout is logged today
| (run)  Run   30 min, moderate                 +320 kcal |
                                            [ + Log food ]    extended FAB, primary, above the nav bar
```

- The ring is the hero moment: about 196dp, a 12dp stroke, the number in `displayMedium` emphasised.
  Over budget, the ring stays `primary` and the overshoot is an `error` arc from the top; the label says
  "kcal over".
- **Log food is the FAB**, bottom right, 56dp tall, icon and label, `primary`. It is the largest, lowest,
  strongest thing on the screen, as Material's usability guidance asks of the primary action. Logging exercise
  and weight are the two tiles under the macros: one tap each, no scrolling on a Pixel 8.
- The streak leaves the tile grid and becomes the cookie badge in the header: lit `primary` once today is
  logged, neutral before.

### Progress

```
13 Oct to 11 Nov                                       (v v)   jump to every day
Progress
[   7 days   |   30 days   |   90 days   ]                     connected button group, selected = primary
[ Focal sentence, primaryContainer, 32dp, headlineSmall emph. ]
[ Weight   ~sparkline ][ Calories  mini bars     ]   glance grid; exercise tile on tertiaryContainer,
[ Exercise  bars      ][ Streak    cookie badge  ]   streak tile on secondaryContainer
Weight                              24 weigh-ins
[ answer / dots + direction line / target progress ]           chart card, 28dp
Calories                            Goal 2,000 kcal
[ answer / bars with over-budget caps / three stats ]
Week by week                                                    segmented group, newest first
What you actually burn / Macros / Exercise / Consistency / Patterns
Top foods                                                       segmented group with food avatars
Every day                                                       segmented group with a ring per day
```

Detail cards are not all the same box: a chart is a 28dp card, a ranked list is a segmented group with no card
around it, pairs of small facts are 2-column tiles. The page gets its rhythm from that alternation. On the
consistency calendar a day within budget is a filled cookie, an over-budget day a plain filled circle with its
error cap, a thin day a small dot, an empty day nothing.

### Sheets

A sheet has a title row (`headlineSmall` emphasised, the day underneath, icon buttons at the right: delete
when editing, then close), one value box, the choices, and one full-width 56dp `primary` button that says what
it does. The value box is `primaryContainer` (weight) or `tertiaryContainer` (exercise), 28dp, with quiet round
minus and plus buttons either side of the number, so the save button is the only strong fill on the sheet.
Choices are connected button groups or pills with the selection fill. Nothing sits below the save button.

### Settings

`headlineMedium` title, then sections. A section is a `titleMedium` emphasised header and one segmented group.
A row has a 40dp round avatar in a container colour that fits its subject, a `titleMedium` headline, a
supporting line, and one trailing control. Number fields for the daily targets sit together in one 20dp card.
The words never mention a watch: this phone is the only source of steps and activity.

## Motion

Rules from Material's motion-physics guidance and Emil Kowalski's animation decision framework (ask first how
often it is seen and what it is for).

- **Press.** Every tappable surface answers a press at once: it scales to 0.97 (0.98 for full-width rows and
  cards, 0.95 for the FAB and round icon buttons) with `Springs.fast` and returns with `Springs.spatial`, on
  top of the Android ripple. `Tappable` in `ui.tsx` does this; do not hand-roll it. Text fields and switches
  are left alone.
- **Selection.** The selected segment of a connected group springs its corners from 4dp to full while its
  fill changes. Same for an activity tile.
- **Values.** The ring and the macro bars spring from the value they showed last to the new one. They do not
  replay from zero every time the screen opens: Today is opened many times a day, and an entrance you see
  twenty times a day is noise. The first time in an app run they draw once from zero. Charts on Progress are
  drawn in place, without animation.
- **Nothing else moves.** No entrance stagger on tiles, nothing on scroll, no looping, no count-up numbers.
  Sheets use the system's own transition.
- Every animation passes `reduceMotion: ReduceMotion.System`, so "Remove animations" lands everything in place.
- Shared values are read and written with `.get()` and `.set()` (React Compiler).

## Words

Plain, sentence case, the owner's vocabulary (target, budget, weigh-in, full day). A figure says what it is built
on. An unlit tile says what to do, not what is missing. A button says what happens ("Log food", "Save weight",
"Use new targets"). An action keeps one name everywhere.

## Checked against the brief

- *Is a big number in a ring the stock fitness hero?* A ring is what Google Fit itself uses, and here it is
  drawn with Material's wavy track and carries three facts (eaten, burned, left) the old bar carried less
  readably. It is the one hero; nothing else on Today is larger than a `titleLarge`.
- *Is the glance grid the stock "four stat cards"?* It would be if the tiles were number-over-label. Each has
  its own small picture, its subject colour and a job when tapped. Kept, with that condition.
- *Are segmented groups just cards again?* No: a card wraps unrelated content in one box; a group shows that
  rows are siblings and where the set ends. One card per chart, one group per list.
- *Shapes everywhere?* That would be decoration. The cookie appears in three places that all mean "a good
  day"; sunny in one.

## Review checklist (every screen, light and dark, 1.0x and 1.3x text)

1. One focal element; the eye lands on it first, and the main action is the strongest fill on the screen.
2. Each tile's first line is its answer.
3. Colour tells the subject: primary food and weight, tertiary movement, category colours macros.
4. Lit means something from today; unlit is neutral and says what to do.
5. A selection can be found at a glance in both themes.
6. Lists are segmented groups; no loose pills, no dividers inside cards where a group would do.
7. No text clipped, orphaned or overlapping at 1.3x; no target under 48dp.
8. Every tappable surface uses `Tappable` (or a `Button`/`Chip` built on it).
9. Dark mode keeps the same hierarchy; nothing relies on a shadow except the FAB.
10. It still looks like a sibling of Today.

## Show, don't tell (version 3)

The owner, 2026-11-15: "there are too many text informations in the whole app … visually convey them so
users dont have to just read everything, make it appealing". This section changes how every card speaks.
Where it conflicts with the sections above, it wins.

### The rule: one number, one picture, one line

Every card answers its question with **one figure** (the hero, tabular, emphasised), **one picture** that
shows where that figure sits (a bar, a range, dots, a ring), and **at most one line** of words, about
60 characters. Everything else a card used to say (how it is worked out, what is left out, what to log)
moves behind a **"How it's worked out"** disclosure at the foot of the card. The honesty PRODUCT.md
asks for is kept, but it is one tap away instead of in the way.

```
┌──────────────────────────────────────────┐
│ (●) Burn                      [Good est.]│  avatar, 1–3 word title, status chip
│                                          │
│ 2,450 kcal   ▼ 450 under                 │  hero figure + delta chip
│ ├────[▓▓▓▓▓▓]────────┤                   │  picture: range band, goal and intake marks
│   eat 1,939   goal 2,000                 │  marks are labelled in place, not in a legend
│ Losing about 0.4 kg a week.              │  the one line
│ How it's worked out              ⌄       │  disclosure (the old paragraphs)
└──────────────────────────────────────────┘
```

### The picture vocabulary (`src/components/glance.tsx`)

Each kind of fact has one picture, used the same way everywhere, so the owner learns to read them once.

| Fact | Picture | Example |
| --- | --- | --- |
| A change | **Delta chip**: arrow and amount, filled `primaryContainer` when it is toward the goal, quiet `surfaceContainerHighest` when not. Never red: only the part of a day over budget is `error`. | ▼ 0.4 kg/wk |
| A value against a range | **Range bar**: track, shaded band for the range, labelled marks for goal and actual | burn 2,350–2,550, goal 2,000 |
| A share of a whole | **Split bar**: one stacked bar, segments in the subject's colours, labels under the segments | meals, macros, weekdays vs weekend |
| Days hit or missed | **Day dots**: a row of small dots, filled for a hit, ringed for a miss, today hollow | protein on 5 of 7 days |
| Progress to a target | **Small ring** with the per cent inside | 79% of the way to 72 kg |
| A few counts | **Stat row**: 2 to 3 facts, each an icon, a number and a 1–2 word label | three cells: 25 days, 24 weigh-ins, 10 workouts |
| Not enough data yet | **Unlock meter**: segmented bar of what is there against what is needed, and the one action | weigh-ins 3 of 7, Log weight |
| Ranked items | **Bar rows**: name, number, and a thin bar for its share; no "11% of your calories" lines | top foods, top activities |

### Words that stay

- Titles are 1 to 3 words ("Burn", "Protein", "Weekends"), never a sentence.
- The one line says what the picture means in the owner's terms; it never repeats a number already drawn.
- Labels sit on the marks they label. Legends only where marks cannot carry their own label.
- No middle-dot meta strings, no all-caps eyebrows, no arrows appended to buttons.

### Motion (Emil Kowalski's rules)

- The disclosure opens with height and opacity, 200 ms, strong ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`),
  and the chevron turns with it; it closes in 150 ms. Under reduced motion it only fades.
- Pictures are drawn in place; only Today's hero ring and macro bars spring, as before. Cards seen
  several times a day do not animate in.
- Every tappable card, chip and row presses to 0.97 through `Tappable`.

### Checked against the brief (frontend-design's self-review)

- The default it could slide into: a dashboard of identical KPI tiles ("big number, small label, delta").
  We avoid it by letting the **picture differ by fact** (range, split, dots, ring), keeping one lit focal
  card per screen (Today's ring, Progress's headline), and putting the rest on quiet unlit surfaces in
  segmented groups, as Google Home does.
- One memorable thing per screen: Today's wavy budget ring, Progress's weight line. Everything else is
  quiet and consistent.

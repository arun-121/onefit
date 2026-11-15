# Calorie Tracker: what it is for

A personal Android app (the owner's Pixel 8) for tracking fitness goals. The owner's words:

> I need an app where I should be logging my exercise and daily calorie intake. Basically, an app
> to keep track of my fitness goals. It should be useful when I open it and see the insights after
> a month. Don't compromise on the build. I want to use it every day.

Two things follow from that, and every feature is judged against them:

1. **Logging has to be quick enough to do every day.** A meal, a workout or a weigh-in is a few
   taps. Nothing asks for information the app could work out.
2. **After a month, the app tells the owner something true and useful** that they could not see
   from any single day: where their weight is heading, what they really eat, what they really
   burn, and which habits drive it.

Honesty matters more than polish in the numbers. If there is not enough data for a figure, say
what is missing and how to get it; never show a confident number built on three data points.

## The daily loop

| When | What | Where |
| --- | --- | --- |
| Morning | Weigh in (optional, about 5 seconds) | Weight tile on Today, or the weigh-in reminder |
| Meals | Log food: type it and the AI estimates; one-tap favourites; same as yesterday | Today, meal sheet, widget, reminders |
| After training | Describe the workout ("bench press 4×10 at 60 kg, 20 min run"); the AI works out each exercise | Exercise tile or Log exercise |
| Any time | See calories left, macros, streak | Today, widget |

## Data (SQLite, on the phone only)

Existing tables: `entries` (food), `foods` (saved foods), `exercises`, `kv` (settings).

New table `weights`, one row per calendar day (a second weigh-in on the same day replaces the first):

```sql
CREATE TABLE weights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,        -- local day, YYYY-MM-DD
  kg REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',   -- 'manual' | 'health' (read from Health Connect)
  created_at INTEGER NOT NULL,
  hc_record_id TEXT
);
```

Settings additions (`src/lib/settings.ts`):

- `weightGoalKg: number | null`: the target weight. `null` until the owner sets one.
- `goalStartDate: string | null`, `goalStartWeightKg: number | null`: set when the target is set or
  changed, from the latest weigh-in, so progress has a starting point.
- `weighInReminder: ReminderSetting`: daily weigh-in reminder, off by default, 08:00.

Logging a weight for the most recent day also updates `profile.weightKg`, because exercise
estimates use it. It does **not** silently change calorie or macro targets; Progress suggests
recalculating when the current weight (defined below, not one weigh-in) is 2 kg or more from the
weight the targets were set at.

## Health Connect

Already synced: Nutrition (write), ExerciseSession and ActiveCaloriesBurned (write), Steps and
ActiveCaloriesBurned (read). Add Weight: write each weigh-in; read weigh-ins made by other apps
(a smart scale, Google Fit) for days that have no manual entry. Every Health Connect grant is
optional: the app works fully without any of them.

## Progress tab (replaces History): the month-later payoff

Tabs are Today, Progress, Settings. Progress has a period switch: 7, 30 or 90 days, ending today.
All figures come from pure functions in `src/lib/insights.ts`, unit-tested, with no React or SQLite.

The charts start on the first day anything was logged (a meal, a workout or a weigh-in) when that
is inside the period, so the 90-day view is not two-thirds empty a month in. They never cover
fewer than 7 days (`period.chartFrom`, `period.chartDays`).

Definitions used everywhere:

- **Budget** for a day = calorie goal + calories burned in logged workouts that day. Today and
  the day view can add activity from other apps on top ("Add activity from other apps", with
  Health Connect on). That activity is not stored per day, so Progress cannot count it; when both
  switches are on, the Calories card's note says so: "Progress counts the workouts you logged,
  not activity from other apps, so a day can read differently here than on Today or its own page."
- **Logged day**: at least one food entry.
- **Complete day** ("full day" on screen): a logged day with calories of at least
  `max(800, 40% of the calorie goal)`, **that is over**. Today is never a complete day, whatever
  is logged on it: it is counted from tomorrow. (Counted from 800 kcal, an afternoon's worth
  pulled every average down until dinner was logged.) Averages, Patterns and the maintenance
  estimate use complete days only, so neither a day with only a coffee nor an unfinished today
  drags them down. Say how many days were left out when any were, and that today is not counted
  yet when it has entries.
- **An average needs 3 complete days**: the calorie average, the macro averages, and a row of
  "Week by week". One or two days are days, not an average, and the card says how many there are
  so far ("2 full days logged so far. An average shows after 3."). On the evening of a full first
  day nothing is missing, so the reason is "Today counts once the day is over." and no step is
  offered.
- **Counted days**: the days that could have been logged, from the first food entry on, without
  today until it has an entry. "Logged 14 of 30 days" is logged days out of counted days.
- **Rate**: least-squares slope of the weigh-ins in the period, in kg per week. It is worked out
  from at least 3 weigh-ins spanning at least 7 days, but it is **shown only when it is clear**.
  - *Standard error* of the slope = `noise / √Sxx`, where `Sxx` is the sum of squared distances of
    the weigh-in days from their mean and `noise` is the scatter of the weigh-ins around the line
    (`√(RSS / (n − 2))`), never taken to be under 0.3 kg: a scale and a day's water are no better
    than that, however well three weigh-ins happen to line up.
  - **Clear**: the slope is at least 2 standard errors from zero (and is at least 0.05 kg a week
    and 0.1 kg in all, so nothing is ever printed as 0.0). Only then does the app say "Losing
    0.4 kg a week", "Down 1.6 kg in 30 days", show an arrow, or give a date for the target.
  - **Steady**: not clear, and 2 standard errors come to 0.3 kg a week or less. The app says
    "Holding steady" and gives no rate.
  - Otherwise the app says "Too early to say" (the weigh-ins cover fewer than 21 days) or "No
    clear direction yet", with "Your weigh-ins vary from day to day by more than the change so
    far". No rate, no change, no arrow, no date.
  - The rate and the date are worked out for **30 and 90 days only**. A week is too short to tell
    a real change from day-to-day swings, so the 7-day view fits nothing of its own (see the
    Weight card).
- **Current weight** (`currentWeightKg`): the weight now, the same whatever period is selected.
  In order: the fitted weight on the day of the latest weigh-in, from the line through the last
  30 days' weigh-ins, when they give one (3 weigh-ins over 7 days); else the mean of the latest
  up to 3 weigh-ins made no more than 10 days before the latest one; else the latest weigh-in.
  To 0.1 kg. "Target reached", the distance and the percentage to the target, and the
  recalculation suggestion are all measured from it, on Progress and in Settings, so one low
  morning neither reaches the target nor moves the percentage ten points.
- There is **no smoothed trend** in the app. (An earlier version drew
  `trend += 0.1 × (weight − trend)`; it ran more than half a month's change behind.)

Cards, in order. Each has an empty state that leads with what to log to unlock it, not with what
is missing. An app with nothing logged at all shows the headline tile and one "What shows up
here" tile in place of a not-ready tile per card. Its lines come from `whatShowsUpHere()`, which
builds them from the same constants the cards use: where the weight is heading after 3 weigh-ins
over at least a week, the average calories after 3 full days, what you actually burn after 4 or
more weigh-ins over at least 2 weeks with meals logged in between, patterns after 5 full days.

1. **Headline**: one sentence with the most important fact of the period, for example
   "Down 1.8 kg in 30 days, eating 1,870 kcal a day on average." The weight half is said only
   when the rate is clear ("Down 1.8 kg in 30 days") or steady ("Weight steady over 30 days");
   otherwise the sentence is about calories alone. It has no weight half in the 7-day view.
   - The calorie half needs the average, so 3 complete days. Before that the sentence says how
     far along the owner is: "Your first day is logged. An average shows after 3 full days.",
     then "2 full days of meals logged so far. An average shows after 3."
   - **Low coverage**: when complete days are under 60% of the counted days, the average stands
     on a minority of the period, and that is the most important fact. The headline leads with
     it: "Meals fully logged on 9 of 30 days. On those days you ate 1,858 kcal on average." With
     a weight half: "Down 1.8 kg in 30 days, eating 1,858 kcal a day on the 9 days you logged in
     full."
   - Nothing logged in the period: an invitation, "Log a meal, a workout or your weight to see how
     the last 30 days went." Before anything was ever logged it ends "to see how you are doing."
2. **Weight**: a dot for every weigh-in, the target as a dashed line, and the **least-squares
   line** the card's figures come from, drawn from the first to the last weigh-in of the period
   whenever the fit exists (clear or not: it is the fit, not a claim) and never in the 7-day view.
   The ringed "latest" mark sits on the latest weigh-in. Legend: "Weigh-in", "Direction" (only
   when the line is drawn), "Target". One sentence under the chart says how to read it: the line
   is the steady direction through the weigh-ins, and single weigh-ins swing around it.
   - When the rate is clear: the rate per week and the change over the period, the latest
     weigh-in, and "Smoothed", the fitted weight on the latest weigh-in (`rate.nowKg`).
   - **The date for the target** comes from the clear rate. The rate is only known to within
     2 standard errors, and so is the date: when its early and late ends are more than 14 days
     apart the card gives the span ("between mid December and mid January"), and when the slow
     end is more than 2 years out it gives only the early end ("in mid December at the
     earliest"). Otherwise one date ("around 19 Dec"). A plain statement instead when the weight
     is steady, moving away from the target, more than 2 years away, due about now, or not clear yet.
   - **Target reached** is judged by the current weight. When only the latest weigh-in is at the
     target: "Your latest weigh-in is at your 78.0 kg target. A few more will confirm it."
   - With two weigh-ins and no rate yet, the card still shows the plain change between them
     ("Up 0.6 kg since 13 Oct"): a difference between two readings, not a rate.
   - **7-day view**: no rate and no line. When the last 30 days give a rate, the card says a week
     is too short and offers "Show 30 days"; when they do not, it says what to log, exactly as the
     30-day view would. The date for the target is the one from the last 30 days, and says so
     ("From the last 30 days: ..."). With at least 2 weigh-ins in the last 7 days and 2 in the
     7 days before, the card compares the two averages ("Your weigh-ins averaged 80.4 kg over the
     last 7 days, 0.6 kg lower than the 7 days before (3 and 2 weigh-ins).").
   - Suggest recalculating targets when the current weight is 2 kg or more from the weight they
     were set at.
   - Once today has its weigh-in, nothing on Progress offers "Log weight" (there is one a day);
     the reasons that ask for more weigh-ins end "Weigh in again tomorrow."
3. **Calories**: average intake on complete days against the goal, with the number of days it
   is over; one bar per day with the goal line, today's drawn as not in the average; days logged
   out of counted days; complete days within budget; days over budget.
   - Days are judged against their budget and the average against the bare goal. When workouts
     move the average budget over the same complete days 25 kcal or more from the goal, a second
     line joins the two: "Your budget averaged 2,054 kcal with workouts, so you were 43 under it."
   - Nothing logged in the period: "Log your meals to see your average against your goal.", with
     "Your last logged meal was 12 days ago." after it when there was one.
4. **Week by week**: the period as whole weeks, to answer "is it getting better?". 7-day blocks
   counted back from today, newest first: 4 over 30 days, 12 over 90. (Calendar weeks would leave
   a part-week at each end, whose workouts cannot be compared with a whole week's; the few oldest
   days of the period that do not fill a block are left out.) Each row has:
   - average intake on its complete days: needs 3, else "too few full days";
   - average weigh-in: needs 2; a single weigh-in is shown as that one weigh-in, none as a dash;
   - workouts and minutes of exercise.

   Blocks that end before the first day anything was logged are not shown, and the block the app
   was first used in carries how many of its days count. One block is not a comparison, so the
   card is not shown in the 7-day view or in a first week of use.
5. **What you actually burn**: estimated maintenance = average intake − (rate in kg per day × 7700),
   shown as a **range**, because the rate is only known to within 2 standard errors:
   `low = intake − (rate + 2 SE) × 7700`, `high = intake − (rate − 2 SE) × 7700`, each to the
   nearest 50 kcal and kept inside 1,000 to 6,000. The card shows the middle to the nearest 50
   ("About 2,450 kcal a day") with the range under it ("Likely between 2,250 and 2,650 kcal").
   The slope is used whether or not it is clear enough to state as a rate: a level weight that is
   well pinned down is a good basis.
   - Needs at least 14 days between the first and last weigh-in in the period, at least
     4 weigh-ins, and complete days on at least 60% of the days between them. Today is left out
     of those days when the last weigh-in is this morning's: it cannot be complete yet.
   - On top of those, the range must be **no more than 600 kcal wide**; wider, the card says what
     the weigh-ins allow so far and shows no figure. With the 0.3 kg noise floor that takes
     roughly 4 weigh-ins over 3 weeks, or 15 daily ones, so the minimums above alone never show
     a figure.
   - How sure it is comes from the width: good up to 200 kcal, fair up to 400, rough up to 600.
   - What the current goal means is read off the range: a deficit or a surplus only when the goal
     is outside it ("250 to 650 kcal less than you burn, about 0.2 to 0.6 kg lost a week"),
     otherwise "close to what you burn".
   - The figure from the targets calculator in Settings is compared with the range too: "more" or
     "less" only when it is outside it, otherwise "about the same".
   - Label it an estimate, and say that it assumes everything eaten is logged: anything missed
     makes the real figure higher.
   - Not offered in the 7-day view, which offers "Show 30 days" instead.
6. **Macros**: average protein, carbs and fat on complete days against goals, from 3 complete
   days; days protein reached 90% of its goal.
7. **Exercise**: workouts, total minutes, calories burned, active days, and the top activities by
   time. The weekly average is given only once the app has been in use for 7 days: three days
   in, "2 workouts a week" would be three days stretched into a week.
8. **Consistency**: a calendar of the period, each day marked one of four ways: not logged, a
   complete day within budget, over budget, or **not a full day** (logged and not over budget,
   but with too little on it, or today, which is still open). Current streak and best streak of
   logged days.
   - The counts are one sentence that adds up: "Logged 14 of 30 days: 8 full days within budget,
     1 over, 4 with too little logged. Today is still open." "Within budget" counts complete days
     only, the same number the Calories card gives. Today is not counted as within or as too
     little; it is counted as over once it is over.
   - When one weekday, or two level with each other, is most often not logged in full, on at
     least half of 3 or more of them, the card says so, because those days are missing from every
     average: "Saturdays are most often not logged in full (3 of 4), so your averages leave those
     days out." Days before the first log and today are not counted.
9. **Patterns**: from 5 complete days. Let `sd` be the sample standard deviation of the period's
   complete days: how much one day differs from the next. A difference between two groups of days
   is stated only when it is at least 2 standard errors.
   - **Weekday against weekend average.** Needs 3 complete days of each. A difference is stated
     ("Weekends average 2,550 kcal a day, 550 more than weekdays.") only when it is at least
     100 kcal and at least `2 × sd × √(1/weekdays + 1/weekend days)`. Under 100 kcal apart:
     "Weekdays and weekends look about the same so far". In between: "Too few days to tell
     weekdays and weekends apart yet." Both averages and their day counts are shown either way.
   - **Share of calories by meal.**
   - **The highest day of the week.** Needs 14 complete days, and 3 of a weekday before it is
     compared or drawn as a bar (with fewer it is a stub); at least two weekdays must have their
     3. A day is named, and its bar picked
     out, only when it is at least 150 kcal above the average of all complete days and at least
     `2 × sd / √(its days)`; otherwise "No day of the week stands out yet." and every bar looks
     the same. The chart is drawn only when this part has its data.
   - Why: run over simulated months of 25 complete days all drawn from one distribution (no
     pattern at all), the earlier fixed 50 kcal found a highest day in 99 months of 100 and a
     weekend difference in 64. These thresholds bring that to about 8 and 4, and still report a
     real 400 kcal weekend difference in 97.
   - 7-day view: a week holds one of each weekday and two weekend days, so neither comparison
     can be made. Both say so and offer "Show 30 days".
10. **Top foods**: the five foods that contributed the most calories, with how often each was
    logged.
11. **Every day**: the existing list of days, each opening the day view.

## Today additions

- A **Weight** tile and a **Streak** tile, side by side under the Calories tile, in the same style
  as Today's other small tiles. The Weight tile opens the weight sheet and answers "have I weighed
  in today?" at a glance:
  - Title: the latest weigh-in ("80.5 kg").
  - Today has a weigh-in: the tile is filled, and the detail is the **weekly rate over the last
    30 days** with its arrow ("0.4 kg a week"), the same least-squares rate Progress shows for
    30 days, and shown only when it is clear; "Steady" when it is steady; "Logged today" when
    there is no clear rate.
    (An earlier version showed the change over 7 days, which two weigh-ins a day apart could fill.)
  - Today has no weigh-in yet: the tile is outlined, like a meal that is not logged, and the
    detail says when the latest one was ("Logged yesterday", "Logged 9 Nov").
  - No weigh-in ever: outlined, "Log weight".
  - The spoken label always carries the weight, when it was logged, and the rate when there is one.
- A **weight sheet** (`/weight?date=`), a bottom sheet like the exercise sheet. The large number is
  itself the input: tap it and type (the whole number is selected), and the keyboard's done key
  saves. − and + step 0.1 kg and repeat while held. Save, and Delete when that day already has
  an entry.
- The day view shows that day's weight when there is one.

## Personal assistant (like MacroFactor, but local)

The owner's words: "this app should be more like my personal fitness assistant, the food I log should
give me insights", "something like MacroFactor, but everything local, and API call based LLM calling".
All data stays in SQLite on the phone. The only network calls are to Groq, with the owner's key.

- **Goals** (Settings, "Work out my targets"): Lose fat, Build muscle, Lose fat while building muscle
  (recomposition), Maintain weight. Lose fat (0.1 to 1 kg a week) and Build muscle (0.1 to 0.5 kg a week)
  take a pace the owner types; 1 kg a week is about 1,100 kcal a day. Lose fat while building muscle is 10%
  under the burn. Protein is 2 g per kg for Lose fat and Build muscle, 2.2 g for Lose fat while building
  muscle, and 1.6 g for Maintain weight. Fat is 25% of calories and carbs make up the rest, never under
  1,200 kcal. Goals saved before this change convert: lose → Lose fat at 0.5, lose_slow → Lose fat at
  0.25, gain → Build muscle at 0.25.
- **Weekly check-in** (Today, once every 7 days): the targets are worked out again from what the
  owner really burns (Progress's 30-day "What you actually burn", from logged food and the weight trend)
  plus the goal's change, and the protein for the goal at the current weight. One check-in moves the
  calorie target by at most 250 kcal. It is shown only with a goal, a weigh-in and a burn estimate of
  fair or good confidence. A change under 50 kcal (and protein within 10 g) is "on track". "Update
  targets" or "Not now" both wait a week, and both can be undone.
- **Next step** (Today): one coach tip from today's numbers. It covers protein left with saved foods that
  fit the calories left (most protein per calorie first, logged with one tap), a kind word about a day
  over budget in the words of the goal, the surplus still to eat on a Build muscle evening, and a
  protein-first start in the morning. It suggests only foods the owner has logged before.
- **Assistant tab**: a chat with the text model from Settings. Each question sends a summary of the
  data: goal and targets, today's entries, every 30-day Progress card (a card that is not ready goes as
  its reason, never as a number), top foods by calories and by protein, two weeks of daily totals and
  weigh-ins, and saved foods with portions. The model is told to use only those figures, to say what to
  log when the data cannot answer, never to go under 1,200 kcal, and to send health questions to a
  professional. The conversation (last 40 messages) is kept on the phone and is not in backups.

## Heads up: the app speaks first

The owner's words: "if this finds anything unusual, or any suggestions, proactiveness". Rules over
the owner's own logs (`src/lib/nudges.ts`), no AI and no network. Each needs enough data and stays
quiet otherwise. Days are named ("Saturday"), so a sentence stays true the next morning.

| Rule | When | Says |
| --- | --- | --- |
| Missed day | Nothing logged yesterday, after 4 of the 7 days before were logged | Log it while it is fresh |
| High day | Yesterday over the usual by 2 standard deviations of the last 30 full days (at least 7 of them), and 400 kcal over the goal | How far over, the biggest item, why one day does not move the trend |
| Light day | Yesterday logged but under a full day | Add what was missed; for Build muscle, the surplus matters |
| Protein low | 3 of the last 4 full days under 80% of the protein goal | The average and the owner's best protein foods |
| Weigh-in jump | Latest weigh-in (today or yesterday) 1.2 kg or 1.5% from the 10 days before (3 or more weigh-ins) | Almost always water; the trend barely moves |
| No weigh-in | A goal is set and 7 or more days since the last weigh-in | Check-ins need weigh-ins |
| No workout | Build muscle or recomposition, 5 or more days since the last workout, 4 or more in the month before | Train 2 to 4 times a week, or log what was missed |
| Pace off | A clear 30-day weight rate against the goal's pace: gaining over twice the pace, or going the wrong way | What the next check-in will do |
| New best | A lift logged today or yesterday with a higher estimated one-rep max (weight × (1 + reps/30)) than any earlier session of it | The set, the old best, and the next step (+2.5 kg or one more rep) |
| Stall | A lift's last 3 sessions no better than its best before them | A lighter week, another rep range, protein and sleep |
| Streaks | 7, 14, 21, 30, 50 … days logged; protein on target 5, 10 or 20 days running | A short well done |

- **Today**: up to three, most important first, under "Heads up", each with its step (log that day,
  log weight, log exercise, see Progress) and a dismiss that is remembered.
- **Notification**: at most one, at 9:00 the next morning: the most important thing the rules will
  say tomorrow (priority 50 and over) that has not been dismissed or already shown on Today. It is
  worked out again after every change to the logs and when the app opens. "Heads up" in Settings,
  Reminders turns it off.
- The Assistant is told what Heads up noticed today.

## Logging a workout by describing it

The owner's words: "I can type in the exercise that I did with the number of sets and reps from which
the AI will figure out the calories". Picking an activity gave a figure from a fixed table.

- The exercise sheet opens on a text field. "Work it out" sends the description and the owner's
  weight to Groq, and the model returns one item per exercise: name, what was done ("4 x 10 at
  60 kg"), the nearest app activity and intensity, minutes (given, or estimated from sets and rest,
  or from distance and pace), and a MET from the Compendium of Physical Activities. Sets, reps
  and load are kept when given.
- The model never gives calories. The app works them out: (MET − 1) × weight × hours, the same
  active-calorie rule as before, so every figure can be explained.
- The owner reviews the list before logging. Tapping an item lets them change the minutes (the
  calories follow at the same effort) or the calories, or remove it. Each item is logged as its
  own workout and synced to Health Connect under its name.
- "Pick an activity instead" keeps the old way for when there is no key or no signal. A logged
  workout opens in that editor, with its name and description, and keeps its MET until the
  activity or intensity changes.
- Data: `exercises` gains `name`, `details`, `sets`, `reps`, `load_kg` and `met`. Backups carry them;
  older backups without them still restore.

## Backup (Settings, "Your data")

- **Export backup**: one JSON file through Android's share sheet, holding entries, saved foods,
  exercises, weights and settings. Never the Groq API key.
- **Restore from backup**: pick a file, validate it fully before touching anything, confirm
  ("This replaces everything on this phone"), then replace all data in one transaction. A file that
  fails validation changes nothing and says why.
- Format: `{ app: 'calorie-tracker', format: 1, exportedAt, data: { entries, foods, exercises, weights, settings } }`.

## Not now

Voice logging (hidden behind `VOICE_LOGGING` until tested end to end), photo logging (the owner
found estimates from photos inaccurate), barcode scanning, water tracking, accounts or cloud sync.

Deferred from Progress, each with the reason:

- **Counting other apps' activity in Progress budgets.** Today reads a day's Health Connect
  activity live and does not store it, so Progress has no history of it. Storing each day's
  counted activity is a schema change. Until then Progress says what it leaves out (see Budget).
- **Workout days against rest days** ("on workout days you eat N kcal more"). It needs the same
  guard as the weekend comparison, and enough of each kind of day to pass it.
- **This period against the one before** (average intake, weight change, workouts). It needs
  the previous period's totals, which Progress does not load.

## Design

Today is modelled on Google Home's Favorites page; Progress and the sheets use the same language:
rounded tiles (20dp), one 28dp focal tile per screen, small section labels, colour only where it
carries meaning. Colours are the Android Material You scheme, plus three harmonised category
colours for protein, carbs and fat (`src/constants/category-colors.ts`). Charts are quiet: thin
axes or none, the system primary for data, the goal as a dashed line, real numbers in the text
beside the chart rather than crowded onto it. See `AGENTS.md` for the full design rules.

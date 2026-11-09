# Exam planner

How DeepHaus decides what to study before a dated exam. The code is `packages/scheduling/src/exam/`; it is pure, so the web server, the offline layers and the reminder scheduler all run the same functions.

Status (9 November 2026): the planner backs the Exams pages on web and phone, online and offline. The Home study button does not mix exam cards in yet, and there are no reminders.

## The idea

An exam has a date, a target recall (default 90%) and an optional daily time cap. It owns no card state. Every decision is derived from each card's real memory (`card_reviews`), using FSRS-7 to predict recall at two moments: now, and at exam time if nothing more is studied.

| Function | Answers |
|---|---|
| `examSnapshot` | Where do I stand? Recall now, recall at the exam, cards at target, stage. |
| `examQueue` | What should I study right now, in what order, and why? |
| `planExam` | What does each day until the exam ask for, and what would less time cost? |
| `nextTouchpoint` | When is the next session worth doing? |

## The policy

A card is studied for an exam only if it is predicted **below target at exam time**. Cards already safe are left alone. Among the rest:

1. **Learning steps.** A card just rated Again comes back when its step is due, as in regular study.
2. **Strengthen.** A seen card is ready once its recall *now* has faded to a gate. Far from the exam the gate is 70%, because a review at lower recall builds more lasting strength. Over the last 7 days the gate rises to the target, so gaps tighten as the exam nears.
3. **One pull per study day.** Until lock-in, a card is brought forward at most once per study day, which puts a night's sleep between its sessions.
4. **Lock-in (last 24 hours).** Every card below target is fair game. A card can come round again, but only after a gap of 30% of the time left (at least 10 minutes), so the last hours never collapse into drilling one card.
5. **New cards.** Spread evenly over the days before the last three, which are kept for relearning. With three study days or fewer left, every unseen card is offered at once.

Everything that is ready is ranked by one number: the **expected rise in exam-time recall per review**. When a time cap runs out, whatever is cut is what would have paid least, and `skipped` says how many were cut. Siblings of one note are kept apart, and new cards take turns between decks.

Easy days reduce a day's share of new cards. The study day starts at the user's rollover hour.

### Cards still on FSRS-6

FSRS-6 grades in whole days, so its stored recall is a step function. The planner reads the FSRS-6 curve by the hour instead (`packages/scheduling/src/memory.ts`), which is what the last day before an exam needs. Such cards move to FSRS-7 at their next review, as they do today.

## How the constants were chosen

No published scheduler optimizes recall on a fixed date under a time budget, so the policy was compared in simulation against the two obvious alternatives:

- **Plain FSRS** with desired retention set to the exam target, ignoring the date.
- **Old cram**: due cards, then unseen cards, then anything below target at the exam, once a day.

A simulated student (FSRS-7, default weights) forgets with probability `1 - recall`. Each policy gets the same session times. The numbers below are means of three seeded runs. "Recall" is mean predicted recall at exam time across all cards, unseen cards counting as zero.

### No time cap: recall reached, and minutes spent

| Deck | Exam in | Plain FSRS | Old cram | Exam planner |
|---|---|---|---|---|
| 200 new | 6 hours | 94.9% in 129 min | 94.6% in 144 min | 94.7% in 151 min |
| 200 new | 2 days | 94.2% in 165 min | 94.3% in 186 min | 94.0% in 168 min |
| 200 new | 7 days | 94.0% in 249 min | 93.6% in 290 min | 94.0% in 207 min |
| 200 new | 21 days | 94.2% in 322 min | 92.0% in 489 min | 95.0% in 241 min |
| 200 new | 56 days | 93.9% in 422 min | 90.9% in 952 min | 94.6% in 308 min |
| 100 new + 200 studied | 6 hours | 94.1% in 78 min | 94.1% in 75 min | 94.1% in 82 min |
| 100 new + 200 studied | 2 days | 94.1% in 108 min | 94.0% in 102 min | 93.8% in 97 min |
| 100 new + 200 studied | 7 days | 93.9% in 130 min | 93.4% in 179 min | 94.2% in 130 min |
| 100 new + 200 studied | 21 days | 94.3% in 241 min | 92.4% in 404 min | 95.2% in 182 min |
| 100 new + 200 studied | 56 days | 93.9% in 411 min | 91.4% in 940 min | 95.8% in 250 min |

### 20 minutes a day: recall reached

| Deck | Exam in | Plain FSRS | Old cram | Exam planner |
|---|---|---|---|---|
| 200 new | 6 hours | 24.0% | 24.0% | 26.0% |
| 200 new | 2 days | 57.8% | 57.4% | 76.5% |
| 200 new | 7 days | 89.3% | 90.1% | 93.5% |
| 200 new | 21 days | 94.4% (310 min) | 93.0% (373 min) | 94.9% (221 min) |
| 200 new | 56 days | 93.9% (422 min) | 92.0% (712 min) | 94.8% (291 min) |
| 100 new + 200 studied | 6 hours | 78.5% | 78.5% | 79.8% |
| 100 new + 200 studied | 2 days | 92.9% | 93.2% | 92.9% |
| 100 new + 200 studied | 7 days | 93.9% (133 min) | 93.8% (146 min) | 94.3% (120 min) |
| 100 new + 200 studied | 21 days | 94.3% (240 min) | 93.0% (315 min) | 95.4% (159 min) |
| 100 new + 200 studied | 56 days | 93.9% (411 min) | 92.5% (655 min) | 96.1% (215 min) |

### What the comparison shows

- **Three weeks or more out**, the planner reaches the same or higher recall in about 25 to 40% less time than plain FSRS, and in half to a quarter of the time of the old cram policy, which also ends about 3 to 4 points lower.
- **Short on time with a lot unseen** (all-new deck, 20 minutes a day, exam in 2 to 7 days), ranking by payoff is worth 3 to 19 points: the planner meets more of the deck instead of re-drilling part of it. On the mostly-studied deck at the same budget the three policies tie.
- **Hours to two days out with unlimited time**, the three are within a point of each other. There is nothing to win there except choosing the order, and on the all-new deck at 6 hours the planner spends about 20 minutes more than plain FSRS for the same mean recall.

### Two things the simulation changed from the original design

- **First-day repeats are off.** The plan called for a new card to be recalled three times on its first day (Rawson & Dunlosky 2011). In simulation that cost 18% (two recalls) to 38% (three) more study time for under half a point of recall, and under a time cap it lost several points by crowding out unseen cards. FSRS-7 predicts that a second look ten minutes later adds 2 to 5 points of exam-time recall for a new card, while a single review halfway to the exam adds 3 to 12. The knob is still there (`criterionNear`, `criterionFar`); the default is 1.
- **No separate "final pass" levelling.** Spreading last reviews backwards from the exam made no measurable difference, because the rising gate already brings the weakest cards forward first. It was removed.

### How sensitive the constants are

A one-at-a-time sweep (ten scenarios, three seeds each) shows the defaults sit in a flat region. Moving the gate floor between 60% and 80%, the ramp between 4 and 14 days, lock-in between 12 and 36 hours, the lock-in gap between 15% and 40%, or the reserve between 1 and 5 days changes mean recall by under 0.3 points and total time by about 5% or less, which is roughly the noise of three seeds. The one clear effect is the gate floor: at 90% (the target itself, so plain-FSRS timing) the same recall costs 23% more time than at 70%.

A floor of 60% was slightly cheaper still in simulation. 70% was kept as a judgment call: it is the lowest desired retention the app lets a student choose, and a lower gate means failing more reviews.

### Limits of this evidence

- FSRS-7 is both the simulated student and the planner's model, so the comparison cannot credit any effect FSRS-7 does not model. The first-day-repeat result in particular is the model's opinion, not a classroom finding.
- Default weights, two deck shapes, three seeds, and a student who follows the plan exactly.
- The first rating of a new card is drawn from fixed odds (24% Again, 9% Hard, 50% Good, 17% Easy).

## Running it

```bash
pnpm --filter @deephaus/scheduling test
```

```bash
EXAM_BAKEOFF_OUT=bakeoff-report.txt pnpm --filter @deephaus/scheduling bakeoff
```

```bash
EXAM_SWEEP_OUT=sweep-report.txt pnpm --filter @deephaus/scheduling sweep
```

The sweep varies one constant at a time and takes several minutes; `EXAM_SWEEP_ONLY=gateFloor,criterion` limits it. Change a default in `packages/scheduling/src/exam/policy.ts` only after the sweep and the bake-off agree.

## Speed

On an M-series laptop, for a 3,000-card exam two weeks out: the queue takes about 8 ms and a forecast without the time-versus-score curve about 1 second. The curve costs up to five more forecasts, so on a phone it should be computed on the server or on demand.

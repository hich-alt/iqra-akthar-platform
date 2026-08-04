# Future Roadmap
### Items deferred under Feature Freeze, awaiting Version 1.1+

Nothing is currently queued here — Feature Freeze was declared at the end
of an active UX-polish session, with no pending feature request in flight.
This file exists so the *next* one has a home immediately, rather than
being implemented under freeze by mistake.

## Process
Any request from this point forward that would add a new capability,
screen, table, or workflow — rather than fix, harden, or polish something
that already exists — gets:
1. Recorded here with a one-line description and the milestone/context it came from.
2. Assigned a tentative version (1.1 unless stated otherwise).
3. Declined for immediate implementation, with a pointer back to this file.

## Format for future entries
```
### [Feature name] — target v1.1
Requested: [date/context]
Description: [one paragraph]
Why deferred: [feature, not a fix — RC1 is frozen]
Dependencies: [any RC1 pieces this would build on]
```

## Known candidates not yet formally requested, worth tracking anyway
(Surfaced during RC1/Milestone work as "known limitations," not requests —
listed here only so they aren't lost, not because they're approved for v1.1.)

- Gamification (XP/levels/badges/achievements) — deliberately out of scope for v1.0 per the wellbeing-based decision already documented in `RELEASE_NOTES.md`.
- Student-visible ranking/leaderboards — same reasoning, same status.
- A real date-picker for "Reopen Homework" (currently a `window.prompt()` — functional, not polished; likely a v1.0 *polish* item rather than v1.1 *feature*, to be triaged when reached).
- Competency evaluation collection in the Correction Queue's grading form (currently defaults to empty).
- "Has viewed this lesson" tracking for students — the Hero Task's "new lesson" priority currently relies on `published_at` recency (3-day window) as a proxy, not actual view-tracking.
- Certificate/graduation-portrait generation pipeline integration with the main review workflow.
- Full retrofit of `query-cache.js` across the 7 hook files that don't yet use it.

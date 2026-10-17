# Game data

`mesbg-data.json` is generated from the [MESBG List Builder](https://github.com/mhollink/mesbg-list-builder-v2024) (AGPL-3.0) by `scripts/import-mlb-data.mjs`. Don't edit it by hand; re-run the script against a fresh clone of the list builder to update it:

```bash
git clone --depth 1 https://github.com/mhollink/mesbg-list-builder-v2024 ../mesbg-list-builder-v2024
node scripts/import-mlb-data.mjs ../mesbg-list-builder-v2024
```

What's copied: army lists, unit names and types, points, options, profile characteristics, Might/Will/Fate/Wounds, wargear, and the *names* of special rules. Rule descriptions are not copied.

Unit photos are not stored in this repository. The app shows them by linking to the list builder's own image host (`resources.mesbg-list-builder.com`), and you can turn them off in the Table panel.

As the list builder's NOTICE says, names, statistics, rules and images relating to the Middle-earth Strategy Battle Game remain the property of their rights holders (Games Workshop and Middle-earth Enterprises). They are not licensed under the AGPL. This is an unofficial fan project.

## scenarios.json

Deployment zones, objective positions, game-end conditions and scoring for the 24 matched play
scenarios of the 2024 edition, recorded as game facts and summarised in our own words. No text,
maps or images from Games Workshop's Matched Play Guide are included. Where the players choose
corners or which edge is north, the zones show one example layout.

## special-rules.json

Short summaries of the generic special rules (Terror, Fly, Hatred and so on), written in our own words as table reminders. Rules taking a bracketed value, such as Hatred (Rohan), are stored under the name without the brackets. No text from Games Workshop's books is included; the army books and Rules Manual have the full rules.

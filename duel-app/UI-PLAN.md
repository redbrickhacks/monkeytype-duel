# Monkeytype Duel UI fidelity plan

## Objective

Keep the lightweight Pages client and VPS backend, L/R public GitHub registration,
practice flow, duels, leaderboard, and spectator view. Bring the small interaction
details closer to the Monkeytype source already present in this repository.
No framework migration or import of the original application's backend stack.

## Reference and current gaps

Use `frontend/src/styles/caret.scss`, `frontend/src/styles/commandline.scss`,
`frontend/src/ts/test/caret.ts`, and `frontend/src/ts/utils/caret.ts` as the primary
references. Retain the original bundled Roboto Mono and Lexend Deca fonts and logo.
The current client recreates all letters/carets with innerHTML on each key and
snapshot; its CSS transition cannot interpolate between persistent caret nodes.
It also uses character wrapping, an Escape blur action, and a nonpersistent theme
toggle. Spectator text currently falls back to practice text instead of race text.

## Rendering and typing surface

1. Mount a typing surface once per practice or race identity. Update letter classes,
   statistics, timer, and caret positions in place. Snapshot updates must preserve
   registration input, menu search, typing focus, and the mounted race DOM.
2. Render words as unbroken inline groups while preserving a flat character index
   compatible with existing scoring and progress messages. Use a three-line viewport
   with Monkeytype's restrained spacing and approximately 1.5rem default text.
3. Render local caret and both ghost carets as persistent absolute elements. Animate
   transforms for ordinary movement with a short duration (about 80ms default).
   Snap/reset at a new test; avoid long diagonal travel on line changes. Keep geometry
   correct on backspace, line wrap, resize, font load, and preference changes.
4. Scroll by completed lines, keeping the active line comfortably in view. Movement
   must not cause page scroll or lose a key. No layout measurement for every letter
   per key: measure the active letter and cache element references.
5. Blink while idle, hold the caret steady while typing, and respect reduced motion.
   Ghost labels should be subdued and readable without covering the next word.
6. Use one owned animation loop, cancel it on route/test transitions, and stop input
   exactly at the local deadline even before a final server snapshot arrives. Sending
   finish is idempotent; stale practice state must not accept keys on result screens.
7. Spectators render the server's race text, both live carets, and progress statistics.
   Practice never displays an opponent caret on unrelated practice text.

## Visual details

- Preserve Serika Dark as the default, original logo geometry and font weights, with
  `duel` using the same wordmark font. Use consistent small inline SVG icons instead
  of platform-dependent chess glyphs.
- Refine max width, header/footer alignment, muted labels, keycap hints, button hover
  states, rounded corners, and hierarchy against the local Monkeytype styles.
- Make active typing visually quiet; subdued header/footer, simple timer above words,
  and compact live information. Restore navigation on focus loss or menu opening.
- Focus loss should show a subtle blur and click-to-focus prompt. Opening the menu
  blocks test input; closing it restores appropriate focus without typing the closing
  key. No timing advantage from focus loss.
- Keep registration and results responsive at 375px, and keep long GitHub names from
  breaking cards, rows, or ghost labels. Retain accessible focus outlines and labels.

## Escape command menu

Implement a dedicated module with a persistent modal outside the race view. Match
Monkeytype's approximately 600px panel near the upper center, dimmed backdrop,
minimal search field, compact rows, strong active-row highlight, and key hints.

- Escape opens the menu; Escape closes it (or returns from a submenu consistently).
- Search filters commands by name and relevant aliases. Support ArrowUp/Down, Enter,
  mouse selection, nested categories, back navigation, and a clear empty state.
- Use a modal dialog with a labelled search/combobox and active option semantics.
  Trap Tab focus, restore the previous focus, and prevent background typing or clicks.
- Keep search and selection stable across server snapshots. Menu typing must never
  emit race progress. The race clock continues and results can arrive behind the menu.

## Competition-safe command inventory

| Category | Allowed options/actions | Restrictions |
| --- | --- | --- |
| Theme | Curated original palettes: Serika Dark, Serika, Dracula, Nord, Terminal, light theme | Use source theme values; presentation only |
| Font size | 1, 1.25, 1.5, 2rem | Same text and timing |
| Caret style | line, block, outline, underline | Never changes input semantics |
| Smooth caret | off, fast, medium, slow | Motion only; default medium |
| Smooth scrolling | on/off | Same words and viewport progression |
| Live information | show/hide own WPM and accuracy | No computed assistance or target pace |
| Ghost display | show/hide opponent caret and labels | Public opponent progress only |
| Focus appearance | focus blur and quiet interface preferences | Clock never pauses |
| Motion | system preference / reduced motion | Disable movement and blink when reduced |
| Navigation | leaderboard/spectate; return to station | Disable leaving own active countdown/race |
| Station | ready/unready, leave/change station, rematch | Only when valid for current phase |
| Help | keyboard shortcuts, competition rules | Informational |
| Preferences | restore visual defaults | Does not erase profile, results, or station |

Exclude duration/language/word-list changes, punctuation/numbers, difficulty, stop on
error, confidence mode, freedom mode, input assistance, pace targets, funboxes,
restart/skip during a live race, and anything altering result eligibility. Locked
competition parameters can be explained in a small rules view, not fake controls.

Store a versioned, validated preferences object in localStorage with safe fallback
for malformed data or unavailable storage. Apply preferences before first paint where
practical. Settings modules must not send gameplay messages. Do not add external
font/CDN dependencies. Themes should be a small curated subset, not hundreds of assets.

## Keyboard policy

Keep ordinary characters and Backspace under the existing competition scoring rules.
Escape is the command menu; Tab+Enter remains ready-again on results and must not
restart or change an active race. Do not add bulk deletion or other input behavior
changes as cosmetic preferences. Form fields, buttons, and the menu must not leak
keypresses into the typing session. Ignore composition events and clipboard insertion
into a live test; do not convert paste into synthetic keypresses.

## Implementation structure

Use small client modules for preferences/theme tokens, command definitions/menu,
and the persistent typing renderer. Keep main.ts responsible for connecting state,
routes, and lifecycle. Make changes on the existing fork branch. Scope backend
changes to a demonstrated UI integration necessity; preserve the wire protocol.

## Acceptance and verification

1. Parent lint, both TypeScript configurations, relevant unit tests and production
   build pass. Add focused tests for preference validation and menu availability or
   lifecycle logic, not assertions that merely repeat CSS values.
2. Browser checks: registration selection/input survives another client's updates;
   typing letters and caret node identities survive keystrokes and snapshots; smooth
   motion works over words and line wraps; backspace and resize remain aligned.
3. Menu checks: Escape/search/arrows/Enter/back, mouse, empty results, focus trapping,
   persisted settings after reload, reduced motion, and no typing behind the menu.
4. Duel checks: live countdown and deadline continue with menu open; navigation and
   restart remain unavailable during the race; result/rematch work; spectator sees
   correct words and both carets; practice does not show unrelated ghosts.
5. Inspect desktop and 375px screenshots and browser console. Verify production
   build size stays lightweight and explain any material increase.
6. GPT-5.6 implements and performs local checks. Primary agent reviews changes and
   verifies the built UI before deploying through the existing Pages workflow.
   Do not merge upstream or alter production during the implementation handoff.

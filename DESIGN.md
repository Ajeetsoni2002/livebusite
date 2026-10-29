# BUIT Papers — Exam Hall

Exam Hall (October 2026) replaces the Nebula glass/neon theme with the objects of an exam hall. Light mode is an **answer sheet**: cream paper, faint ruled lines, a red margin, blue-ballpoint primary, red-pen marks and yellow highlighter. Dark mode is a **blackboard**: green-black slate with chalk white, chalk yellow and red chalk. Physical objects — question papers, sticky notes, the pay-order cheque, the notes notebook — keep their real colours in both themes, so their text colours are fixed rather than themed. On a first visit the theme follows the operating system (`prefers-color-scheme`); the navbar button saves an explicit choice locally, synchronizes it across tabs, and `public/theme.js` applies it before CSS paints.

## Foundations

Semantic tokens live in `frontend/src/styles/tokens.css` (dark) and `frontend/src/styles/light.css` (light). `frontend/src/styles/examhall.css` is loaded last and holds the theme: ruled canvas, typography, controls, masthead, hero, sticky notes, question headings, statement of marks, cheque, paper cards, notebook band, footer and responsive rules. The older `styles.css`, `solar.css` and `nebula.css` still provide layout and staff rules underneath it.

| Role | Dark (blackboard) | Light (answer sheet) |
| --- | --- | --- |
| Canvas `--ink` | `#17211C` | `#F3EEE2` |
| Surface | `#1E2B25` | `#FFFDF8` |
| Raised | `#283830` | `#EBE4D2` |
| Text | `#EEF1E8` | `#1A1D26` |
| Secondary text | `#B3BDB0` | `#57534A` |
| Primary | `#F3DC6B` chalk yellow | `#1F3EA8` ballpoint blue |
| Accent | `#FF958A` red chalk | `#B82424` red pen |
| Highlight | `#F3DC6B` | `#FFE766` |
| Success / Warning / Error | `#8FE0A8` / `#F3C96B` / `#FF958A` | `#1B6B3A` / `#8A5A00` / `#B4232F` |

Every text token meets WCAG AA (4.5:1) on canvas, surface and raised in its theme; control borders meet 3:1. Branch colours are unchanged from Nebula.

- **Type:** Instrument Serif (regular + italic) for headings, like a printed paper; Manrope for body and controls; IBM Plex Mono 500 for codes, roll numbers and labels; Caveat for red-pen marks and sticky notes. All are local Latin WOFF2 files with OFL licences in `frontend/public/fonts`; only Instrument Serif and Manrope are preloaded. `font-synthesis: none` stops faux bold on the single-weight serif.
- **Shape:** 4 px controls, 6 px cards, 3 px paper cards; paper shadows instead of glows. No glass blur, aurora, 3D tilt or cursor glow.
- **Signature pieces:** the hero answer sheet (exam header, hand-filled roll number, `Note:` line, red-pen underline that draws in, OMR bubbles that link to branches, a red `100/100` score), the desk with a stapled real paper, an EXAM READY stamp and a pencil; sections numbered as questions (`Q.1`…); a "Statement of marks" stats row; and "END OF QUESTION PAPER" in the footer.

## Contributor earnings promotion

Contributors earn ₹15 (`RATE` in `frontend/src/lib/earn.ts`, `RATE_PER_UPLOAD` in `backend/src/modules/earnings.ts`) for every approved paper or note. The offer appears in the ribbon above the masthead, the "Earn ₹15" nav item, the hero sticky note, the home pay-order cheque with its earnings calculator, a sticky note in each catalog results page and in empty states, the paper detail sidebar, the notes band, the leaderboard, About/Contact, the footer, a floating note after scrolling (closing it hides it for three days) and the toast after a download. Contributor and staff areas never show the ribbon or floating note. Contributors see their earnings at `/contributor/earnings`; admins record payments at `/admin/payouts`.

## Components

- `Layout`, `Footer`, and `ThemeToggle`: navigation, route entry, modal focus handling, theme persistence, credits, and archive/community/takedown links.
- `Hero`: the answer sheet and desk described above, with the latest real paper thumbnail, actual search examples and branch links.
- `Explore`: branch identities, exact published-paper totals, semester shortcuts, and the Branch → Semester → Subject finder. Changing upstream selections clears dependent values.
- `SearchBox` and `CommandPalette`: debounced suggestions and grouped Papers / Notes / Branches; keyboard navigation, stale-result guards, and stable selected identity.
- `ContentCard`, `PdfThumbnail`, `QuickPreview`: a prominent first-page thumbnail, semantic detail link, separate action buttons, lazy PDF dialog, image fade, and failure fallback. Touch users always see the actions; desktop hover/focus reveals them.
- `Browse`: one implementation for paper, branch, subject, and notes catalogs. Filters stay in the URL. Mobile filters collapse; active chips remain removable. A collapsible subject directory keeps results close to the top.
- `Detail`: opt-in PDF preview, prominent mobile download, desktop metadata sidebar, related papers, reports, and sanitized Markdown.
- `NotesShowcase`: a cream notebook composition; genuine contribution prompts when notes are empty.
- `SubjectTicker`, skeletons, error/retry, empty, saved-library, and 404 states complete the public experience. Staff screens share the typography, theme tokens, and controls.

## Motion and accessibility

Control feedback is 150 ms, hover 240 ms, and entry/reveal 360 ms with `cubic-bezier(.22,1,.36,1)`. Desktop parallax is bounded to a few pixels. The cursor glow and magnetic buttons are optional, idle-loaded, and use animation frames rather than React pointer-state updates. The slow ambient grid and subject ticker are separate from control feedback; ticker motion pauses on hover/focus and has a pause button. On phones it becomes a manually scrollable strip.

**Opening intro.** Every load of `/` (including refresh, never other routes) opens with "The Exam Archive Opens" (~6.5 s): split-flap years and subjects, an OMR sheet whose bubbles spell the site name, an "EXAM READY" stamp, and the paper tearing open onto the rendered home page. It is a framework-free module in `frontend/src/intro/` (text in `config.ts`, all classes prefixed `pq-`), started from `main.tsx` before React renders; `public/theme.js` hides the prerendered page until it mounts (8 s failsafe). Sound is synthesized with Web Audio: while the browser blocks audio a "TAP FOR SOUND" pill shows and the first click only unlocks sound; afterwards a click, Esc or Enter skips to the tear. The sound choice is saved locally. Scroll and focus are locked while it covers the page, and the WebGL hero pauses. Reduced motion gets a short name-only fade.

`prefers-reduced-motion` disables CSS animation/transitions, parallax, count-up, automatic ticker movement, and optional effects. No content depends on motion. Save-Data and low-core devices skip optional enhancement modules. Effects do not replace the system cursor.

Controls retain visible focus, keyboard operation, and semantic labels. The search dialog traps only enabled, visible, tabbable controls; native `<dialog>` handles the quick-preview modal. Cards never nest buttons inside links. Branch/semester menus and all quick actions work with touch or keyboard. Screenshots and automated accessibility results cover both themes at narrow and desktop widths.

## Data and performance rules

Backend routes/contracts are unchanged. Branch totals use the existing filtered paper-list metadata and wait until the branch section approaches the viewport. The finder uses existing taxonomy. Palette groups use existing paper/note endpoints so the saved snapshot continues to work. Downloads use the existing POST endpoint with a fresh idempotency key per explicit action; previews and thumbnails do not count as downloads. Saved-library cards disable server-dependent actions.

Zero headline metrics and an all-zero popularity rail are hidden. The notes area invites contributions instead of fabricating examples or counts. Existing source metadata is displayed honestly, including unverified exam/session values.

There is no WebGL or new animation dependency. The previously unused Framer Motion dependency was removed. Staff analytics, Markdown rendering, command search, PDF preview, and optional effects remain separately loaded. Keep future enhancements behind the same mobile, reduced-motion, and data-saving boundaries.

## Verification and artifacts

- Run the app with the existing `npm run dev` (the configured database must also run).
- Run `npm test`, `npm run lint`, and `npm run build` from the root.
- `scripts/design-interactions.mjs` checks palette, finder, card actions, URL filters, theme persistence, focus wrapping, empty search, and delayed-result selection.
- Existing `scripts/browser-smoke.mjs` checks staff roles, password change, contribution/moderation, safe Markdown, outage recovery, PDF previews, and legacy links with temporary local fixtures.
- `scripts/design-accessibility.mjs` records WCAG A/AA checks and overflow for both themes at 360 and 1440 px.
- `scripts/design-capture.mjs` captures 390/1440 screenshots. `docs/design/index.html` presents before/after comparisons.
- `docs/design/performance-before.json` and `performance-after.json` record the same local production Lighthouse mobile audit and compressed entry assets. These are lab measurements, not field guarantees.

Credentials are not stored in this document, screenshots, or committed application files. Administrative login remains `/admin/login`.

## Measured production performance

Same local Lighthouse mobile configuration, before and after:

| Metric | Before | After |
| --- | ---: | ---: |
| Performance score | 96 | 76 |
| Largest contentful paint | 2.47 s | 3.56 s |
| Total blocking time | 103 ms | 511 ms |
| Cumulative layout shift | 0 | 0 |
| Entry JS + preloads, gzip | 121.11 KB | 126.34 KB |
| CSS, gzip | 7.58 KB | 16.42 KB |

Accessibility, best practices, and SEO scored 100 in both audits. The after build additionally loads 47.12 KB of local fonts and the 544-byte theme script. Entry totals exclude lazy route/enhancement chunks and content images.

**Open performance limitation:** the requested mobile score of 85+ and LCP below 2.5 seconds were not reached. The final run measured the hero heading as LCP; initial rendering and main-thread work need further optimization. Removing initial route animation, simplifying the grain texture, and deferring finder taxonomy did not bring this measurement within target. No performance success is claimed.

Final verification: 33 tests passed, both workspaces passed lint and build, staff browser smoke passed, and all eight design interaction scenarios passed. The accessibility matrix found no violations or horizontal overflow across six routes, two themes, and two widths (24 cases).

## Nebula measurements (October 2026)

Local production preview (`vite preview` + read-only proxy to the live API), Lighthouse 12 default desktop and mobile configs, one run each:

| Route | Desktop perf | Mobile perf | Accessibility | Best practices | SEO |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | 92 | 87 | 100 | 96 desktop / 100 mobile | 100 |
| `/papers/` | 100 | 89 | 100 | 100 | 100 |
| `/contributors/` | 100 | 96 | 100 | 100 | 100 |

Desktop best practices on `/` lose points for console errors from legacy-paper thumbnails that return HTTP 500 from the live API (their thumbnail objects are missing in storage; new uploads are fine) and for intentionally disabled source maps. The three.js hero chunk (~134 kB gzip) loads only on wide, fine-pointer devices without reduced motion or Save-Data, after first paint. Mobile LCP (~3.3 s on `/`) remains above 2.5 s.

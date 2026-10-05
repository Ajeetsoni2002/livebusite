# BUIT Papers — Nebula

Nebula (October 2026) re-themes the Solar Archive layout: a deep-navy dark mode with neon cyan/violet accents and glass chrome, and a cool frosted light mode where glows become soft colored shadows. Both themes share typography, layout, component structure, and interaction rules. On a first visit the theme follows the operating system (`prefers-color-scheme`); the navbar button saves an explicit choice locally (storage wrapped in try/catch), synchronizes it across tabs, and `public/theme.js` applies it before CSS paints.

## Foundations

Semantic tokens live in `frontend/src/styles/tokens.css`; light overrides live in `frontend/src/styles/light.css`. Component styling lives in `frontend/src/styles/solar.css`; the site-wide futuristic layer (aurora canvas, glass chrome, focus glow, micro-interactions, tilt, toasts, confirm dialog) lives in `frontend/src/styles/nebula.css`, loaded last. The original `styles.css` retains shared layout and staff form/table rules. Component CSS uses tokens (or `color-mix()` of tokens) instead of brand hex values.

| Role | Dark | Light |
| --- | --- | --- |
| Canvas `--ink` | `#070B16` | `#EEF2F8` |
| Surface | `#0E1424` | `#FFFFFF` |
| Surface elevated `--raised` | `#172036` | `#E2E8F2` |
| Glass | `#111A2ECC` | `#FFFFFFB8` |
| Text | `#E8EEFB` | `#0E1628` |
| Secondary text | `#9BA8C4` | `#475369` |
| Primary (cyan) | `#5EE1FF` | `#0B6E8C` |
| Accent (violet) | `#B39DFF` | `#6A3FD1` |
| Control boundary | `#66749A` | `#6F7B92` |
| Success / Warning / Error | `#6EE7B7` / `#FFCF70` / `#FF8FA3` | `#0B6B4A` / `#8A5A00` / `#B4232F` |

All text tokens meet WCAG AA (4.5:1) against canvas, surface and raised surfaces in both themes; control borders meet 3:1.

Branch colors use stable codes, never array position. CSE is lime/olive, ECE lilac/purple, IT mint/teal, EE amber/ochre, ME coral/rust, and CE blue. Each has a distinct Lucide icon and darker daylight token for contrast. Text and icons accompany color everywhere.

- **Type:** Space Grotesk for display; Manrope for body and controls. Locally hosted Latin variable WOFF2 files total 47.12 KB. Both are preloaded, use `font-display: swap`, and retain their OFL licenses in `frontend/public/fonts`. System fallbacks are declared.
- **Scale:** display approximately 40–78 px; section 28–42 px; resource heading 21–22 px; body 14–16 px; compact metadata 10–13 px. Numbers use tabular figures. Mobile form inputs are 16 px.
- **Spacing:** 4, 8, 12, 16, 24, 32, 48, 64, and 96 px tokens. Public content has a maximum 1280 px inner width, with 20 px mobile gutters.
- **Radius:** 10 px controls, 18 px shared cards, 20 px branch cards, 24 px finder/dialog, 28 px feature panels.
- **Elevation:** `--shadow-1/2/3` (card uses 2, floating panels 3); light mode uses soft navy-tinted shadows. Focus = 2 px primary outline plus `--glow-focus` ring.

## Components

- `Layout`, `Footer`, and `ThemeToggle`: navigation, route entry, modal focus handling, theme persistence, credits, and archive/community/takedown links.
- `Hero`: real archive paper thumbnail and metadata, actual search examples, CSS paper stack, nonzero stats. `PaperParallax` is idle-loaded only for suitable desktop devices.
- `Explore`: branch identities, exact published-paper totals, semester shortcuts, and the Branch → Semester → Subject finder. Changing upstream selections clears dependent values.
- `SearchBox` and `CommandPalette`: debounced suggestions and grouped Papers / Notes / Branches; keyboard navigation, stale-result guards, and stable selected identity.
- `ContentCard`, `PdfThumbnail`, `QuickPreview`: a prominent first-page thumbnail, semantic detail link, separate action buttons, lazy PDF dialog, image fade, and failure fallback. Touch users always see the actions; desktop hover/focus reveals them.
- `Browse`: one implementation for paper, branch, subject, and notes catalogs. Filters stay in the URL. Mobile filters collapse; active chips remain removable. A collapsible subject directory keeps results close to the top.
- `Detail`: opt-in PDF preview, prominent mobile download, desktop metadata sidebar, related papers, reports, and sanitized Markdown.
- `NotesShowcase`: a cream notebook composition; genuine contribution prompts when notes are empty.
- `SubjectTicker`, skeletons, error/retry, empty, saved-library, and 404 states complete the public experience. Staff screens share the typography, theme tokens, and controls.

## Motion and accessibility

Control feedback is 150 ms, hover 240 ms, and entry/reveal 360 ms with `cubic-bezier(.22,1,.36,1)`. Desktop parallax is bounded to a few pixels. The cursor glow and magnetic buttons are optional, idle-loaded, and use animation frames rather than React pointer-state updates. The slow ambient grid and subject ticker are separate from control feedback; ticker motion pauses on hover/focus and has a pause button. On phones it becomes a manually scrollable strip.

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

# Solar Archive implementation

Approved: concept A, 2026-10-04. The user's Phase A/B brief and approved in-chat design govern this work.

Implementation stays in the existing workspace: the MERN app is entirely untracked and the supplied environment protects Git metadata. No staging, commits, pushes, or deployment. Existing backend contracts, authorization, PDF handling, and archive remain intact.

Verification: build frontend and capture/review 390px + 1440px after every numbered step. Capture all five public page types before/after. Final checks include 360px, keyboard/touch, reduced motion, real route/filter/download behavior, staff smoke checks, test suite, lint, and Lighthouse.

Pre-flight: shared tokens feed all components. Branch and finder use existing taxonomy endpoints; counts use filtered paper totals. Card actions reuse current preview/download contracts. Palette uses existing search and branches, including saved-library fallback. Staff workflows retain their current handlers.

1. Design tokens — complete
2. Global layout/navbar — complete
3. Home hero — complete
4. Branch section and finder — complete
5. Paper cards — complete
6. Listings/filters — complete
7. Paper detail — complete
8. Notes — complete
9. Footer and feedback states — complete
10. Polish and final verification — complete

Ruling: use visual verification for presentation-only changes; add behavioral regression checks for new interactions, rather than tests that merely assert CSS constants.

Step 1 complete: tokens, local Latin variable fonts, shared type/buttons/surfaces. Build passed; 390/1440 screenshots reviewed, no overflow/errors. Remaining navy component rules will be replaced with each component stage. Baseline Lighthouse: performance 96, accessibility/best practices/SEO 100; LCP 2.47s, CLS 0.

Step 2 complete: warm translucent navbar, touch navigation, platform shortcut, grouped command search, route entry, scroll lock and background inertness. Build and 390/1440 screenshots passed. Palette regression failed before implementation and passes after keyboard navigation check. Search groups use separate existing papers/notes endpoints so saved snapshot behavior remains valid.

Step 3 complete: real PDF paper-stack hero, real search examples, lazy desktop parallax/static mobile fallback, nonzero animated stats. Build and 390/1440 screenshot reviews passed. Mobile scene intentionally crops the decorative paper stack; search stays above it.

Step 4 complete: bento finder, stable branch identities, deferred exact counts, hover/tap semester shortcuts. Build, 390/1440 captures and finder/branch navigation regression passed. Regression caught hover opening a disclosure before a narrow-screen click; hover is now desktop-only.

Step 5 complete: prominent paper thumbnails, image fade, semantic card links plus separate preview/download buttons, lazy native-dialog PDF preview, reusable idempotent download action. Build and home/listing screenshots reviewed. Cards regression passes preview/no-download-side-effect, Escape/focus restore, failed-download retry state. Most-downloaded rail is data-gated rather than ranking all-zero papers.

Step 6 complete: mobile filter disclosure, active chips, warm search/controls, colored branch header, semester tabs, collapsible subject directory. Build, branch/listing screenshots at both sizes and URL persistence/reset regression passed. Added explicit accessible filter names after the browser check exposed ambiguous wrapping labels.

Step 7 complete: reading-room preview, prominent mobile download, sticky desktop metadata, warm resource context. Build and detail screenshots passed at both widths. Shared download helper preserves existing POST/idempotency/signed-URL contract. PDF remains unloaded until requested.

Step 8 complete: cream notebook showcase, distinct notes catalog introduction and contribution-focused empty states. Existing PDF/Markdown note routes remain shared. Build and home/notes captures reviewed at both widths; no overflow/browser errors.

Step 9 complete: footer library/community/takedown links, branded 404, clear error/retry and notes-empty states, card skeletons, warm staff controls. Build and home/notes screenshot reviews passed. Existing archive crest and community credits preserved.

Step 10 implemented: ambient/reduced-motion polish and persistent light mode; first-paint theme initialization; keyboard focus and delayed-search regressions fixed after independent review. Tests (33), lint, build, staff smoke and all eight design interaction scenarios passed. Both-theme accessibility matrix passed all 24 cases. Final dark/light screenshot gallery: docs/design/index.html.

Performance exception remains open: final mobile Lighthouse 76, LCP 3.56s, CLS 0. Accessibility/best practices/SEO 100. See DESIGN.md for comparison and measurement limitations.

A separate local admin was provisioned and verified through the real login form; password change is required at first sign-in. Existing owner credentials were preserved. Secrets are excluded from these documents.

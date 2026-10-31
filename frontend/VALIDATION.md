# Frontend implementation validation — 31 October 2026

All application/configuration/test source was authored in this repository during this session. The approved static assets and bilingual/fixture catalog data were reused. Original preparation documents were preserved. Only `frontend/` is staged in implementation commits on `feature/frontend`.

## Executed checks

| Check | Actual result |
| --- | --- |
| Strict TypeScript | Passed |
| Production build | Passed, Vite 6.4.5 |
| Full development regression suite | 25 passed before the final history fix; includes domain, complete journey, responsive, interaction, and capture tests |
| Final history fix and affected regression checks | 6 passed: new refresh/history test plus journey, failed drafts, stale session, and mobile/desktop captures |
| Live-mode HTTP integration with intercepted responses | Passed bearer headers, named envelopes/paths, backend failure without fixture fallback, wrong-owner rejection without data loss, explicit save, BLOCKED live map, and 15-second timeout |
| Explicit production mock configuration | Build rejected as required |
| Production artifact scan | No emitted mock-server/test-account chunk or development token/fixture markers |
| Dependency install audit | 0 vulnerabilities reported by npm at installation |

There are 26 distinct development tests after adding the history case. The complete 26-test command was not rerun redundantly: the full 25-test run passed, then every affected check and the new test passed after the final change. HTTP tests use synthetic intercepted responses and a synthetic auth adapter; they do not verify a real backend.

Responsive checks assert no root horizontal overflow, fixed bottom navigation, Library column count, and Map heights at 320, 390, 600, 601, 699, 700, 768, and 1280 pixels. Vietnamese delivery labels fit at 320 pixels; local fonts are loaded. Fresh screenshots cover guest/extracted Discover, Profile, Library, Map, Ask, and Memory at 390 and 1280 pixels. Visual inspection against final kit references informed refinements; no pixel-perfect numerical match is claimed.

## Preserved behavior

- Ordered user/video/restaurant identities; numeric saved state; explicit idempotent saving and tuple-only unsave; shared source/transcript preservation.
- Guest authentication gate before nonempty URL validation; transactional duration/food/owner checks; 300 seconds accepted, 301 rejected; no auto-save or metadata endpoint.
- Clipboard fills without submitting and ignores stale reads. Discover session context restores across in-app navigation, not hard reload.
- Library accent folding searches name/dish/address/title/note and excludes transcript. Clear filters retains category. Edits use a per-user effective overlay; maximum-price changes show the documented BLOCKED error.
- Confirmed-address lifecycle; GPS denial preserves endpoints; independent Map radii; exact 5 km expansion; illustrative L corridor; deep-linked unsaved records do not become saved.
- Saved-only deterministic development chat; synchronous duplicate guard; immediate input clearing; exact failed-draft recovery; stale session suppression; session/history persistence.
- Browser-local Memory seed once, explicit remember creation, normalized dedup, confirmed stored deletion, and account-specific storage. Panel has no manual creation/edit controls.

## Remaining integration and verification dependencies

1. Backend owner supplies the API origin, deployed endpoints, CORS behavior, and actual error envelopes. Validate real analysis/Ask responses and source projection hydration before claiming live AI functionality.
2. Auth owner supplies the real Firebase/Google adapter and confirms how auth UID maps to backend `profile.user_id`. No Firebase project credentials or SDK-backed sign-in are included.
3. Live address search/reverse geocoding, routing/maps, and Memory/agent contracts remain unspecified and BLOCKED. Development counterparts are explicitly bounded demos.
4. Live chat-history retrieval has no declared endpoint; do not invent one. Development history persists in per-user browser storage.
5. Physical iOS keyboard/zoom/safe areas, actual GPS acquisition, all 100 catalog cases individually, exhaustive storage failure injection, every breakpoint edge, and a numerical image diff remain unverified.
6. Image redistribution rights and any legacy browser-storage shape migration require independent confirmation; no earlier project source or storage schemas were accessed.

See [README](README.md) for startup, environment variables, contracts and the demo journey. Temporary test servers are stopped at handoff; run `npm run dev` to start the local demo.

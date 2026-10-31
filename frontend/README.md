# WeEat AI frontend

Newly authored React 19 / TypeScript / Vite implementation. The preparation package at the repository root is preserved. Work stays on `feature/frontend`; the backend is a separate integration.

## Run

```powershell
cd frontend
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. Development without an API base uses explicitly labeled local mock transport. Sign in with the sample account, select a home suggestion (try **Le Loi**), save the profile, and use the sample tour. All extracted places begin unsaved.

```powershell
npm run typecheck
npm run build
npm test
```

Tests use installed Chrome by default. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` for another installation. Start the development server before `npm test`. Generated traces/screenshots are in ignored `test-results/`.

For intercepted HTTP integration tests, start another dev server on port 5174 with `VITE_API_MODE=live` and `VITE_API_BASE_URL=http://127.0.0.1:5174`, then run `npm test -- --config playwright.live.config.ts`. These tests intercept `/api/` responses locally; they do not contact or certify a real backend. See [VALIDATION.md](VALIDATION.md) for actual check results and remaining verification limits.

## Live integration

Set these in your local environment (never commit secrets):

```text
VITE_API_MODE=live
VITE_API_BASE_URL=https://your-backend-origin
VITE_ENABLE_TEST_AUTH=false
```

The base is the origin/prefix **before** `/api`. Production always uses live transport, and builds reject explicit mock or test-auth flags. A production build can compile without a backend base, but private requests will report an unconfigured service. There is no live-to-mock fallback.

The authentication owner must register an `AuthAdapter` through `configureAuth` in `src/services/auth.ts` at bootstrap. The adapter supplies `currentUser`, `subscribe`, `signIn`, `signOut`; users supply `uid`, `email`, and a fresh `getIdToken`. No Firebase project or credentials are included. Confirm the authenticated identity and backend `profile.user_id` mapping with the backend owner before enabling a real account.

`src/services/api.ts` is the centralized typed facade; `apiClient.ts` owns fetch, bearer headers, JSON errors, cancellation, and the 15-second timeout. `contracts.ts` validates responses before provider updates. The exact supplied operations/envelopes are retained:

| Method | Path | Response envelope |
| --- | --- | --- |
| POST | `/api/analyze` | `video`, `restaurants` |
| GET | `/api/library?q=&cate_id=` | `restaurants` |
| PUT / DELETE | `/api/library/{video_id}/{restaurant_id}/save` | numeric `is_saved` |
| PATCH | `/api/library/{video_id}/{restaurant_id}` | `restaurant` |
| POST | `/api/ask` | `session_id`, `answer`, `references` |
| GET | `/api/categories` | `categories` |
| GET / PATCH | `/api/profile` | `profile` |

Edit bodies use `{ edits: { restaurant_name, dish, price_vnd, address, user_note } }`. Profile properties are top-level. All private requests carry a fresh bearer token. Library/source projection fields need to include the original URL/title/transcript when the source was saved in an earlier session; no metadata endpoint is invented.

## Deliberate integration boundaries

- Real extraction and Ask responses require the teammates' backend. Development extraction selects approved fixture data; development chat performs deterministic retrieval over saved entries, with no model call.
- Live Firebase auth needs an adapter. Live geocoding, routing, and Memory have no supplied HTTP contracts and report BLOCKED. The development map is illustrative SVG with haversine/corridor filtering, not road navigation.
- Development Memory is account-specific browser storage; explicit chat remember requests create notes, and the UI only views/deletes. It is not a live agent memory system.
- Local test username/password accounts appear only under development + mock + `VITE_ENABLE_TEST_AUTH=true`. They are browser-local, use salted password hashes, and have no universal password.
- Exactly 300 seconds passes extraction; only durations above 300 fail, as explicitly finalized in the kit.
- Maximum-price edits remain visibly blocked. Clear Library filters retains category. Discover result/source/scroll restoration is in-app only; a hard reload intentionally loses the current extraction panel.

## Demo journey

Sign in → select home → analyze sample → inspect source and unsaved results → save all → Library accent-insensitive search → details/transcript → Map destination → Ask “Find the phở place with free quẩy.” → “Remember that Kien dislikes fish” → Memory confirmation/delete → Discover restored.

Physical iOS keyboard/zoom behavior, actual GPS, real backend/CORS/token exchange, Firebase, live location and live agent integrations require event verification. Browser tests do not certify them. Visual comparisons use supplied final captures and local fonts; no pixel-perfect score is claimed.

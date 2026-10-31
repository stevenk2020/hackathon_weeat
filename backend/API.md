# WeEat API v0.2.0 — sharing guide

The server extracts restaurant data from public YouTube Shorts and TikTok video or photo links. Give friends the **base URL** of your running server and an **extract API key** through a private channel. The API key can submit a link for any email address, so use it from a server, not browser code.

## Extract a link

```http
POST /api/extract
Authorization: Bearer <EXTRACT_API_KEY>
Content-Type: application/json

{"url":"https://www.youtube.com/shorts/XXXXXXXXXXX","email":"friend@example.com","name":"Friend"}
```

`url` and `email` are required. `name` is optional. `refresh: true` reruns analysis instead of using a cached result. Set a client timeout of at least 180 seconds for a new video. The server strips tracking parameters from saved links.

```bash
curl --max-time 180 -X POST "$WEEAT_BASE_URL/api/extract" \
  -H "Authorization: Bearer $WEEAT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/shorts/XXXXXXXXXXX","email":"friend@example.com"}'
```

The URL above is a placeholder; replace it with a real public Short or TikTok link.

## Success response

```jsonc
{
  "row": {"url":"...", "video_id":"...", "place_count":1, "names":"...", "analysis_mode":"video_and_text"},
  "places": [{"display":{"name":"...","dish":"...","location":"...","price":"..."}, "restaurant_id":"..."}],
  "postgres":"written",
  "postgres_places":"written"
}
```

`row` has one set of typed per-link fields; its full list is in `spec/row_columns.json`. `places[]` has one object per restaurant with category, normalized address and price, map/search links, source evidence, script, and comments. Results are AI-generated and unverified. A successful analysis with no restaurant returns `places: []` and `row.place_count: 0`.

Both PostgreSQL status fields have the same value in this version because the database copy is one transaction:

| Value | Meaning |
| --- | --- |
| `off` | PostgreSQL writing is disabled. SQLite still saves the result. |
| `written` | User, per-link row, per-place rows, and available individual comments committed to PostgreSQL. |
| `failed` | PostgreSQL rolled back; local SQLite still saved the result. The HTTP response remains 200 so callers must inspect these fields. |

## PostgreSQL destinations

Set `PG_WRITE_ENABLED=1` to enable copying **new `POST /api/extract` requests only**. The tables must already exist and the configured database user must have the required permissions. The API does not backfill old SQLite records.

| Table | Purpose | Key used by this API |
| --- | --- | --- |
| `public.user_dim` | Find or create the user by case-insensitive email; set `user_name` when supplied. | Unique `lower(user_email)` |
| `public.hackathon_video_places` | One summary row per user and submitted link. | Unique `(user_id, url)` |
| `public.quan_hackathon_video_places` | **Main restaurant table:** one row per user, video, and restaurant. | Primary key `(user_id, video_id, restaurant_id)` |
| `public.quan_hackathon_video_comments` | Individual extracted comments, with sentiment and likes. A successful comment fetch replaces the rows for that video and restaurant; an unavailable fetch leaves existing comments intact. | Primary key `(video_id, merchant_id, comment_no)`; `merchant_id` is the restaurant ID |

The per-place writer supplies all 149 data columns and lets PostgreSQL set `synced_at`. The live table uses a **boolean** `is_saved`; extraction inserts `false` and preserves an existing saved value, note, and saved timestamps on conflict. In the per-link table, `is_saved` means the extraction's local save succeeded. Repeating a link updates matching rows; it does not delete place rows from an earlier run.

Example read query:

```sql
SELECT p.video_id, p.restaurant_name, p.dish, p.address_text, p.price_vnd, p.cate_name
FROM public.quan_hackathon_video_places AS p
JOIN public.user_dim AS u USING (user_id)
WHERE lower(u.user_email) = lower($1)
ORDER BY p.create_time DESC;
```

## Run the server

1. Use Node.js 22.13+ and run `npm ci`.
2. Copy `.env.example` to `.env`; set `YOUTUBE_API_KEY`, `GEMINI_API_KEY`, a random `SAVE_TOKEN_SECRET` of at least 32 characters, and `EXTRACT_API_KEY` of at least 32 letters, digits, `.`, `_`, or `-`.
3. To enable PostgreSQL, set `PG_WRITE_ENABLED=1`, `PG_HOST`, `PG_PORT`, `PG_DATABASE`, `PG_USER`, and `PG_PASSWORD`. Set `PG_SSL=1` when the PostgreSQL server requires TLS with a trusted certificate.
4. Run `npm start`. Default bind address: `127.0.0.1:3000`. Set `HOST` and `PORT` for your deployment; provide friends a reachable HTTPS base URL.

Do not share `.env` or the PostgreSQL password. The API key is for the extract route only. The earlier eight-link inspection script forces PostgreSQL writing off.

## Other routes

| Route | Authentication | Purpose |
| --- | --- | --- |
| `GET /api/categories` | None | Returns 14 food categories. |
| `POST /api/analyze` | Firebase ID token | Analyzes a link for the signed-in user's local library. |
| `GET /api/library` | Firebase ID token | Lists saved restaurants. |
| `POST /api/library`, `PUT/DELETE /api/library/{video_id}/{restaurant_id}/save` | Firebase ID token | Save or unsave a place locally. |
| `PATCH /api/library/{video_id}/{restaurant_id}` | Firebase ID token | Edit a user note. |
| `POST /api/ask` | Firebase ID token | Ask about saved places. |

Only `POST /api/extract` performs the optional PostgreSQL copy in v0.2.0. The other personal routes still use SQLite. Error responses have `{ "error": { "code": "...", "message": "..." } }`; common statuses are 400 for an invalid link or email, 401 for a missing/wrong key, 404 when the extract route is disabled, 422 when media cannot be analyzed, 429 for rate limits, and 5xx for upstream failures.

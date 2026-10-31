# WeEat API v0.2.0 — source of truth

This is the authoritative guide for `POST /api/extract`, including setup, supported sources, responses, and persistence. The server extracts restaurant data from public Facebook posts, photos, videos and Reels, YouTube Shorts, and TikTok video or photo links. Give friends the **base URL** of your running server and an **extract API key** through a private channel. The API key can submit a link for any email address, so use it from a server, not browser code.

## Supported sources and current Facebook changes

The updated code supports **both Facebook posts and Reels**. Success depends on
public content being accessible to Apify or the installed media extractor.
Capturing source data and accurately extracting restaurant fields are separate:
AI can still miss prices, mix up names, or return incomplete places.

| Source | What the reader can capture |
| --- | --- |
| Facebook post / photo post | Caption, author, source IDs and canonical URL, timestamp, available photos and separate viewer comments. |
| Facebook Reel / video | Caption and metadata when available, downloaded video for AI analysis, and separate viewer comments. Missing video permits caption-only analysis. |
| YouTube Shorts | Metadata, video analysis through Gemini, and viewer comments. |
| TikTok video / photo | Caption; video/photo analysis when the corresponding reader is enabled. TikTok comments are unavailable. |

Changes to the Facebook flow:

1. Reel URLs first use the Apify Reels scraper, then try the Posts scraper if the first read fails or lacks caption/playback data.
2. Nested video IDs and durations are normalized. Resolved IDs provide canonical Reel URLs.
3. Missing playback streams fall back to `yt-dlp`. Even if both metadata scrapers fail, Reel URLs still reach the video fallback and separate comments scraper.
4. Comments use Apify's Comments scraper with replies enabled, independent of whether a video stream is available. Up to 20 text entries are retained, with IDs, parent IDs and likes where supplied.

The request body, authentication and response structure are unchanged.
**A running server must be restarted to load code changes.**

## Extract a link

```http
POST /api/extract
Authorization: Bearer <EXTRACT_API_KEY>
Content-Type: application/json

{"url":"https://www.youtube.com/shorts/XXXXXXXXXXX","email":"friend@example.com","name":"Friend"}
```

`url` and `email` are required. `name` is optional. `refresh: true` reruns analysis instead of using a cached result. Set a client timeout of at least 180 seconds for a new video. Facebook fallback chains can take longer because metadata calls and download attempts have separate deadlines; allow a longer timeout when testing them. The server strips tracking parameters from saved links.

```bash
curl --max-time 180 -X POST "$WEEAT_BASE_URL/api/extract" \
  -H "Authorization: Bearer $WEEAT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://www.youtube.com/shorts/XXXXXXXXXXX","email":"friend@example.com"}'
```

The URL above is a placeholder; replace it with a real public Facebook post/Reel, YouTube Short, or TikTok link.

Videos known to be longer than 5 minutes return HTTP 422 with `error.code: "video_too_long"`. The limit is inclusive: a 5:00 video is accepted. TikTok videos larger than 100 MiB return HTTP 413 with `error.code: "video_too_large"` when `TIKTOK_YTDLP=1` enables the video reader. The server checks TikTok metadata before download when available, and also caps downloaded bytes. These limits default to `MAX_VIDEO_SECONDS=300` and `VIDEO_UPLOAD_MAX_MB=100`; configuration can lower them but cannot raise them above 5 minutes or 100 MiB.

YouTube provides duration through its metadata API, so the duration check happens before AI analysis. This API sends YouTube URLs to Gemini without downloading the video; the YouTube metadata response does not include file size, so it cannot enforce the 100 MiB limit for YouTube. TikTok links analyzed from captions alone also have no reliable duration or file-size check. Enable `TIKTOK_YTDLP=1` to enforce both limits for TikTok videos.

### Request fields

| Field | Required | Meaning |
| --- | --- | --- |
| `url` | Yes | Supported public content URL. Tracking is stripped while Facebook identity parameters are preserved. |
| `email` | Yes | Owner of the extracted places; email comparison is case insensitive. |
| `name` | No | Display name supplied to the PostgreSQL user writer when enabled. |
| `refresh` | No | `true` bypasses cached analysis. |

Instagram URLs and file uploads are not supported by this route.

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

Repeating an extraction can fill a missing ShopeeFood store URL for the same restaurant ID. This preserves the existing extraction, notes, saved status and creation time, and updates the record's update time when the URL is recovered.

Both PostgreSQL status fields have the same value in this version because the database copy is one transaction:

| Value | Meaning |
| --- | --- |
| `off` | PostgreSQL writing is disabled. SQLite still saves the result. |
| `written` | User, per-link row, per-place rows, and available individual comments committed to PostgreSQL. |
| `failed` | PostgreSQL rolled back; local SQLite still saved the result. The HTTP response remains 200 so callers must inspect these fields. |

### Reading `row` and `places`

`row` is the per-link summary. Fields for multiple places can be joined with
` | `; `(none)` marks a missing value in joined fields. Use `places[]` for
individual restaurant cards and filtering.

| Place fields | Meaning |
| --- | --- |
| `display.name`, `display.dish`, `display.location`, `display.price` | Extracted card text; missing values can be null. |
| `restaurant_id`, `id` | Restaurant matching ID and local record ID. Matching uses extracted text and is not independent verification. |
| `cate_id`, `cate_name`, `cate_name_en` | Category from the configured food category list. |
| `address_text`, `latitude`, `longitude`, `geoSource` | Normalized address and optional geocoding result. |
| `price_text`, `price_vnd`, `price_vnd_max`, `price_inferred` | Original price and normalized values when available. |
| `mapsSearchUrl`, `shopeeFoodUrl`, `shopeeFoodSearchUrl` | Map/search links and delivery link when available. |

| `hasConflict`, `conflictFields`, `missingFields`, `venue` | Conflicts, missing fields and extraction evidence. |
| `source`, `thumbnail_url`, `script.lines` | Original source, optional cover and extracted spoken/on-screen text. |
| `comments` | Availability status, sampled text entries, likes and optional AI sentiment. |

ShopeeFood searches use the restaurant name and street or city, without house numbers. Store results must match the name in the title/snippet and a street or city in the title, snippet, or listing URL. When the location is missing from those search results, the API checks up to two matching store pages using link-preview HTML and requires the restaurant's structured name and address to match. Navigation and footer text are excluded. Each page has a 6-second timeout and a 1 MiB size limit; failed verification retains the search fallback. Full street-address matching is not required.

`analysis_mode: "video_and_text"` indicates media analysis (including photo
analysis); `text_only` indicates caption/metadata analysis. Neither guarantees
correct restaurant fields. Thumbnail availability is separate from successful
video download. TikTok covers may use the server's configured `COVER_BASE_URL`;
provide a publicly reachable base URL or proxy them if serving browser clients.

API email submissions use a separate local library from Firebase app sign-ins;
the API does not look up a Firebase user by email.

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

### Facebook extraction

`POST /api/extract` accepts public Facebook Reels, videos, posts, photo links,
`story.php`/`permalink.php`, Facebook share links, and `fb.watch` links. The
request body and authentication are unchanged. Facebook source IDs use the
`facebook:` namespace; cache files have a separate Facebook namespace. Source
URLs retain identity parameters (`v`, `fbid`, `story_fbid`) and drop tracking.
Opaque share links are passed to Apify; returned canonical post URLs and IDs
are used when available. Profile URLs are rejected.

Set `APIFY_TOKEN` in `.env`. This is an **Apify credential**, separate from any
Meta token. It is sent only in the Apify Authorization header, never in the
request URL or API response. Missing configuration returns
`503 facebook_not_configured`. Failed non-Reel post reads return
`502 facebook_unavailable`; Reel metadata failures continue to the media and
comments fallbacks before deciding whether usable input exists. The actors used are:

- `apify/facebook-posts-scraper`: caption, ordered photo URLs, links and metadata.
- `apify/facebook-reels-scraper`: Reel caption and playback metadata.
- `apify/facebook-comments-scraper`: separate request with replies enabled,
  limited to 20 comments. The Posts actor's numeric `comments` is never used
  as comment text.

The synchronous actor calls have a 120-second provider timeout and a
130-second client deadline. Responses are bounded to 8 MiB. Facebook CDN media
is downloaded with a 30-second deadline per file, HTTPS host restrictions,
no redirects, byte counting, and media signature validation. Video streams
are used only after bytes pass MP4 validation. Missing/failed streams fall
back to `yt-dlp`; photos use Apify URLs first, then `gallery-dl` when the
installed extractor supports the URL. Configure executable locations with
`FACEBOOK_YTDLP_PATH` and `FACEBOOK_GALLERYDL_PATH`. Each subprocess has a
60-second deadline, bounded stdout, and runs without a shell. Limits remain
10 photos, 300 seconds per video, and 100 MiB per video or photo batch.

Gemini reads available media and caption through the existing restaurant
pipeline. Missing media permits caption-only analysis and produces a warning;
missing both returns `422 nothing_to_read`. Missing fields are unavailable,
not successful empty results. Comments expose `ok`, `partial`, or
`unavailable` plus a reason. Partial results can contain replies and sampled
comments. Failed refreshes preserve previously stored comment text, marked
`partial` with reason `refresh_failed_preserved`. The SQLite and PostgreSQL
mappings retain Facebook platform, media, namespaced source ID, canonical
URL, comment text, likes, and availability status.

Live/fixture verification details: [Facebook verification](inspection/facebook-verification.md).

Reel metadata reads now fall back from the Reels actor to the Posts actor.
Nested Reel video IDs and durations are normalized, and resolved video IDs
produce canonical `/reel/{id}/` URLs for downloads and comment reads. If both
metadata actors fail, Reel URLs still reach the bounded `yt-dlp` fallback and
separate comments scraper. Missing caption and media still returns
`422 nothing_to_read`; this change does not make unavailable media a success.
`FACEBOOK_YTDLP_PATH` takes precedence; otherwise the configured
`TIKTOK_YTDLP_PATH` is reused before falling back to `yt-dlp` on PATH.
Downloaded fallback bytes must pass the same video signature validation.

Live verification on 2026-10-31: both supplied Reel shares downloaded via
`yt-dlp` as valid MP4 (9,732,393 bytes / 57.678 seconds and 13,874,912 bytes /
49.179 seconds). Separate live comment reads returned one comment and six
comments respectively; the latter was partial due to missing text in some
provider rows. Metadata for this download check replayed previously captured
live Posts responses; comments and video downloads were live. PostgreSQL was
not initialized. See `inspection/facebook-reel-fallback-results.json`.

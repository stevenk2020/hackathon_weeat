# WeEat extract API

For the current shareable version and setup instructions, start with [API.md](../API.md).

Send a food video link and a user's email. You get back the restaurants found in the video. They are saved to
local SQLite and, when `PG_WRITE_ENABLED=1`, copied to PostgreSQL:

- `hackathon_video_places`: one row per user and link (the places joined with ` | `), with timing.
- `quan_hackathon_video_places`: one row per user, video and restaurant, every value in its own column. Its columns
  are described in [QUAN_HACKATHON_VIDEO_PLACES.md](QUAN_HACKATHON_VIDEO_PLACES.md).
- `quan_hackathon_video_comments`: individual comments when comment reading succeeds.

```
POST /api/extract
Authorization: Bearer <EXTRACT_API_KEY>
Content-Type: application/json

{ "url": "https://vt.tiktok.com/ZSgUJ8q3E/", "email": "user@gmail.com" }
```

The app's own endpoints for the team's frontend (Analyze, Save/Unsave, Library, Ask, categories) are described in
[API_CONTRACT.md](API_CONTRACT.md); this page is only about `POST /api/extract`.

The `row` reply uses the columns in `row_columns.json`. PostgreSQL writing is an optional copy; the API does not
backfill earlier SQLite records.

## Before you start

- **Call it from your server, not from a browser.** Anyone who has the API key can save places for any email. If
  the key is in browser code, it is public.
- **Base URL:** ask Quan. The server runs on Quan's machine, so you need the same network or a tunnel.
- **API key:** Quan gives it to you privately. Keep it in your server's environment, never in git.
- **Timeout:** at least **120 seconds**. A link the server has not seen before takes about 20 to 100 seconds,
  because the AI watches the video. A link it has seen before comes from the cache in a few seconds.

## Request

| Field | Required | Meaning |
|---|---|---|
| `url` | yes | A public YouTube Shorts link, or a TikTok video or photo post link. Share links like `vt.tiktok.com/...` work, and long links with tracking data are fine (everything from `?` is removed). |
| `email` | yes | The user the places belong to. Any upper/lower case is the same user. In PostgreSQL this is `user_dim.user_email`, and the row is added there if it is missing. |
| `name` | no | The user's display name, stored in `user_dim.user_name` when the user is new. |
| `refresh` | no | `true` makes the AI analyze the video again instead of answering from the cache. It is slow and uses AI quota, so use it rarely. |

Instagram and other sites are not supported. File uploads are not available through this API yet.

## Examples

```bash
curl -X POST "$WEEAT_BASE_URL/api/extract" \
  -H "Authorization: Bearer $WEEAT_API_KEY" \
  -H "Content-Type: application/json" \
  --max-time 150 \
  -d '{"url":"https://vt.tiktok.com/ZSgUJ8q3E/","email":"user@gmail.com","name":"Test User"}'
```

```js
// Node 18+ (server side)
const res = await fetch(`${process.env.WEEAT_BASE_URL}/api/extract`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.WEEAT_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({ url, email }),
  signal: AbortSignal.timeout(150_000),
});
const body = await res.json();
if (!res.ok) throw new Error(`${body.error.code}: ${body.error.message}`); // message is safe to show to users
const { row, places, postgres } = body;
```

## Response (200)

```jsonc
{
  "postgres": "written",        // "written" | "failed" | "off": whether hackathon_video_places was updated
  "postgres_places": "written", // "written" | "failed" | "off": whether quan_hackathon_video_places was updated
  "row": { ... },               // the hackathon_video_places row for this user and link
  "places": [ { ... } ]        // one object per restaurant, in the order they appear in the video
}
```

There are three ways to use the result:
1. **Read the per-place table.** When `postgres_places` is `"written"`, every restaurant of the video is already in
   `quan_hackathon_video_places` for this user, one row each. This is the easiest table to filter:
   ```sql
   SELECT restaurant_name, address_text, price_vnd, latitude, longitude, cate_name
   FROM quan_hackathon_video_places p JOIN user_dim u USING (user_id)
   WHERE lower(u.user_email) = lower($1) AND p.url = $2;   -- $2: the link without its tracking part (row.url)
   ```
2. **Read the per-link table.** When `postgres` is `"written"`, the row is already in `hackathon_video_places`
   (`user_id` from `user_dim`, `url` = the link without its tracking part).
3. **Use `places` directly.** It has one clean object per restaurant, which is easier for a UI than `row`.

### `row`: the table row

These are the same columns as `hackathon_video_places` and the extract-csv CSV, already typed (true/false,
numbers, `null` for empty). When a video has several restaurants, each per-place column joins them with `" | "`
in order, and `"(none)"` means that place has no value. Real example:

```jsonc
{
  "url": "https://vt.tiktok.com/ZSgUJ8q3E/",
  "is_saved": true, "error": null,
  "platform": "tiktok", "media": "video", "video_id": "7684125250686242069",
  "video_url": "https://www.tiktok.com/@chanlovefoods/video/7684125250686242069",
  "title": "TikTok video by @chanlovefoods",
  "analysis_mode": "video_and_text", "cache_hit": true,
  "analyze_seconds": 0.2, "save_seconds": 3.2, "total_seconds": 3.5,
  "warnings": "This TikTok has no caption, so only the video was analyzed.",
  "place_count": 1,
  "names": "Prem & Pi Vegetarian",
  "dishes": "khay cuốn mùa nắng",
  "price_text": "185 000", "price_vnd": "(none)",
  "addresses": "Lầu 3-4, 187/15 Điện Biên Phủ, Tân Định",
  "address_text": "187/15 Điện Biên Phủ, Tân Định",
  "cate_name": "Chay", "cate_name_en": "Vegetarian",
  "latitudes": "10.7867738", "longitudes": "106.6939972", "geo_sources": "goong_address",
  "maps_urls": "https://www.google.com/maps/search/?api=1&query=...",
  "shopeefood_urls": "https://www.google.com/search?q=site%3Ashopeefood.vn...", "shopeefood_kinds": "search",
  "script_lines": 16, "script_text": "Nơi ăn chay đa dạng ... / ...",
  "comments_status": "unavailable (tiktok)", "comments_count": 0
  // ... see docs/EXTRACT_CSV_COLUMNS.md for every column
}
```

### `places[]`: one restaurant each

The fields you will most likely use:

| Field | Example | Notes |
|---|---|---|
| `id` | `"92d002c0…"` | Stable: the same link and restaurant always give the same id. |
| `display.name` / `.dish` / `.location` / `.price` | `"Prem & Pi Vegetarian"` | Plain text for the card. `null` when not found. A value is never made up. |
| `cate_name` / `cate_name_en` | `"Chay"` / `"Vegetarian"` | Dish group chosen by the AI from a fixed list. |
| `cate_id` | `1` | The dish group's fixed number (1 Chay ... 14 Khác; the `cate_dim` table in the SQLite library has all of them with both names). `null` without a group. |
| `restaurant_id` | `"b1dc8399..."` (32 hex) | The same restaurant across videos and users: same name (ignoring case and accents) on the same street. A place with no name only matches itself. A matching rule on the AI's text, not a checked fact. |
| `thumbnail_url` | `"https://i.ytimg.com/vi/.../hqdefault.jpg"` | The YouTube video's thumbnail: a picture from the video, not a photo of the restaurant. For TikTok `null`, or, when the server keeps covers (hackathon only), the cover's full address on this server such as `"http://127.0.0.1:21001/covers/tiktok-<id>.jpg"` (a browser cannot reach it: see [Pictures](#pictures-thumbnail_url)). `null` for uploads. |
| `address_text` | `"187/15 Điện Biên Phủ, Tân Định"` | Cleaned address (no floor, short forms written out). `null` when there is no address or two addresses conflict. |
| `price_text`, `price_vnd`, `price_vnd_max`, `price_inferred` | `"50k"`, `50000`, `50000`, `true` | `price_inferred` is true when a unit like `k` was converted. |
| `latitude`, `longitude`, `geoSource` | `10.78`, `106.69`, `"goong_address"` | Map point from the name or address. `null` when it could not be matched safely. |
| `mapsSearchUrl` | Google Maps search link | It is a SEARCH, not a pinned place. |
| `shopeeFoodUrl` / `shopeeFoodSearchUrl` | | The real store page if one was found, otherwise a Google search link. |
| `hasConflict`, `conflictFields` | `false`, `[]` | The video and the caption disagree, for example `["price"]`. Show both values or neither. |
| `missingFields` | `["price"]` | What was not found. |
| `source.videoUrl`, `source.channel`, `source.thumbnail` | | Where the place came from. TikTok has no thumbnail unless the server keeps covers (see `thumbnail_url`). |
| `script.lines[]` | `{timestamp, kind, text}` | What is said or written in the video, in its original language. |
| `comments` | `{status, items[], sentiment}` | YouTube only: top viewer comments with AI mood marks. TikTok: `unavailable`. |
| `venue.<field>.entries[]` | | Full evidence: where each value came from, AI quote, timestamp, confidence. |

Every place is **AI-extracted and not checked by a person** (`aiExtractedUnverified: true`). Show a short note
such as "Details are AI-generated and can be wrong." Never label them "verified".

A video with no restaurant in it gives `places: []` and `row.place_count: 0`.

## Errors

Errors look like `{ "error": { "code": "...", "message": "..." } }`. The message is written for end users.

| Status | `code` | What to do |
|---|---|---|
| 400 | `invalid_url` | Not a YouTube Shorts or TikTok link. |
| 400 | `invalid_email` | Missing or malformed `email`. |
| 400 | `bad_request` | Body is not valid JSON. |
| 401 | `invalid_api_key` | Missing or wrong key. |
| 404 | `not_found` | The API is turned off on this server (no `EXTRACT_API_KEY`). |
| 404 | `video_unavailable` | The video is private, deleted or not found. |
| 422 | `video_too_long`, `video_not_analyzable`, `photo_caption_unavailable`, `nothing_to_read` | The video is too long, or there was nothing the AI could read. Show the message. |
| 413 | `bad_request` | Body too large. |
| 415 | `bad_request` | Missing `Content-Type: application/json`. |
| 429 | `rate_limited` | Too many calls. Wait for the `Retry-After` header (in seconds). The default limit is 30 calls per minute for all callers together. |
| 429 | `live_limit` | The hourly AI limit for the whole server (default 40 new analyses per hour) is used up. Links that were already analyzed still work. Wait for `Retry-After`. |
| 503 | `ai_busy`, `youtube_quota` | The AI service or the YouTube quota is busy or used up. Try again later. |
| 500 / 502 / 504 | `internal_error`, `server_config`, `upstream_unreachable`, `upstream_error`, `tiktok_lookup_failed`, `ai_bad_output`, `ai_auth`, `timeout` | A problem on the server side. Try again later, and tell Quan if it keeps happening. |

`postgres: "failed"` and `postgres_places: "failed"` mean the PostgreSQL transaction rolled back while local SQLite
saved the result. Retry the request after fixing the database problem. Both statuses have the same value in v0.2.0.

## What a TikTok link gives you

- **Normal setting:** only the TikTok caption is read, not the video (`analysis_mode: "text_only"`). Fewer places
  are found.
- **Hackathon setting** (`TIKTOK_YTDLP=1` / `TIKTOK_GALLERYDL=1` on Quan's server): the AI watches the video or
  looks at the photos. This breaks TikTok's terms and is for the hackathon demo only, so it must not stay on for
  a shared or deployed server.

`row.analysis_mode` tells you which one happened: `video_and_text` (watched) or `text_only` (caption only).

## Pictures (`thumbnail_url`)

`thumbnail_url` (in `places[]`, in `quan_hackathon_video_places` and in `hackathon_video_places`) is one of:

| Value | What it is | What your frontend does |
|---|---|---|
| `https://i.ytimg.com/...` | YouTube's own thumbnail | Show it as it is. |
| `http://127.0.0.1:21001/covers/tiktok-<id>.jpg` (or `.png`, `.webp`) | A TikTok cover kept on Quan's server (hackathon setting `TIKTOK_COVER_SAVE=1`) | Quan's server listens on `127.0.0.1:21001` (this machine only). Your server can open this address; a user's browser cannot, so **your server passes the picture on** (below). |
| `null` | No picture | Show your fallback. |

All three are a picture from the video, never a photo of the restaurant.

### Passing TikTok covers on from your server

Your server runs on the same machine, so it can reach `http://127.0.0.1:21001`. Add one route on your server, for
example `GET /images/covers/:file`, that does this:

1. **Check the file name** against exactly `^tiktok-\d{8,25}\.(jpg|png|webp)$`. Anything else: answer `404` and do
   not call Quan's server. (Without this check your route becomes a public door into Quan's server.)
2. **Fetch** `http://127.0.0.1:21001/covers/<file>` (GET, no key needed, 10 s timeout).
3. **Answer** with the same status. On `200`, send the bytes with Quan's `Content-Type` (`image/jpeg`, `image/png`
   or `image/webp`) and a cache header such as `Cache-Control: public, max-age=86400`. A cover never changes, so
   your server or a CDN may keep a copy. On `404` (no such cover) answer `404`; if Quan's server does not answer,
   answer `502` and let the frontend show its fallback.

Then, wherever you send `thumbnail_url` to the browser, rewrite Quan's address to your route:

```
"http://127.0.0.1:21001/covers/tiktok-7683897829538008327.jpg"  ->  "https://<your public host>/images/covers/tiktok-7683897829538008327.jpg"
```

Leave `https://...` values and `null` as they are.

Example (Node 18+ with Express; any language works the same way):

```js
const COVER = /^tiktok-\d{8,25}\.(jpg|png|webp)$/;
app.get("/images/covers/:file", async (req, res) => {
  if (!COVER.test(req.params.file)) return res.sendStatus(404);
  try {
    const r = await fetch(`http://127.0.0.1:21001/covers/${req.params.file}`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return res.sendStatus(r.status === 404 ? 404 : 502);
    res.set("Content-Type", r.headers.get("content-type"));
    res.set("Cache-Control", "public, max-age=86400");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (err) {
    res.sendStatus(502);
  }
});

// when building the JSON for the browser
const QUAN_COVERS = "http://127.0.0.1:21001/covers/";
const pictureUrl = (t) => (typeof t === "string" && t.startsWith(QUAN_COVERS) ? `${PUBLIC_BASE_URL}/images/covers/${t.slice(QUAN_COVERS.length)}` : t);
```

Check it from the machine: `curl -I http://127.0.0.1:21001/covers/tiktok-7683897829538008327.jpg` should answer
`200 image/jpeg`.

---

## For Quan: turning it on

1. Create a key: `openssl rand -hex 32`. Put it in `.env` as `EXTRACT_API_KEY=<key>`. It must be at least 32 characters
   and use only letters, digits, `.`, `_` or `-`.
2. Set `PG_WRITE_ENABLED=1` and the `PG_*` connection variables to copy extract results to PostgreSQL. The three
   destination tables must already exist; this server does not create or backfill them.
3. Restart with `npm start`. The server listens on `HOST` (default `127.0.0.1`, this machine only). For a teammate,
   use a tunnel or set `HOST=0.0.0.0` on a trusted network.
4. Optional: `EXTRACT_PER_MIN` (default 30).

Places sent through the API are saved in a separate `csv-` library per email. They do not show up in that person's own WeEat app library,
because the API never looks up WeEat sign-ins by email. In PostgreSQL everything is keyed by email, so it is all one
user there.

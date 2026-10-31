# Analysis pipeline (what happens between a pasted link and the analysis result)

Every outside call goes through `deps.fetchImpl` (HTTP) or the two injected TikTok readers; every time comes from `deps.now()`.

Shared helpers used below:
- `fetchWithTimeout(url, init, ms)`: `fetchImpl(url, {...init, signal: AbortSignal.timeout(ms)})`; an abort/timeout
  error becomes code `timeout`, any other thrown error code `network`.
- Timeouts (ms): youtube/TikTok/oEmbed 10000, Gemini video 90000, Gemini text 30000, geocoding 6000, web search 6000.
- `normalizeForQuote(s)` = `String(s||"").normalize("NFC").toLowerCase().replace(/\s+/g," ").trim()`.

## 1. Which link is it
- YouTube Shorts: `^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/shorts\/([\w-]{11})(?:[/?#&].*)?$` (case-insensitive,
  after `trim()`). Group 1 is the video id.
- Otherwise TikTok. FIRST cut the text at the first `?` or `#` (`text.trim().split(/[?#]/)[0]`), THEN refuse it if longer
  than 600 characters, then match (all case-insensitive), with HANDLE = `[A-Za-z0-9._]{1,64}`, ID = `\d{8,25}`:
  - full video: `^(?:https?://)?(?:www\.|m\.)?tiktok\.com/@(HANDLE)/video/(ID)(?:/.*)?$`
  - photo post: same with `/photo/`
  - mobile: `^(?:https?://)?m\.tiktok\.com/v/(ID)\.html$` (no handle)
  - share page: `^(?:https?://)?t\.tiktok\.com/i18n/share/(video|photo)/(ID)/?$` (no handle)
  - short: `^(?:https?://)?(?:(vt|vm)\.tiktok\.com/([A-Za-z0-9]{5,20})|(?:www\.)?tiktok\.com/t/([A-Za-z0-9]{5,20}))/?$`
    → resolve URL `https://<vt|vm lowercased>.tiktok.com/<code>/` or `https://www.tiktok.com/t/<code>/`.
- Neither: 400 `invalid_url`, message `Please paste a public YouTube Shorts or TikTok video link, like https://www.youtube.com/shorts/XXXXXXXXXXX or https://vt.tiktok.com/XXXXXXXXX/`.
- The tracking part (from `?`/`#`) is never sent, cached, logged or stored.

### Resolving a short TikTok link (redirect header only)
Up to 3 hops: `GET current` with `{method:"GET", redirect:"manual", headers:{"User-Agent":"WeEatAI/0.1 (restaurant finder; link lookup and oEmbed only)", Accept:"application/json, text/html;q=0.5"}}`.
Cancel the body. 404 → `unavailable`; >=400 → `blocked`; <300 → `not_a_video`; no `Location` → `not_a_video`;
`new URL(location, current)` must be https on one of `tiktok.com www.tiktok.com m.tiktok.com vt.tiktok.com vm.tiktok.com t.tiktok.com`
else `not_a_video`. Parse the target with the rules above: full/photo/mobile/share → done (`kind` video|photo, `handle`
null for mobile/share); another short link → next hop; anything else → `not_a_video`. After 3 hops → `not_a_video`.
Errors: invalid_url 400 `invalid_url`; not_a_video 422 `not_a_video`; unavailable 404 `video_unavailable`; blocked 502
`tiktok_lookup_failed`; timeout 504 `timeout`; network 502 `upstream_unreachable` (messages in ERRORS.md).
`canonicalUrl(handle, id, kind)` = `https://www.tiktok.com/@${handle || "_"}/${kind==="photo"?"photo":"video"}/${id}`.

## 2. YouTube Short
1. Cache key `${videoId}__${model}__${PROMPT_VERSION}`; a hit (and no `refresh`) returns the cached result with
   `cache: {hit:true, created_at, refreshed:false}`. Nothing else runs.
2. Live-analysis limit (`LIVE_ANALYSES_PER_HOUR`, default 40, whole server): over → 429 `live_limit`, `Retry-After`.
3. Metadata: `GET https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=<id>&key=<key>`.
   403 → 503 `youtube_quota`; 400 → 500 `server_config`; other non-2xx or bad JSON → 502 `upstream_error`;
   no `items[0].snippet` → 404 `video_unavailable`. video = `{id, title: s.title||"", description: s.description||"",
   channel: s.channelTitle||"", tags: array or [], thumbnail: (maxres||standard||high||medium||default||{}).url||null,
   durationSec: ISO-8601 PT#H#M#S → seconds, or null}`.
   `durationSec > MAX_VIDEO_SECONDS` (default 190) → 422 `video_too_long`, message
   `This video is <n> seconds long. The limit is <max> seconds.`
4. In parallel:
   a. Video reading: `POST https://generativelanguage.googleapis.com/v1beta/interactions`, headers
      `x-goog-api-key`, `Content-Type: application/json`, body `{"model": <model>, "input": [{"type":"text","text": <prompts/video_youtube.txt>}, {"type":"video","uri":"https://www.youtube.com/shorts/<id>"}]}`.
      Reply text = concatenation of `content[].text` of the LAST step whose `type` is `model_output`.
   b. Text reading (`text_reader(video, comments=[])`, below) with `prompts/text_youtube_system.txt`.
   c. Comments: `GET https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=<id>&order=relevance&maxResults=20&textFormat=plainText&key=<key>`,
      then the comment rating (section 6) on what it returned.
5. Video reading failed → error (section 8). Text reading failed → `metaChecked = null`.
6. `metaChecked = checkEvidence(text, video, [])`; card builder (CARD_RULES.md) with `{video, videoResult, metaChecked, comments}`.
7. `result.analysis = {model, prompt_version: PROMPT_VERSION, latency_ms}` (latency_ms: any whole number; not compared).
8. Address from comments (section 7), then address from a web search (section 9).
9. `created_at = new Date(now()).toISOString()`; cache `{created_at, result}`; return
   `{...result, cache: {hit:false, created_at, refreshed: Boolean(refresh)}}`.

## 3. TikTok link (no uploaded file)
`found` = resolved `{id, handle, kind}`. Readers: `deps.tiktokVideo` (yt-dlp: `fetch(url)`, `details(url)`) and
`deps.tiktokPhotos` (gallery-dl: `fetch(url)`, `firstPhoto(url)`). `useVideoReader` = reader present and kind video;
`usePhotoReader` = reader present and kind photo.
1. mode = `photolink` (photo reader) | `browser` (video reader) | `caption`. Prompt version = PHOTO_PROMPT_VERSION in photolink
   mode, else TIKTOK_PROMPT_VERSION. Cache key `tiktok_${id}__${mode}__${model}__${version}`. Hit → the cached result with
   `video.thumbnail` replaced by the kept cover (section 5, `coverUrl` undefined) and `cache.hit = true`.
2. Live-analysis limit as for YouTube.
3. Start `tiktokVideo.fetch(canonicalUrl(handle,id))` (video) or `tiktokPhotos.fetch(canonicalUrl(handle,id,"photo"))` (photo) now.
4. oEmbed: `GET https://www.tiktok.com/oembed?url=<encodeURIComponent(lookup)>` with the same User-Agent/Accept headers,
   lookup = `canonicalUrl(handle,id,kind)` or `https://m.tiktok.com/v/<id>.html` when no handle. 400/404 → `not_found`;
   other non-2xx/bad JSON → `api_error`. handle = found.handle, else from `author_url` (`tiktok\.com\/@(HANDLE)\/?$`), else
   `api_error`. caption = `title` (string, cut to 3000) or ""; channel = trimmed `author_name` (cut to 200) or `@handle`;
   coverUrl = `thumbnail_url` if a string of at most 4096 chars; `stripped` = reply has no `title` key.
   video = `{platform:"tiktok", id, handle, url: canonicalUrl(handle,id,kind), media: kind, title: displayTitle(caption, handle, kind), caption, channel, thumbnail:null, durationSec:null}`.
   `displayTitle(caption, handle, kind)`: first non-empty trimmed line of the caption; empty → `TikTok video by @<handle>`
   (`TikTok photo post by @<handle>` for photos); longer than 120 → first 119 characters, trimEnd, plus `…`.
5. Details (video posts only): ask `tiktokVideo.details(postUrl)` when the reader exists and (oEmbed failed, or gave no
   caption, or a cover is needed and oEmbed gave none). postUrl = canonical url, or `https://m.tiktok.com/v/<id>.html`.
   "Cover needed" = covers are kept and (refresh, or no kept file for this id). details = `{caption, handle, author, coverUrl}`.
6. Photo reader result: if ok and every photo passes the photo check (JPEG/PNG/WebP/HEIC magic bytes, 1-10 photos), the
   photos are the media, the first photo is the cover candidate, `details` = the reader's details, and when `truncated`
   add the warning `This photo post has more than 10 photos, so only the first 10 were read.` Otherwise "photo degraded".
7. video: oEmbed ok → fill from details: if no caption and details.caption → caption = it, title = displayTitle(it, handle, media);
   if channel is empty or equals `@handle` and details.author → channel = author. oEmbed failed and details give a handle
   (found.handle or details.handle) → build the video from details (caption or "", channel author or `@handle`).
   Photo post with photos but nothing above → video from the link alone (caption "", channel `@handle`,
   title displayTitle("",handle,"photo")) and warning `TikTok did not give us this photo post's caption, so only the photos were read.`
   Photo post with nothing → 422 `photo_caption_unavailable`. Otherwise the oEmbed error (not_found 404 `video_unavailable`,
   timeout 504, network 502 `upstream_unreachable`, else 502 `upstream_error`).
8. Video reader result: ok with a buffer that passes the video check (MP4/MOV `ftyp`, duration read from `mvhd`,
   duration <= MAX_VIDEO_SECONDS) → media. A video reader that was used but gave no media → warning
   `The AI could not watch this video this time, so only the caption was read.` Photo degraded → warning
   `The AI could not look at these photos this time, so only the caption was read.` A video's duration goes into `video.durationSec`.
9. No media and empty caption → 422 `nothing_to_read`.
10. In parallel: the video/photo reading (section 4), the text reading of the caption (only when there is a caption) with
    `prompts/text_tiktok_system.txt` and `textVideo = {title:"", description: caption, tags:[], channel}`, the cover
    (section 5, with coverUrl = oEmbed's `thumbnail_url` when oEmbed succeeded and gave one, otherwise the reader
    details' `coverUrl`, also when oEmbed FAILED and the video was built from the details; otherwise null), and comments = the reader's comments rated like YouTube's, else `{status:"unavailable", reason:"tiktok", items:[], sentiment:null}`.
11. Media reading failed → its error (section 8). No media and the text reading failed → its error.
12. `video.thumbnail` = the kept cover path (or null). Card builder with `warnings` and
    `textMissingWarning` = caption ? `The caption could not be analyzed, so only the <photo|video> analysis is shown.`
    : (warnings already present ? null : `This TikTok has no caption, so only the <photos were|video was> analyzed.`).
13. `result.analysis` as for YouTube with prompt_version = PHOTO_PROMPT_VERSION for photos, else TIKTOK_PROMPT_VERSION
    (latency null when no media was read). Address from a web search (section 9). TikTok never uses the comment address step.
14. Degraded (video reader or photo reader failed): return WITHOUT caching. Else cache and return as for YouTube.

## 4. Video / photo reading (Gemini Interactions API)
Same endpoint and headers as 2.4a. Inputs after the text prompt:
- TikTok video file: `{"type":"video","data":<base64>,"mime_type":"video/mp4"|"video/quicktime"}` with `prompts/video_tiktok.txt`.
- Photos: one `{"type":"image","data":<base64>,"mime_type":<from magic bytes>}` per photo, in order, with `prompts/photos.txt`.
HTTP errors: 429 `rate_limited`, 401/403 `bad_key_or_forbidden`, 404 `model_not_found`, 400 `video_unavailable`,
413 `too_large`, other `api_error`; unreadable reply `bad_output`.
Reply parsing: strip ```json / ``` fences, take from the first `{` to the last `}`, `JSON.parse`. Then normalise:
- field `{value, source, evidence, timestamp, confidence}`: value must be a non-blank string else the empty field
  `{value:null, source:null, evidence:null, timestamp:null, confidence:null}`; value trimmed and cut to 300; source one of
  visual_text|spoken_audio|uncertain else uncertain; evidence string cut to 200 else null; timestamp `^\d{1,2}:\d{2}$` else
  null; confidence high|medium|low else low.
- venue: the four fields; `dish_group` = (dish or name has a value) ? the AI's value if it is a key of dish_groups.json else null
  : null; `match_score` = finite number → `Math.min(100, Math.max(0, Math.round(v)))` else null.
- venues = object entries of `venues`, normalised, keeping those with at least one field value; keep the first 5;
  `incomplete` = more than 5 kept OR `more_than_5_venues === true`.
- script: each line with a string `text`: text with whitespace runs → one space, trimmed, cut to 200, skipped if empty;
  timestamp as above; kind speech|on_screen else speech; at most 60 lines.
- Photos only: every field's timestamp null; a `spoken_audio` source becomes `uncertain` with confidence `low`;
  script keeps only on_screen lines, with timestamp null.

## 5. Kept TikTok covers (TIKTOK_COVER_SAVE=1)
Files `tiktok-<id>.<jpg|png|webp>` in `TIKTOK_COVER_DIR`; the path stored on results is `/covers/tiktok-<id>.<ext>`.
Order: a kept file (unless refresh) → the photo reader's first photo (saved as is if JPEG/PNG/WebP) → if a download
was tried for this id in the last hour without success, the kept file or null → coverUrl (if undefined: ask oEmbed again,
then for a photo post `tiktokPhotos.firstPhoto(...)`, for a video `tiktokVideo.details(...)`) downloaded with
`fetchImpl(url, {redirect:"error"})`: https, TikTok CDN host, at most 2 MB, JPEG/PNG/WebP only. Any failure = no cover.
Public address of a cover: `COVER_BASE_URL` (default `http://127.0.0.1:<PORT>`) + the path. `GET /covers/tiktok-<id>.<ext>`
serves the file (no sign-in; 404 when missing or covers are off).

## 6. Viewer comments (YouTube; TikTok only through the video reader)
From the commentThreads reply: `items[].snippet.topLevelComment.snippet` → `{text: textDisplay||"", likes: likeCount||0}`,
dropping blank texts. Errors: reason `commentsDisabled` → `comments_disabled`, 404 → not_found, 403 → quota, else api_error.
Block: listing failed → `{status:"unavailable", reason: disabled (comments_disabled) | error, items:[], sentiment:null}`.
items = each `{text: whitespace→one space, trimmed, cut to 300, likes: whole number >=0 else 0, sentiment:null}`, blanks
dropped, first 20; none → reason `none`. Rating: `POST .../v1beta/models/<model>:generateContent` with
`systemInstruction` = prompts/comments_system.txt, user text `<comments>\n#1: text\n#2: text\n</comments>`,
`generationConfig: {temperature:0, responseMimeType:"application/json", responseSchema: <see lib/upstream.js>}`.
labels: one per comment by `n` (1-based, first label wins, unknown sentiment ignored). Rating failed → items stay
unmarked and `sentiment: null`. `sentiment` = counts `{overall, positive, negative, neutral, mixed, rated}` where
rated = marked comments; none marked → null; opinions = positive+negative+mixed; overall = neutral when no opinions,
positive if positive/opinions >= 0.6, negative if negative/opinions >= 0.6, else mixed. Status `ok`, reason null.

## 7. Address from viewer comments (YouTube only)
Only when exactly one card and its location is `not_found`, and the comment listing worked: comments = each text cut to
500 chars, blanks dropped; none → skip. Run the text reader with these comments. Keep only a `location` whose source is
`comment`, `supported === true`, and whose `normalizeForQuote(evidence)` is inside ONE comment's normalised text. Then the
card's location becomes `{status:"found", agreement:null, entries:[{value, origin:"comment", source:"viewer_comment",
source_detail:null, confidence: low stays low else "medium", evidence, timestamp:null, evidence_checked:true}]}`, and
maps_url/maps_note/conflicts/conflict_count are worked out again (CARD_RULES.md). Any failure: nothing changes.

## 8. Text reader (title/description or caption)
`POST https://generativelanguage.googleapis.com/v1beta/models/<encodeURIComponent(model)>:generateContent`, headers
`Content-Type`, `x-goog-api-key`, body `{systemInstruction:{parts:[{text: system}]}, contents:[{role:"user", parts:[{text: userText}]}], generationConfig:{temperature:0, responseMimeType:"application/json", responseSchema: prompts/text_response_schema.json}}`.
userText lines joined by `\n`: `TITLE: <title or (none)>`, `CHANNEL: <channel>`, `DESCRIPTION: <description or (empty)>`,
`TAGS: <tags joined ", " or (none)>`, `COMMENTS (unverified):`, then `(none)` or one `[i] <text, whitespace→one space, trimmed>` per comment.
Reply: `JSON.parse(candidates[0].content.parts[].text joined)`. Errors 429 rate_limited, 401/403 bad_key_or_forbidden,
404 model_not_found, other api_error, unreadable bad_output.
`checkEvidence(data, video, comments)`: sources title/description/tags (tags joined by " ")/comment (texts joined by
" \n "), all `normalize` = NFC, lowercase, whitespace runs → " ", trim. Per field: empty value → `{value:null, source:null,
evidence:null, confidence:null, supported:null}`; else `{...f, supported: quote found in that source AND the normalised
value is inside the quote}`. `is_about_specific_place` = Boolean(data.is_about_specific_place). `dish_group` = data's
value when it is a dish_groups key AND (dish or name is supported), else null.

Error replies for the video reading and text-only TikTok (status, code): rate_limited 503 `ai_busy` (Retry-After 60),
timeout 504 `timeout`, bad_key_or_forbidden 502 `ai_auth`, model_not_found 500 `server_config`, missing key 500
`server_config`, video_unavailable 422 `video_not_analyzable`, bad_output 502 `ai_bad_output`, network 502
`upstream_unreachable`, other 502 `upstream_error`. Exact messages: ERRORS.md.

## 9. Address from a web search (very last resort; when WEB_SEARCH_PROVIDER + WEB_SEARCH_KEY + GEMINI_API_KEY)
For each card whose name is `found` and location `not_found`, in card order: name = first name value with `"` and
whitespace runs → one space, trimmed, cut to 200. Remembered answers (found ones only, per process, folded name) are reused.
need = words of the name (`plain()` from SAVE.md split on spaces, without "/") minus
`tea house teahouse cafe coffee quan nha hang restaurant tiem bar shop store the and gia truyen`; none → skip.
Brave: `GET https://api.search.brave.com/res/v1/web/search?count=10&q=<encodeURIComponent(name + " địa chỉ")>` with
headers `Accept: application/json`, `X-Subscription-Token: <key>`, `redirect:"error"`; rows `web.results[] → {url, title, snippet: description}`.
results = each `{title: clean(title) cut 200, snippet: clean(snippet) cut 400}` (clean: strip tags, `&amp; &quot; &#x27; &#39;`,
whitespace → one space, trim), keep non-empty, first 8. Ask Gemini (generateContent, system prompts/web_address_system.txt,
user text `Restaurant name: <name>\n\n<results>\n#1: <title>\n<snippet>\n\n#2: ...\n</results>`, schema in `lib/upstream.js`).
Accept only: integer n within results, non-empty address and quote (trimmed, cut 200), the folded quote inside the folded
`title + " " + snippet` of result n, the folded address inside the folded quote, and every `need` word among that result's words.
Then location = `{status:"found", agreement:null, entries:[{value: address, origin:"web", source:"web_search",
source_detail:null, confidence:"medium", evidence: quote, timestamp:null, evidence_checked:true}]}` and maps/conflicts
are worked out again. Any failure: nothing changes.

## 10. Cache and versions
`PROMPT_VERSION` = first 8 hex of sha1(video_youtube.txt + text_youtube_system.txt + "result-format-9");
`TIKTOK_PROMPT_VERSION` = sha1(video_tiktok.txt + text_tiktok_system.txt + "result-format-9");
`PHOTO_PROMPT_VERSION` = sha1(photos.txt + text_tiktok_system.txt + "result-format-9") (expected a593f060, 9917c9e8, 5d067186).
Cache files in `CACHE_DIR` (default `cache/`), one JSON file per key (key with characters other than `A-Za-z0-9._-` → `_`).
The cache must survive a restart.
- File name: `<safe key>.json`.
- File content: `JSON.stringify({created_at, result})`.
- Write: create the folder if needed, write `<file>.tmp`, then rename it to `<file>`.
- Read: on every lookup, a missing or unreadable file = a miss.

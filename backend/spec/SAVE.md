# Saving, the library, map points, ShopeeFood and Ask

Field names and meanings: API_CONTRACT.md, EXTRACT_API.md. Current reply construction is in `server.js` and `lib/records.js`.

## 1. Text helpers (use these exact definitions)
- `normalizeText(s)` = NFD, remove U+0300–U+036F, `đ`/`Đ` → `d`, lowercase, every run of characters other than `a-z0-9`
  → one space, trim. ("Phở Thìn" → "pho thin")
- `plain(s)` = NFD, remove U+0300–U+036F, `đ`/`Đ` → `d`, lowercase, runs of characters other than `a-z0-9/` → one space,
  then `(\d) (?:duong|d) ` → `$1 ` (globally), trim.
- `identityText(s)` = normalizeText(s), or if that is empty: NFC, lowercase, whitespace runs → one space, trim.
- `withoutFloor(address)`: split on `,`, trim each part; drop leading parts matching `^(?:lầu|lau|tầng|tang|floor|level|fl|lvl)\b`
  (case-insensitive) while at least one part remains; rejoin with `, ` (unchanged if nothing was dropped).
- `streetOf(address)`: first part of withoutFloor(address) split on `,`, trimmed; match
  `^(?:số\s+)?\d+[a-z]?(?:\/\d+[a-z]?)*\s+(?:(?:đường|đ\.)\s*)?(.+)$` (case-insensitive); group 1 with `\s*\(.*$` removed,
  trimmed, or null.

## 2. The save payload (internal)
Each card of an analysis reply carries `save_token`: a token you design (HMAC-signed with `SAVE_TOKEN_SECRET`, bound to
the uid, 7-day expiry, refused when tampered with). It must carry, and verifying must return, exactly:
`{video: {platform, media, id, url, shared_url, title (cut 300), channel (cut 200), thumbnail}, venue_index (1-based),
card: {fields, conflicts, dish_group, match_score, maps_url, maps_note}, analysis: {model, prompt_version,
analysis_created_at: result.cache.created_at, cache_hit: result.cache.hit, mode: result.analysis_mode}, extras:
{script, comments}, iat: whole seconds of now()}`.
`shared_url` = `cleanSharedUrl(pasted link)`: cut at `?`/`#`, trim, `http:` → `https:`, add `https://` if no scheme,
lowercase the host; valid only if `^https://(?:www\.|m\.|vt\.|vm\.)?(?:youtube\.com|youtu\.be|tiktok\.com)/[A-Za-z0-9@._/-]{0,300}$`
and <= 600 chars, else null. Uploads: null.

## 3. The stored record (built from a verified payload)
`docId` = first 32 hex of sha256(dedupeKey): videoKey = `tiktok:<id>` | `upload:<id without "upload-">` | `<id>` (YouTube);
dedupeKey = name found/conflict ? `${videoKey}|n:${normalizeText(first name value)}`
: `${videoKey}|u:${venue_index}:${normalizeText(first dish value)}:${normalizeText(first location value)}`.
(`first value` = `entries[0].value` or null; normalizeText(null) = "".)
`restaurant_id` = first 32 hex of sha256(`restaurant|` + key): name status not not_found and a name value →
key `n:${identityText(name)}|s:${identityText(street)}` with street = streetOf(location value) only when location is
`found`, else null (identityText(null) = ""); otherwise key `u:${videoKey}|${venue_index}:${normalizeText(dish)}:${normalizeText(location)}`.

Record data (JSON keys in this order):
`schemaVersion: 4, savedAt (ISO of now()), tokenIssuedAt (ISO of iat*1000), source: {platform, media, videoId, videoUrl,
videoTitle, channel, thumbnail, venueIndex, model, promptVersion, analysisCreatedAt, cacheHit, analysisMode}, venue:
<card fields>, display: {name, dish, location, price} (first values), cate_name, cate_name_en (dish_groups.json names or
null), script, comments, matchScore, address (first location value when location is found, else null), latitude,
longitude, geoSource, shopeeFoodSearchUrl, shopeeFoodUrl, sharedUrl, userNote: null, savedVia, incomplete (name not_found),
missingFields (field names with not_found, in field order), hasConflict, conflictFields (card.conflicts), mapsSearchUrl,
mapsNote, searchText, aiExtractedUnverified: true`.
- `searchText` = normalizeText([title, channel, every entry value of every field (field order), and when there is a
  dish group its Vietnamese and English names].join(" ")) cut to 3000.
- `shopeeFoodSearchUrl` = name found ? `https://www.google.com/search?q=` + encodeURIComponent(`site:shopeefood.vn "<name without ">"` + (street ? ` <street>` : "")) : null
  (street = streetOf(first location value) when location is found).
- `geoSource` = `<provider>_<source>` (goong_name, goong_address, goong_branch, vietmap_name, vietmap_address, vietmap_branch) or null.

## 4. The public record (`records` in GET /api/library, `places` in the extract reply)
Keys in this order: `id, savedAt, source, venue, display, cate_name, cate_name_en, cate_id, restaurant_id, thumbnail_url,
script, comments, incomplete, missingFields, hasConflict, conflictFields, mapsSearchUrl, mapsNote, searchText, matchScore,
address, address_text, price_text, price_vnd, price_vnd_max, price_inferred, latitude, longitude, geoSource,
shopeeFoodSearchUrl, shopeeFoodUrl, sharedUrl, userNote, savedVia, is_saved, updatedAt, aiExtractedUnverified`.
- `cate_id` from dish_groups.json ids by the Vietnamese name; `restaurant_id` worked out again from the record (section 3).
- `thumbnail_url`: YouTube → source.thumbnail if https on `i.ytimg.com` or `*.ytimg.com`; TikTok → the kept cover path for
  this id turned into its full address (PIPELINE.md 5); else null.
- `address_text` = cleanAddress(address): whitespace runs → one space, trim, withoutFloor, remove `\s*\([^)]*\)`, split on
  `,`, trim each and strip leading/trailing `[.;:\s-]+`, drop empty parts, expand each part with the FIRST matching rule
  (case-insensitive, Unicode): `^(?:tp\.?\s*)?(?:hcm|hcmc|hồ chí minh|ho chi minh)$` → `Thành phố Hồ Chí Minh`;
  `^(?:tp\.?\s*)?(?:hn|hà nội|ha noi)$` → `Thành phố Hà Nội`; `^tp\.?\s*(\p{L}.*)$` → `Thành phố $1`; `^q\.?\s*(\d+)$` → `Quận $1`;
  `^q\.\s*(\p{L}.*)$` → `Quận $1`; `^p\.?\s*(\d+)$` → `Phường $1`; `^p\.\s*(\p{L}.*)$` → `Phường $1`; join `, `; nothing → null.
- price_*: only when price status is `found`: price_text = first value; price_vnd/max = Math.round(normalized.min/max);
  price_inferred = normalized.inferred; no normalized → amounts null; not found → all four null.
- `is_saved`: 1 or 0 from the library row; `updatedAt` = the row's update_time; `savedVia` one of app|extract_api|extract_csv|analyze or null.

## 5. `restaurants` (contract shape) and `video`
Each restaurant = the column of the same name in QUAN_HACKATHON_VIDEO_PLACES.md (ROWS.md has the formulas), keys
in this order: `video_id restaurant_id doc_id platform media url video_url shared_url title channel thumbnail_url
restaurant_name dish address address_text price_text price_vnd price_vnd_max price_inferred cate_id cate_name cate_name_en
latitude longitude geo_source maps_url maps_note shopeefood_url shopeefood_search_url shopeefood_kinds match_score
has_conflict conflict_fields incomplete missing_fields user_note is_saved saved_via script_text comments_status
comments_mood create_time update_time`, then `comments: [{id (1-based), text, sentiment or null, likes}]`.
The analyze reply's `video` = the result's video plus `video_id, video_url, shared_url, thumbnail_url (full cover address
or the YouTube thumbnail), script_text (each line as `[${timestamp || "--:--"} ${kind}] ${text}`, joined with " / ", or
null when there are no lines), duration_seconds, is_food_beverage: null`.

## 6. The library (SQLite, `LIBRARY_DB_PATH`)
One row per (uid, video_id, restaurant_id), unique (uid, doc_id), with `is_saved` 0/1, `create_time`, `update_time` (ISO),
and the record JSON. Every query filters by the uid from the verifier; parameters only.
- POST /api/analyze (and the upload route) stores every card it returns: record with savedVia `analyze`, `is_saved` 0,
  no map point and no ShopeeFood lookup (both null), create_time = update_time = savedAt. A row that already exists
  (same doc_id, or same video_id + restaurant_id) is left exactly as it is. `restaurants` shows the STORED row.
- Save by token (POST /api/library, the extract API): look up the place (section 7), build the record (savedVia `app`
  or `extract_api`; is_saved 1 only for `app`), insert. If a row is already there: an `analyze` row is REPLACED by this
  record (keeping its keys; create_time = update_time = now; reply `created: true`); a not-saved tool row hit by an `app`
  save gets `savedVia = "app"` and is_saved 1 (nothing else, not even update_time; `created: true`); otherwise
  `created: false`. Reply 201 `{id, alreadySaved: false}` or 200 `{id, alreadySaved: true}`.
- PUT .../save: not stored → 404; already saved → `{..., is_saved: 1}` with no change. Otherwise, for an `analyze` row run
  the lookup on its venue and set latitude, longitude, geoSource, shopeeFoodUrl; set savedVia `app`, is_saved 1, and for an
  `analyze` row also savedAt = create_time = update_time = now.
- DELETE .../save: is_saved 0 (nothing else). Reply `{video_id, restaurant_id, doc_id, is_saved: 0}`.
- PATCH note (both routes): note trimmed, blank → null, max 500 (413 `note_too_long`); sets userNote and update_time = now.
- DELETE /api/library/:id removes the row (and its comment rows when no user has that place any more).
- GET /api/library: `is_saved = 1` rows, `ORDER BY create_time DESC, doc_id ASC`, at most LIBRARY_MAX_LIST (200).
  `q` (max 200 chars): words = normalizeText(q) split; each must appear as ` <word>` (word start) in
  ` ${normalizeText([searchText, address_text, userNote, ...script line texts].join(" "))} `. `cate_id` must be 1-14
  (400 `bad_category`). Reply `{restaurants, records, truncated, limit}`.
- Shared tables (no uid): `restaurant(restaurant_id, name, street, create_time)` (first save names it) and
  `video_comments(video_id, merchant_id, comment_no, comments, sentiment, likes)` (written when a row is created or an
  analyze row is replaced, from `comments.items` when status is ok).

## 7. Looking up a place (on save)
name = first name value if name is `found`; address = first location value if location is `found`.
Map point (when GOONG_API_KEY or VIETMAP_SERVICES_KEY, and GEOCODING != "0"): provider chain Goong then VietMap (only the
ones with a key). A provider's call that fails (non-2xx, unreadable, or a 200 reply whose `status` matches
`DENIED|LIMIT|QUOTA|INVALID_KEY` or that has an `error` object) makes the whole lookup move to the next provider and
skips that provider for 10 minutes. Name and address are trimmed with whitespace runs → one space, cut to 300; the answer
for `lower(name)|lower(address)` is remembered (found points only). Calls of one provider are at least 250 ms apart.
Goong: `GET https://rsapi.goong.io/<path>&api_key=<key>`, searches `Place/AutoComplete?limit=10&more_compound=true&input=<text>`
then `Geocode?address=<text>`; rows from `predictions` (or `results`): `{id: place_id, name: structured_formatting.main_text || name,
text: name + " " + secondary_text + " " + description + " " + formatted_address, district: plain(compound.district)+"|"+plain(compound.province) (both needed) or null,
point: geometry.location or null}`; detail `Place/Detail?place_id=<id>` → `result.geometry.location`.
VietMap: `GET https://maps.vietmap.vn/api/<path>&apikey=<key>`, searches `autocomplete/v4?display_type=6&text=<text>` then
`search/v4?display_type=6&text=<text>`; rows `{id: ref_id, name, text: name+" "+address+" "+display, district: boundaries[type 1].id or null, point: null}`;
detail `place/v4?refid=<id>` → `{lat, lng}`. All requests: `headers {Accept: "application/json"}, redirect: "error"`; `<text>` encodeURIComponent.
`find(text, fits)`: for each search in order, the rows that fit; the first non-empty list wins.
Lookup(name, address):
1. name words = plain(name) words without "/" and `quan nha hang tiem cua restaurant the and`. named = find(name, row
   name's plain words contain every name word) (no words → []).
2. If named and address: addrHit = addressResult(address); if addrHit has a district and a named row has the same
   district → that named row, source `name`.
3. If address: addrHit (computed once) → source `address`.
4. No named → null. Else named[0] with source `branch` when the named rows' non-null districts are more than one, else `name`.
addressResult(address): text = withoutFloor(address); target = numberAndStreet(text); words = plain(text) words without
"/", `p`, `phuong`, `tp`, with `q` → `quan`; fits = target ? plain(row.text) includes target : (words non-empty and every
word is a word of plain(row.text)); the first fitting row of find(text, fits).
numberAndStreet(a) = plain(first comma part of withoutFloor(a)) with leading `so ` (before a digit) removed and
` (?:quan|phuong|q|p|tp|thanh pho|tx|thi xa)(?: .*)?$` removed; valid only if `^\d+[a-z]?(?:[/ ]\d+[a-z]?)* [a-z]`.
Point = the row's point, else the detail call; must be a valid lat/lng. The result is `{lat, lng, source, provider}`.

ShopeeFood lookup requires a restaurant name, address, WEB_SEARCH_PROVIDER=brave and WEB_SEARCH_KEY.
Search Brave for `site:shopeefood.vn "<name>" <street>`, then name + city when available.
Remove house numbers/ranges from the street; join a number-only comma segment to its following street first.
Match all normalized name words in the result title/snippet, plus street or city in the title/snippet or listing URL.
Do not require an exact numbered address or fetch listing HTML. Reject non-store URLs, brand/collection pages,
and results marked Not found/404. Return the first matching store, or null; retain the Google search fallback.
Cache successful matches by normalized name and full address to keep locality contexts separate.

## 8. Ask (POST /api/ask and POST /api/library/ask)
Reads the user's saved records (newest first, at most ASK_MAX_RECORDS 100). Question trimmed, 2–300 chars
(400 `bad_question`); session_id 1–64 of `[A-Za-z0-9_-]` (400 `bad_session`). Empty library → `EMPTY_LIBRARY` answer,
no AI call. Selection: tokens = unique normalizeText(question) words of length >= 2 not in the stop list (below); score per
record: +1 per token found as ` t ` in ` searchText ` (or, for tokens of 4+ chars, anywhere in it), +1 more when ` t ` is in
` normalizeText(display.name) `; matched = score > 0 sorted by score desc then newest; none matched → all; first 15.
Prompt: `<records>\n<JSON of the selected records as below>\n</records>\n\nQuestion: <question>`; record = `{ref: "R<i>",
saved_at, video_title, video_url, incomplete, restaurant_name: {status, values:[{value, source, confidence}]}, dish, location,
price, conflicting_fields, dish_group: cate_name or null, viewer_sentiment: {overall, positive, negative, neutral, mixed,
comments_marked} or null, note: "AI-extracted from a video, not independently verified"}`. System prompt prompts/ask_system.txt;
schema in `lib/upstream.js`. Answer check: citations `R<n>` resolve to the sent records (duplicates once); not answerable →
answer or NO_ANSWER; answerable with no answer or no valid citation → NO_ANSWER, missing "The answer could not be tied to a
saved restaurant."; every number of 2+ digits in the answer (`\d[\d.,]*` with `.`/`,` removed) must appear in the cited records'
entry values, video title/url or sentiment counts, else UNRELIABLE with missing "The answer contained a number that is not
in your saved records.". answer trimmed, cut 1500; missing cut 300.
Stop list: `the a an is are was were of to in on at for and or what which where when who whom do does did i my me we our you
your have has had any with that this it its how much many can could should would there their them they be been about from
by as if so than then saved save restaurant restaurants place places food eat eating quan an o la nao gi co cho toi cua va
nhung cac minh nhu the nay do di mon`. Texts: NO_ANSWER `I can't answer that from your saved restaurants.`; EMPTY_LIBRARY
`Your library is empty. Analyze a Short, save a restaurant, then ask me about it.`; UNRELIABLE `I couldn't produce a reliable
answer from your saved restaurants. Try asking in a different way.` Reply shapes: `server.js` (`ask` and `ask_old` paths).

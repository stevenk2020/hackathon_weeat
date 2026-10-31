# The `row` of the extract API and the `restaurants[]` columns

This version can copy extract results to PostgreSQL when `PG_WRITE_ENABLED=1`. The two API replies use the same values
as the destination tables, so their rules are here:
- `POST /api/extract` → `row` = the `hackathon_video_places` row for this user and link, keys in the order of
  `row_columns.json`, already typed (below). `postgres` and `postgres_places` are `"off"` by default and become
  `"written"` or `"failed"` together when the optional PostgreSQL transaction is enabled.
- `restaurants[]` in the analyze and library replies = columns of `quan_hackathon_video_places` (SAVE.md section 5).

## `row` (one per user + link)
Values (empty string / undefined → NULL; `is_saved`, `cache_hit` → boolean from "yes"/true; the seconds, place_count,
script_lines, comments_count → numbers):
- From the extract API: `url` = cleanSharedUrl(link) or the link cut at `?`/`#`; is_saved "no" if any card failed to save
  else "yes"; error = "save failed: <code>" per failure joined "; "; platform/media/video_id/video_url/title from the
  result's video; shared_url from the first saved record; analysis_mode; cache_hit; warnings = result warnings joined
  " / "; analyze_seconds = (now − start)/1000 with 1 decimal, save_seconds, total_seconds likewise; then the place and
  extras columns; user_note NULL.
- Place columns over the list (each value: true → "yes", false → "no", null/""/[] → "(none)", array → joined ", ",
  then all joined " | "): place_count (number of records), names (display.name), price_text, price_vnd, price_vnd_max,
  price_inferred, addresses (address || display.location), address_text, cate_name, cate_name_en, match_scores
  (matchScore), conflicts (conflictFields), missing (missingFields), latitudes, longitudes, geo_sources, maps_urls
  (mapsSearchUrl), shopeefood_urls (shopeeFoodUrl || shopeeFoodSearchUrl), shopeefood_kinds ("store" | "search" | null).
  dishes = ONE flat list, not a per-place column:
  - Take every display.dish (skip one that is not a string) and split it on `,;|`. In each part, whitespace runs → one
    space, then trim; skip empty parts.
  - `rest = part.slice(1)`; when `rest === rest.toLowerCase()`, the first character is lowercased. This compares the
    whole rest, not word by word: `Bánh mì` → `bánh mì`, but `Nem Nướng Ninh Hòa` stays as it is.
  - Drop case-insensitive duplicates, then join with ", ".
  - No dish at all → "" (NULL in the table, `null` in the extract `row`), never "(none)".
- Extras columns (from the first record, or the extract result): script_lines (count), script_text (line texts joined
  " / "), comments_status ("ok" or "unavailable (<reason>)", "" when none), comments_count, comments_mood (overall or ""),
  comments_text (each `[sentiment] text` or just `text`, joined " / ").

## `restaurants[]` columns (one per place; key order in SAVE.md section 5)
Column values from the public record `rec` (SAVE.md 4) and the stored data `data`
(helpers: str = non-empty string else null; int = integer else null; num = finite else null; bool; joined(list, ", ")
= non-empty array joined else null):
video_id source.videoId · restaurant_id rec.restaurant_id || rec.id · doc_id rec.id · cate_id · thumbnail_url ·
create_time rec.savedAt · update_time rec.updatedAt || savedAt · url (as the link row) · place_index int(venueIndex) ·
platform (or youtube) · media (or video) · video_url · shared_url rec.sharedUrl · title str(videoTitle) · channel ·
analysis_mode · model · prompt_version · analysis_created_at · cache_hit bool · restaurant_name/dish/location/price =
str(display.name/dish/location/price) · cate_name · cate_name_en · address · address_text · price_text · price_vnd ·
price_vnd_max · price_inferred · match_score rec.matchScore · latitude num · longitude num · geo_source · maps_url
rec.mapsSearchUrl · maps_note · shopeefood_url · shopeefood_search_url · has_conflict (=== true) · conflict_fields
joined · incomplete (=== true) · missing_fields joined · user_note ·
for each field F in (restaurant_name → prefix `name`, dish → `dish`, location → `location`, price → `price`):
`<p>_status`, `<p>_agreement`, then for entry 1 (no suffix) and entry 2 (suffix `_2`): `<p>_value`, `_origin`, `_source`,
`_source_detail`, `_confidence`, `_evidence`, `_timestamp` (str), `_evidence_checked` (bool); price also
`price_norm_vnd` round(min), `price_norm_vnd_max` round(max), `price_norm_currency`, `price_norm_inferred`,
`price_norm_basis` (each with `_2` for entry 2; null when the entry has no normalized) ·
script_status · script_reason · script_lines (count or null) · script_text (each `[${timestamp || "--:--"} ${kind}] ${text}`
joined " / ", null when none) · comments_status · comments_reason · comments_count · comments_mood (sentiment.overall) ·
comments_rated · comments_positive · comments_negative · comments_neutral · comments_mixed · comments_text (each
`[${sentiment || "unrated"}] (${likes} likes) ${text}` joined " / ") · search_text · schema_version (data) ·
token_issued_at (data) · ai_extracted_unverified true · saved_via (data.savedVia) · is_saved (1 if rec.is_saved === 1 else
0) · shopeefood_kinds. Meanings: QUAN_HACKATHON_VIDEO_PLACES.md. Only the columns listed in SAVE.md section 5 appear in API replies.

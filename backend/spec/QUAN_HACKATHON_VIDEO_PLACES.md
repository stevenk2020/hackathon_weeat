# Table metadata: `quan_hackathon_video_places`

The WeEat AI Food Library in PostgreSQL: **one row per user, video and restaurant**. Every value has its own column
(no JSON), so it can be filtered with plain SQL. In this API version, `POST /api/extract` copies rows here only when
`PG_WRITE_ENABLED=1`; other app routes continue to use SQLite only.

All of it is made by AI and can be wrong. Nothing here is a checked fact about a restaurant
(`ai_extracted_unverified` is always `true`).

## Table facts

| | |
|---|---|
| Database | `we_eat_ai` (PostgreSQL 16, on the app server; accepts user `quan` from `127.0.0.1` only) |
| Schema / table | `public.quan_hackathon_video_places` |
| Owner | `quan` |
| Grain | One row per (`user_id`, `video_id`, `restaurant_id`): one place of one video for one person. The live `is_saved` column is boolean. |
| Primary key | `quan_hackathon_video_places_pkey` (`user_id`, `video_id`, `restaurant_id`) |
| Foreign keys | `cate_id` → `cate_dim (cate_id)`. `user_id` holds `user_dim.user_id` but is **not** a foreign key yet (see [Constraints](#constraints-and-indexes)) |
| Indexes | `…_user_time` (`user_id`, `create_time DESC`), `…_user_url` (`user_id`, `url`), `…_restaurant` (`restaurant_id`) |
| Columns | 150 |
| Defined in | Existing PostgreSQL schema; the current field mapping is `lib/postgres.js` |
| Created by | External database setup; this API does not create or migrate the table |
| Written by | `POST /api/extract` when `PG_WRITE_ENABLED=1`; this API's other routes do not write here |
| Source of truth | The API's SQLite `library` table; PostgreSQL is an optional copy |

## Related tables

| Table | How it relates |
|---|---|
| `user_dim` | `user_id` = `user_dim.user_id`, found or created by the email submitted to `POST /api/extract`. |
| `cate_dim` | `cate_id` = `cate_dim.cate_id` (14 food categories, the same numbers as the app; names in `cate_name_vn` / `cate_name_en`). |
| `hackathon_video_places` | The same data with ONE row per (user, link), places joined with `\|`. Join on `user_id` + `url`. |
| `quan_hackathon_video_comments` | Individual comments, keyed by `video_id`, `merchant_id` (the restaurant ID), and `comment_no`. Written when comment reading succeeds. |

## How rows are written

- **Who is copied:** the email supplied to `POST /api/extract`, after the API key is checked.
- **When:** during that extract request, after local SQLite storage. A PostgreSQL failure rolls back the transaction and sets both response statuses to `"failed"`.
- **How:** places are upserted on the primary key. Existing saved state is preserved. The extract route does not delete places absent from a later analysis.
- **Empty = `NULL`:** a value that is missing is `NULL`, never an empty string. Lists are joined into one text column (`conflict_fields`, `script_text`, `comments_text`), with their counts in number columns.
- **Saved or not:** this extract route inserts `is_saved = false` (the live PostgreSQL column is boolean) and does not replace an existing true value on conflict. Local Save and Unsave routes do not sync to PostgreSQL in this version.
- **Two values for one field:** the AI reads each field (name, dish, address, price) from the video and from the title/description or TikTok caption. When both give a value, the second one is in the columns ending in `_2`. There are never more than two.

## Columns

"Null" = can the column be empty. Examples are from one real TikTok saved in the library, or made up where it has no value.

| # | Column | Type | Null | Meaning | Example |
|---|---|---|---|---|---|
| 1 | `user_id` | bigint | **no** | The person: `user_dim.user_id`, found by their Google email. Not a foreign key yet (see Constraints). | `3` |
| 2 | `video_id` | text | **no** | The video's own ID on YouTube or TikTok, or `upload-` + 16 hex characters for an uploaded file. | `7684125250686242069` |
| 3 | `restaurant_id` | text | **no** | The restaurant, the same in every video and for every user: same name (ignoring case and accents) on the same street. A place with no name has its own ID that never matches another. A matching rule on AI text, not a checked fact. | `b1dc839989350341be8c7a8a614d206d` |
| 4 | `doc_id` | text | **no** | The saved place's ID in the app (32 hex characters; the app's `/api/library/<id>`). | `92d002c012f1780b167745bace2fb241` |
| 5 | `cate_id` | smallint | yes | Food category number, see `cate_dim` (1 Chay … 14 Khác). | `14` |
| 6 | `thumbnail_url` | text | yes | The YouTube thumbnail, or the full address of a kept TikTok cover on the app server (`http://127.0.0.1:21001/covers/tiktok-<id>.jpg`, from `PORT`, or `COVER_BASE_URL` when set; hackathon only). A picture from the video, not of the restaurant. | `https://i.ytimg.com/vi/Dn3rgGz7SaQ/hqdefault.jpg` |
| 7 | `create_time` | timestamptz | **no** | When the user saved the place. | `2026-10-22 04:21:35+00` |
| 8 | `update_time` | timestamptz | **no** | When the saved place last changed (only the note changes it). | `2026-10-22 04:21:35+00` |
| 9 | `url` | text | **no** | The link the place came from: the pasted link without its tracking part, else the video address, else the upload ID. Joins `hackathon_video_places` on (`user_id`, `url`). | `https://vt.tiktok.com/ZSgUJ8q3E/` |
| 10 | `place_index` | integer | yes | Which place of the video: 1 = the first on the page. | `1` |
| 11 | `platform` | text | **no** | `youtube`, `tiktok` or `upload`. | `tiktok` |
| 12 | `media` | text | **no** | `video`, or `photo` (TikTok photo post or uploaded photos). | `video` |
| 13 | `video_url` | text | yes | The video's standard address. Empty for uploads. | `https://www.tiktok.com/@chanlovefoods/video/7684…` |
| 14 | `shared_url` | text | yes | The link the user pasted, without its tracking part. Empty for uploads. | `https://vt.tiktok.com/ZSgUJ8q3E/` |
| 15 | `title` | text | yes | The video's title. TikTok: "TikTok video by @creator" or the caption's first line; uploads: "Uploaded video" / "Uploaded photos". | `TikTok video by @chanlovefoods` |
| 16 | `channel` | text | yes | The creator. | `@chanlovefoods` |
| 17 | `analysis_mode` | text | yes | What the AI looked at: `video_and_text`, `text_only` (TikTok caption only, the video was not watched) or `media_only` (an upload, no text). | `video_and_text` |
| 18 | `model` | text | yes | The AI model that analyzed the video. | `gemini-3.5-flash-lite` |
| 19 | `prompt_version` | text | yes | Version of the AI instructions used. | `6022eb86` |
| 20 | `analysis_created_at` | timestamptz | yes | When the AI analyzed the video (earlier than `create_time` when the result came from the cache). | `2026-10-22 04:21:12+00` |
| 21 | `cache_hit` | boolean | yes | `true` = the result was a saved copy of an earlier analysis. | `false` |
| 22 | `restaurant_name` | text | yes | Name shown on the card. With a conflict: the first of the two values. | `Prem & Pi Vegetarian` |
| 23 | `dish` | text | yes | Dish shown on the card (can be a list as written). | `khay cuốn mùa nắng` |
| 24 | `location` | text | yes | Address shown on the card (with a conflict, the first value). | `Lầu 3-4, 187/15 Điện Biên Phủ, Tân Định` |
| 25 | `price` | text | yes | Price shown on the card, as written. | `185 000` |
| 26 | `cate_name` | text | yes | Food category in Vietnamese (an AI choice from a fixed list). | `Khác` |
| 27 | `cate_name_en` | text | yes | The same category in English. | `Other` |
| 28 | `address` | text | yes | The address, only when ONE address was found (empty when two compete). | `Lầu 3-4, 187/15 Điện Biên Phủ, Tân Định` |
| 29 | `address_text` | text | yes | A tidy copy of `address` for other services: no floor or bracketed notes, short forms written out (`Q.1` → `Quận 1`). Nothing added. | `187/15 Điện Biên Phủ, Tân Định` |
| 30 | `price_text` | text | yes | The found price as written. Empty for a conflict. | `65k` |
| 31 | `price_vnd` | bigint | yes | `price_text` as whole VND (lowest of a range). Empty when not a number or a conflict. | `65000` |
| 32 | `price_vnd_max` | bigint | yes | Highest of a range (same as `price_vnd` for one price). | `65000` |
| 33 | `price_inferred` | boolean | yes | `true` = the number was worked out from a short form (`65k`, `55xu`). | `true` |
| 34 | `match_score` | smallint | yes | The AI's own 0–100 score for how well it identified the place. Not checked. Empty for caption-only reads. | `100` |
| 35 | `latitude` | double precision | yes | Map point (Goong or VietMap) for the name or address the AI read. A vague address gives an area point. Not a checked location. | `10.7864` |
| 36 | `longitude` | double precision | yes | See `latitude`. | `106.6943` |
| 37 | `geo_source` | text | yes | What the point came from: `goong_name` / `vietmap_name` (the restaurant name), `goong_address` / `vietmap_address` (the address), or `goong_branch` / `vietmap_branch` (the name matched several branches in different districts and the map service's top one was used: maybe not the branch in the video). | `goong_name` |
| 38 | `maps_url` | text | yes | A Google Maps SEARCH link for the name and address (not a pinned place). | `https://www.google.com/maps/search/?api=1&query=…` |
| 39 | `maps_note` | text | yes | Set when the Maps link searches by name only (two addresses compete). |  |
| 40 | `shopeefood_url` | text | yes | The store's own ShopeeFood page, when the web search found one. | `https://shopeefood.vn/ho-chi-minh/…` |
| 41 | `shopeefood_search_url` | text | yes | A Google search limited to shopeefood.vn for the name and street (not a store link). | `https://www.google.com/search?q=site%3Ashopeefood.vn…` |
| 42 | `has_conflict` | boolean | **no** | `true` when the video and the title/caption disagree on any field. | `false` |
| 43 | `conflict_fields` | text | yes | Fields that disagree, joined with `, ` (`restaurant_name`, `dish`, `location`, `price`). | `price` |
| 44 | `incomplete` | boolean | **no** | `true` when at least one field was not found. | `false` |
| 45 | `missing_fields` | text | yes | Fields not found, joined with `, `. | `price` |
| 46 | `user_note` | text | yes | The user's own note on the place (max 500 characters). | `đi lúc 7h` |
| 47 | `name_status` | text | yes | Restaurant name: `found`, `conflict` (two values that disagree) or `not_found`. | `found` |
| 48 | `name_agreement` | text | yes | Restaurant name, two values that do not conflict: `match` or `differs_unclear`. Otherwise empty. |  |
| 49 | `name_value` | text | yes | Restaurant name: the first value (from the video when it gave one). | `Prem & Pi Vegetarian` |
| 50 | `name_origin` | text | yes | Where it was found: `video`, `metadata` (title, description, caption) `comment` (address only) or `web` (address only, from a web search). | `video` |
| 51 | `name_source` | text | yes | More exactly: `on_screen_text`, `spoken_audio`, `uncertain`, `title_description`, `viewer_comment` or `web_search`. | `on_screen_text` |
| 52 | `name_source_detail` | text | yes | For text: `title`, `description`, `tags` or `caption`. |  |
| 53 | `name_confidence` | text | yes | The AI's own confidence: `high`, `medium` or `low`. Not checked. | `high` |
| 54 | `name_evidence` | text | yes | The words the AI quotes as its source. | `Prem & Pi Vegetarian` |
| 55 | `name_timestamp` | text | yes | Where in the video (mm:ss). Empty for text. Not checked. | `00:40` |
| 56 | `name_evidence_checked` | boolean | yes | `true` = the quote was found in the real text (title, description, caption or comment); `false` = an unchecked AI quote from the video. | `false` |
| 57 | `name_value_2` | text | yes | Restaurant name: the second value (from the title, description or caption). |  |
| 58 | `name_origin_2` | text | yes | Same as `name_origin`, for the second value. | `metadata` |
| 59 | `name_source_2` | text | yes | Same as `name_source`, for the second value. | `title_description` |
| 60 | `name_source_detail_2` | text | yes | Same as `name_source_detail`, for the second value. | `caption` |
| 61 | `name_confidence_2` | text | yes | Same as `name_confidence`, for the second value. | `high` |
| 62 | `name_evidence_2` | text | yes | Same as `name_evidence`, for the second value. |  |
| 63 | `name_timestamp_2` | text | yes | Same as `name_timestamp`, for the second value. |  |
| 64 | `name_evidence_checked_2` | boolean | yes | Same as `name_evidence_checked`, for the second value. | `true` |
| 65 | `dish_status` | text | yes | Dish: `found`, `conflict` (two values that disagree) or `not_found`. | `found` |
| 66 | `dish_agreement` | text | yes | Dish, two values that do not conflict: `match` or `differs_unclear`. Otherwise empty. |  |
| 67 | `dish_value` | text | yes | Dish: the first value (from the video when it gave one). | `khay cuốn mùa nắng` |
| 68 | `dish_origin` | text | yes | Where it was found: `video`, `metadata` (title, description, caption) `comment` (address only) or `web` (address only, from a web search). | `video` |
| 69 | `dish_source` | text | yes | More exactly: `on_screen_text`, `spoken_audio`, `uncertain`, `title_description`, `viewer_comment` or `web_search`. | `on_screen_text` |
| 70 | `dish_source_detail` | text | yes | For text: `title`, `description`, `tags` or `caption`. |  |
| 71 | `dish_confidence` | text | yes | The AI's own confidence: `high`, `medium` or `low`. Not checked. | `high` |
| 72 | `dish_evidence` | text | yes | The words the AI quotes as its source. | `khay cuốn mùa nắng` |
| 73 | `dish_timestamp` | text | yes | Where in the video (mm:ss). Empty for text. Not checked. | `00:34` |
| 74 | `dish_evidence_checked` | boolean | yes | `true` = the quote was found in the real text (title, description, caption or comment); `false` = an unchecked AI quote from the video. | `false` |
| 75 | `dish_value_2` | text | yes | Dish: the second value (from the title, description or caption). |  |
| 76 | `dish_origin_2` | text | yes | Same as `dish_origin`, for the second value. | `metadata` |
| 77 | `dish_source_2` | text | yes | Same as `dish_source`, for the second value. | `title_description` |
| 78 | `dish_source_detail_2` | text | yes | Same as `dish_source_detail`, for the second value. | `caption` |
| 79 | `dish_confidence_2` | text | yes | Same as `dish_confidence`, for the second value. | `high` |
| 80 | `dish_evidence_2` | text | yes | Same as `dish_evidence`, for the second value. |  |
| 81 | `dish_timestamp_2` | text | yes | Same as `dish_timestamp`, for the second value. |  |
| 82 | `dish_evidence_checked_2` | boolean | yes | Same as `dish_evidence_checked`, for the second value. | `true` |
| 83 | `location_status` | text | yes | Address: `found`, `conflict` (two values that disagree) or `not_found`. | `found` |
| 84 | `location_agreement` | text | yes | Address, two values that do not conflict: `match` or `differs_unclear`. Otherwise empty. |  |
| 85 | `location_value` | text | yes | Address: the first value (from the video when it gave one). | `Lầu 3-4, 187/15 Điện Biên Phủ, Tân Định` |
| 86 | `location_origin` | text | yes | Where it was found: `video`, `metadata` (title, description, caption) `comment` (address only) or `web` (address only, from a web search). | `video` |
| 87 | `location_source` | text | yes | More exactly: `on_screen_text`, `spoken_audio`, `uncertain`, `title_description`, `viewer_comment` or `web_search`. | `on_screen_text` |
| 88 | `location_source_detail` | text | yes | For text: `title`, `description`, `tags` or `caption`. |  |
| 89 | `location_confidence` | text | yes | The AI's own confidence: `high`, `medium` or `low`. Not checked. | `high` |
| 90 | `location_evidence` | text | yes | The words the AI quotes as its source. | `Lầu 3-4, 187/15 Điện Biên Phủ, Tân Định` |
| 91 | `location_timestamp` | text | yes | Where in the video (mm:ss). Empty for text. Not checked. | `00:40` |
| 92 | `location_evidence_checked` | boolean | yes | `true` = the quote was found in the real text (title, description, caption or comment); `false` = an unchecked AI quote from the video. | `false` |
| 93 | `location_value_2` | text | yes | Address: the second value (from the title, description or caption). |  |
| 94 | `location_origin_2` | text | yes | Same as `location_origin`, for the second value. | `metadata` |
| 95 | `location_source_2` | text | yes | Same as `location_source`, for the second value. | `title_description` |
| 96 | `location_source_detail_2` | text | yes | Same as `location_source_detail`, for the second value. | `caption` |
| 97 | `location_confidence_2` | text | yes | Same as `location_confidence`, for the second value. | `high` |
| 98 | `location_evidence_2` | text | yes | Same as `location_evidence`, for the second value. |  |
| 99 | `location_timestamp_2` | text | yes | Same as `location_timestamp`, for the second value. |  |
| 100 | `location_evidence_checked_2` | boolean | yes | Same as `location_evidence_checked`, for the second value. | `true` |
| 101 | `price_status` | text | yes | Price: `found`, `conflict` (two values that disagree) or `not_found`. | `found` |
| 102 | `price_agreement` | text | yes | Price, two values that do not conflict: `match` or `differs_unclear`. Otherwise empty. |  |
| 103 | `price_value` | text | yes | Price: the first value (from the video when it gave one). | `185 000` |
| 104 | `price_origin` | text | yes | Where it was found: `video`, `metadata` (title, description, caption) `comment` (address only) or `web` (address only, from a web search). | `video` |
| 105 | `price_source` | text | yes | More exactly: `on_screen_text`, `spoken_audio`, `uncertain`, `title_description`, `viewer_comment` or `web_search`. | `on_screen_text` |
| 106 | `price_source_detail` | text | yes | For text: `title`, `description`, `tags` or `caption`. |  |
| 107 | `price_confidence` | text | yes | The AI's own confidence: `high`, `medium` or `low`. Not checked. | `high` |
| 108 | `price_evidence` | text | yes | The words the AI quotes as its source. | `185 000` |
| 109 | `price_timestamp` | text | yes | Where in the video (mm:ss). Empty for text. Not checked. | `00:34` |
| 110 | `price_evidence_checked` | boolean | yes | `true` = the quote was found in the real text (title, description, caption or comment); `false` = an unchecked AI quote from the video. | `false` |
| 111 | `price_norm_vnd` | bigint | yes | As whole VND (lowest of a range). Empty when not a number. | `65000` |
| 112 | `price_norm_vnd_max` | bigint | yes | Highest of a range. | `65000` |
| 113 | `price_norm_currency` | text | yes | Currency. | `VND` |
| 114 | `price_norm_inferred` | boolean | yes | `true` = worked out from a short form (`65k`, `55xu`). | `true` |
| 115 | `price_norm_basis` | text | yes | How the number was worked out. | `converted from slang/abbreviation unit: k` |
| 116 | `price_value_2` | text | yes | Price: the second value (from the title, description or caption). | `130K/bát` |
| 117 | `price_origin_2` | text | yes | Same as `price_origin`, for the second value. | `metadata` |
| 118 | `price_source_2` | text | yes | Same as `price_source`, for the second value. | `title_description` |
| 119 | `price_source_detail_2` | text | yes | Same as `price_source_detail`, for the second value. | `caption` |
| 120 | `price_confidence_2` | text | yes | Same as `price_confidence`, for the second value. | `high` |
| 121 | `price_evidence_2` | text | yes | Same as `price_evidence`, for the second value. |  |
| 122 | `price_timestamp_2` | text | yes | Same as `price_timestamp`, for the second value. |  |
| 123 | `price_evidence_checked_2` | boolean | yes | Same as `price_evidence_checked`, for the second value. | `true` |
| 124 | `price_norm_vnd_2` | bigint | yes | Same as `price_norm_vnd`, for the second value. | `130000` |
| 125 | `price_norm_vnd_max_2` | bigint | yes | Same as `price_norm_vnd_max`, for the second value. | `65000` |
| 126 | `price_norm_currency_2` | text | yes | Same as `price_norm_currency`, for the second value. | `VND` |
| 127 | `price_norm_inferred_2` | boolean | yes | Same as `price_norm_inferred`, for the second value. | `true` |
| 128 | `price_norm_basis_2` | text | yes | Same as `price_norm_basis`, for the second value. | `converted from slang/abbreviation unit: k` |
| 129 | `script_status` | text | yes | `ok` or `unavailable`. | `ok` |
| 130 | `script_reason` | text | yes | Why there is no script, e.g. `video_not_watched` (caption only) or `photo_post`. |  |
| 131 | `script_lines` | integer | yes | How many lines the AI wrote down (speech and on-screen text, max 60). | `16` |
| 132 | `script_text` | text | yes | The lines with time and kind (`speech` / `on_screen`), joined with ` / `. Original language, AI transcription, not checked. | `[00:00 on_screen] Nơi ăn chay đa dạng… / …` |
| 133 | `comments_status` | text | yes | `ok` or `unavailable`. | `unavailable` |
| 134 | `comments_reason` | text | yes | Why there are none: `tiktok`, `upload`, `disabled`, `none` or `error`. | `tiktok` |
| 135 | `comments_count` | integer | yes | How many top YouTube comments were read (max 20). | `20` |
| 136 | `comments_mood` | text | yes | Overall mood COUNTED from the marks: `positive`/`negative` when 60% of opinions agree, else `mixed`; `neutral` with no opinions. | `mixed` |
| 137 | `comments_rated` | integer | yes | How many comments got a mark from the AI. | `20` |
| 138 | `comments_positive` | integer | yes | Comments marked positive. | `12` |
| 139 | `comments_negative` | integer | yes | Comments marked negative. | `3` |
| 140 | `comments_neutral` | integer | yes | Comments marked neutral. | `4` |
| 141 | `comments_mixed` | integer | yes | Comments marked mixed. | `1` |
| 142 | `comments_text` | text | yes | Each comment with its AI mark and likes, joined with ` / `. Text only, never the commenter's name. | `[positive] (12 likes) Ngon / [negative] (0 likes) Đắt` |
| 143 | `search_text` | text | yes | Lowercase, accent-free text the app searches in. | `tiktok video by chanlovefoods …` |
| 144 | `schema_version` | smallint | yes | Version of the saved record's format (older saves have a lower number). | `3` |
| 145 | `token_issued_at` | timestamptz | yes | When the card was shown to the user (its Save button was made). | `2026-10-22 04:21:12+00` |
| 146 | `ai_extracted_unverified` | boolean | **no** | Always `true`: everything is AI-made and not checked. | `true` |
| 147 | `saved_via` | text | yes | How the place got into the library. This API writes `extract_api` for new extract rows and preserves an existing `app` value on conflict. | `extract_api` |
| 148 | `is_saved` | boolean | **no** | The live table uses `true` for a previously saved place and `false` for a place added by extract. This API preserves the existing value on conflict. | `false` |
| 149 | `shopeefood_kinds` | text | yes | `store` = `shopeefood_url` is the store's own ShopeeFood page; `search` = there is only the search link `shopeefood_search_url`; `NULL` = neither. The same values as the extract CSV. | `search` |
| 150 | `synced_at` | timestamptz | **no** | When this row was last written to PostgreSQL. | `2026-10-23 11:30:00+00` |

## Constraints and indexes

```sql
PRIMARY KEY (user_id, video_id, restaurant_id)
FOREIGN KEY (cate_id) REFERENCES cate_dim (cate_id)
CREATE INDEX quan_hackathon_video_places_user_time  ON quan_hackathon_video_places (user_id, create_time DESC);
CREATE INDEX quan_hackathon_video_places_user_url   ON quan_hackathon_video_places (user_id, url);
CREATE INDEX quan_hackathon_video_places_restaurant ON quan_hackathon_video_places (restaurant_id);
```

`user_id` is not a foreign key because `user_dim` belongs to database user `kien`, and a foreign key needs their
permission. A foreign key can be added after `GRANT REFERENCES ON user_dim TO quan;`:

```sql
ALTER TABLE quan_hackathon_video_places
  ADD CONSTRAINT quan_hackathon_video_places_user_fk FOREIGN KEY (user_id) REFERENCES user_dim (user_id) ON DELETE RESTRICT;
```

## Example queries

```sql
-- Everyone's vegetarian places under 100,000 VND, with a map point
SELECT u.user_email, p.restaurant_name, p.address_text, p.price_vnd, p.latitude, p.longitude
FROM quan_hackathon_video_places p JOIN user_dim u USING (user_id)
WHERE p.cate_name = 'Chay' AND p.price_vnd < 100000 AND p.latitude IS NOT NULL;

-- Prices where the video and the caption disagree: both values side by side
SELECT restaurant_name, price_value, price_origin, price_value_2, price_origin_2, url
FROM quan_hackathon_video_places
WHERE price_status = 'conflict';

-- The same restaurant saved from several videos or by several people
SELECT restaurant_id, min(restaurant_name) AS name, count(*) AS saves, count(DISTINCT user_id) AS people
FROM quan_hackathon_video_places
GROUP BY restaurant_id HAVING count(*) > 1 ORDER BY saves DESC;

-- Names the AI only heard (not written anywhere), for a manual check
SELECT restaurant_name, name_evidence, name_timestamp, url
FROM quan_hackathon_video_places
WHERE name_origin = 'video' AND name_source = 'spoken_audio';
```

## Things to know

- **Not checked:** values from the video (`*_origin = 'video'`) come with an AI quote and time that were not checked (`*_evidence_checked = false`). Only text quotes are checked against the real title, description, caption or comment, and even then the claim itself is not checked.
- **`restaurant_id` is a matching rule:** the same name on the same street counts as the same restaurant. Two branches on one street, or a misspelt name, can be wrong.
- **One email, two local libraries:** the extract route uses a `csv-` SQLite uid derived from the email. It does not merge with a Google sign-in library. PostgreSQL matches the email through `user_dim`.
- **Schema changes need a migration:** this API does not create or alter the PostgreSQL tables. Add any new columns to the database and `lib/postgres.js` together.
- **Personal data:** emails (through `user_dim`), notes and saved places. Use bound parameters, never commit an export, and keep `PG_PASSWORD` only in `.env`.

The existing live table has 150 columns. `synced_at` has a PostgreSQL `now()` default; `lib/postgres.js` supplies
the other 149 columns when copying extract results.

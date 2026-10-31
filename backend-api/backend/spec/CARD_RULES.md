# Card builder rules (the "quality core")

Module `lib/cards.js` exports three functions: `parsePrice(raw)`, `compareValues(field, a, b)` and
`buildResult(input)`. Pure functions, no I/O, no dependencies. Two worked input/output pairs are in
`example-1.json` and `example-2.json`: your output must match their `output` byte-for-byte in structure and values.

Fields: `FIELDS = ["restaurant_name","dish","location","price"]`. At most 5 venues are shown.

## 1. parsePrice(raw) -> null | {min, max, currency:"VND", inferred, basis}
Reads a Vietnamese food price. Case-insensitive. Not a string -> null.
- Text containing `$`, `usd`, `eur` or `€` -> null (never guess an exchange rate).
- Find numbers. A number is either written with thousands separators (`140,000`, `79.000`, groups of exactly 3
  digits after the first group of 1-3 digits) or a plain number with an optional decimal part using `.` or `,`
  (`1,5` means 1.5). A number may be followed (spaces allowed) by ONE unit written directly after it and not
  followed by another letter: slang units `k`, `nghìn`, `nghin`, `ngàn`, `ngan`, `xu`, `cành`, `canh`, or currency
  units `đ`, `d`, `vnd`, `vnđ`, `₫`. A unit followed by a letter (`35kg`) is not a unit.
- Range shorthand: a number with no unit that is below 1000 borrows the unit of the NEXT number
  (`25-30k`, `40 45 cành`, `40K đến 65K`).
- Amount of each number: slang unit -> number x 1000; currency unit -> the number itself; no unit and the number is
  >= 1000 -> the number itself; no unit and < 1000 (`40`, `3`) -> ambiguous, ignored.
- No usable amounts -> null. Otherwise `min`/`max` = smallest/largest amount, `currency` "VND", `inferred` true if at
  least one slang unit was used, else false. `basis` is the text
  `converted from slang/abbreviation unit: <units joined by ", " in first-seen order> (x1000)` when inferred, else
  `number written in VND`. Units are reported in their lowercase form.

## 2. compareValues(field, a, b) -> "same" | "conflict" | "unclear"
Compares the video's value with the title/description's value. If either is empty -> "unclear". When unsure say
"unclear": a conflict is only reported when it is clear.
- `price`: parse both with parsePrice; if either fails -> unclear; ranges overlapping (min<=other.max and
  other.min<=max) -> same, else conflict.
- Other fields compare sets of words. Normalise: Unicode NFD, remove combining marks, `đ`->`d`, lowercase, replace
  every run of characters other than a-z0-9 with a space. Only AFTER that cleaning (so every dot, comma or hyphen is already a space) glue district/ward numbers: `quan`/`q` followed by
  1-2 digits (optional spaces) becomes the single word `quan<N>`, `phuong`/`p` followed by 1-2 digits becomes
  `phuong<N>` (so `Q10` and `Quận 3` differ). Because the glue runs on the cleaned text, `Q.7`, `Q 7`, `q7` and `Quận 7` all
  become the same word `quan7`, and `P.9`, `Phường 9` and `p9` all become `phuong9`; the abbreviation `q` or `p` only
  counts when it is a whole word followed by the number. Drop stop words, then:
  either set empty -> unclear; no word in common -> conflict; one set fully inside the other -> same; else unclear.
- Stop words: restaurant_name: quan an tiem nha hang restaurant cafe cua o tai la va the.
  location: quan phuong duong tp thanh pho ho chi minh sai gon saigon hcm hcmc vietnam viet nam thu duc ha noi.
  dish: mon an ngon bat to phan cac loai dia chen. Any other field -> unclear.

## 3. buildResult(input)
`input` = `{video, videoResult, metaChecked, warnings?, textMissingWarning?, comments?}`
- `video`: `{platform?, media?, id, title, channel, thumbnail, durationSec, url?}`. platform `"youtube"` (default),
  `"tiktok"` or `"upload"`; media `"video"` (default) or `"photo"`.
- `videoResult`: the AI's reading of the video, or null when only text was read:
  `{venues:[{restaurant_name, dish, location, price, dish_group, match_score}], incomplete:boolean, script:[...]}`;
  each field is `{value, source, evidence, timestamp, confidence}` where `source` is `visual_text`, `spoken_audio`
  or `uncertain`; empty field has `value` null.
- `metaChecked`: the reading of the title/description (or caption), or null: per field
  `{value, source, evidence, confidence, supported}` (`supported` true only if the quote really is in the text),
  plus `is_about_specific_place` and `dish_group`.
- `warnings` default `[]`, `comments` default `{"status":"unavailable","reason":"error","items":[],"sentiment":null}`.

**Fields.** For every venue field build `{status, agreement, entries}`:
- A video entry exists if the video field has a value: `{value, origin:"video", source, source_detail:null,
  confidence, evidence, timestamp, evidence_checked:false}` with source mapped `visual_text`->`on_screen_text`,
  `spoken_audio`->`spoken_audio`, anything else->`uncertain`.
- A metadata entry exists only when reconciling (below), `supported` is true, it has a value, and for price the value
  parses with parsePrice: `{value, origin:"metadata", source:"title_description", source_detail: "caption" whenever
  the platform is "tiktok" (ALWAYS, whatever the text reader's own source says), otherwise its source>, confidence, evidence, timestamp:null, evidence_checked:true}`.
- Every price entry also gets `normalized` = parsePrice(value) (may be null) as its LAST key.
- 0 entries -> status "not_found", agreement null. 1 entry -> "found", agreement null. 2 entries -> compareValues of
  the video value and the metadata value: conflict -> status "conflict", agreement null; same -> "found" and
  agreement "match"; unclear -> "found" and agreement "differs_unclear".

**Video watched** (`videoResult` not null): take at most 5 venues. `reconcile` is true only when there is exactly ONE
venue and `metaChecked` is not null. **Text only** (`videoResult` null): `reconcile` = `metaChecked` is not null and
`is_about_specific_place` is true; then build ONE card from the metadata values only, and only if at least one field
is not "not_found"; otherwise no card and reconcile false.

**Card** `{id:"venue-<n starting 1>", fields, dish_group, match_score, maps_url, maps_note, conflicts}` with
`conflicts` = names of fields whose status is "conflict" in field order.
- `match_score`: the venue's `match_score` if it is an integer, else null (text-only cards: null).
- `dish_group`: the card's "basis" is the dish field, or the restaurant_name field if the dish is not_found; basis
  not_found -> null. If the basis has a video entry and the video venue has a `dish_group` -> that; else if it has a
  metadata entry and `metaChecked.dish_group` exists -> that; else null (the metadata group only when reconciling).
- Maps search link base `https://www.google.com/maps/search/?api=1&query=` + `encodeURIComponent(query)`.
  place = the location's first entry value when location is "found", else "".
  Name found -> query `<name>` plus a space and the place if any, note null.
  Name conflict -> maps_url null, note `Names conflict, so no Maps search link was made.`.
  Name not found -> if place is non-empty and (dish found, or the place contains a digit): query `<dish> <place>`
  (trimmed; dish is the first entry's value if the dish is found, else empty), note `The restaurant name was not
  found, so this Maps link searches by dish and area only.`; otherwise url null and note `The restaurant name and a
  usable location were not found, so no Maps search link was made.`.

**Result object** (keys in this order): `status` ("ok" if any card else "no_restaurant_info"), `disclaimer`
(`AI-extracted, not independently verified. Source labels, quotes and timestamps are written by the AI and have not
been checked against the video.`), `analysis_mode` (`video_and_text` if videoResult; `media_only` if videoResult and
platform is upload; else `text_only`), `video` (`platform, media, id, title, channel, thumbnail, duration_sec, url`:
thumbnail only for youtube and only an https `*.ytimg.com`/`i.ytimg.com` address, else null (for tiktok: the input thumbnail when it is exactly `/covers/tiktok-<this video's id>.<jpg|png|webp>`, the kept cover path from PIPELINE.md, else null); url = `https://www.youtube.com/shorts/<id>` for youtube, the input `url` for tiktok, null for
upload), `venues`, `incomplete` (`{more_venues_not_shown: videoResult?.incomplete === true, max_shown: 5, shown:
<cards>}`), `metadata_hints`, `conflict_count` (sum of cards' conflicts), `script` , `comments`, `warnings`.
- `metadata_hints` (same `source_detail` rule: "caption" for every TikTok): when NOT reconciling and `metaChecked` exists: for each field in FIELDS order whose metadata value
  is usable (supported, has value, price parses) one `{field, value, source:"title_description", source_detail,
  evidence, evidence_checked:true}`. Otherwise [].
- `script`: no videoResult -> `{status:"unavailable", reason: media==="photo" ? "photo_post" : "video_not_watched",
  lines:[]}`; with lines -> `{status:"ok", reason:null, lines}`; watched but empty -> `{status:"unavailable",
  reason:"empty", lines:[]}`.
- `warnings`: copy of the input warnings; when `metaChecked` is null and platform is not upload, append
  `textMissingWarning` (if undefined: `The title/description could not be analyzed, so only the video analysis is
  shown.`; if null: nothing).

# The TikTok readers: yt-dlp (videos) and gallery-dl (photo posts)

`createTikTokReaders` reads TikTok videos and photo posts through installed programs. The API tests use the captured program outputs in `spec/readers/`.

## Interface
`server.js` exports `createTikTokReaders(config, { fetchImpl, spawn })` → `{ tiktokVideo, tiktokPhotos }`.
- `tiktokVideo` is null unless `TIKTOK_YTDLP=1`; `tiktokPhotos` is null unless `TIKTOK_GALLERYDL=1`.
- `spawn` defaults to `node:child_process` `spawn`; `fetchImpl` is used for the photo downloads.
- `createApp` uses `deps.tiktokVideo` / `deps.tiktokPhotos` when given, else the readers from this function, built
  with `deps.fetchImpl`.
- Shapes:
  - `tiktokVideo.fetch(url)` → `{ok:true, videoBuffer, comments:[]}`
  - `tiktokVideo.details(url)` → `{ok:true, details:{caption, handle, author, coverUrl}}`
  - `tiktokPhotos.fetch(url)` and `firstPhoto(url)` → `{ok:true, photos:[Buffer], truncated, details}`
  - every failure → `{ok:false, error}`. Nothing ever throws.

## Running a program (both readers)
- `spawn(bin, args, { shell: false })`, the address as a plain argument after `--`.
- Output limit per reader (below): past it, `kill("SIGKILL")` and fail.
- A timer of `timeoutMs`: when it fires, `kill("SIGKILL")` → `timeout`. The first of timer, limit, `error` and
  `close` decides the result.
- `error` event with `code === "ENOENT"` (or `spawn` itself throwing) → `<reader>_missing` (`ytdlp_missing`,
  `gallerydl_missing`). Any other `error` event → `<reader>_failed`.
- Exit code other than 0 → `<reader>_failed`.

## yt-dlp (TikTok videos)
- Common arguments: `--no-warnings --no-playlist --no-cache-dir --impersonate chrome`.
- **Video:** common + `-f "b[filesize<=N]/b[filesize_approx<=N]" --max-filesize N -o - -- <url>`, where N =
  `VIDEO_UPLOAD_MAX_MB` × 1024 × 1024.
  - Standard output is the MP4 file, in raw bytes.
  - More than N bytes → `too_large`. Exit 0 with no bytes → `ytdlp_failed`.
  - One retry after 1.5 s, except for `too_large` and `ytdlp_missing`. The answer is the last try's result.
- **Details:** common + `-J --skip-download -- <url>`.
  - Real output: `spec/readers/ytdlp-details-video.json` (signed `?...` parts cut, cookies removed).
  - More than 2 MB, or not JSON → `ytdlp_failed`. No retry.
  - `caption` = `description` if a string, cut to 3000; else null.
  - `handle` = `uploader` if it matches `^[A-Za-z0-9._]{1,64}$`; else null.
  - `author` = `channel` trimmed, if not empty, cut to 200; else null.
  - `coverUrl` = the `url` of the entry in `thumbnails` whose `id` is `originCover`, else `cover`, else
    `dynamicCover`, else the top-level `thumbnail`. Kept only if a string of at most 4096 characters; else null.

## gallery-dl (TikTok photo posts)
- Arguments: `--config-ignore --no-input -q -o browser=firefox -j -- <url>`. Timeout `TIKTOK_GALLERYDL_TIMEOUT_MS`.
- Real output: `spec/readers/gallerydl-photo-post.json` (a post with 5 photos).
- Not JSON, not an array, or more than 4 MB → `gallerydl_failed`.
- Messages in the array:
  - `[2, post]`: the post itself.
  - `[3, address, post]`: one per file (the post's music track is one of them).
- **details:**
  - `post` = the `[2, post]` message, else the third element of the first `[3, ...]` message.
  - `caption` = `post.desc`, `handle` = `post.author.uniqueId`, `author` = `post.author.nickname`, `coverUrl` = null.
  - Cleaned exactly as for yt-dlp.
- **Addresses kept** (from the `[3, ...]` messages, in order):
  - https only.
  - Host = one of `tiktok.com tiktokcdn.com tiktokcdn-us.com tiktokv.com tiktokv.us byteoversea.com ibytedtos.com
    muscdn.com`, or a subdomain of one.
  - The pathname ends in `.jpg .jpeg .png .webp .heic`, any case.
  - None kept → `no_photos`.
- **Downloads:**
  - In order, at most 10 (`firstPhoto`: only the first). `truncated` = more addresses were kept than were taken.
  - Each: `fetchImpl(address, { redirect: "error", signal: AbortSignal.timeout(20000) })`.
  - Non-2xx, network error or empty body → `download_failed`.
  - A `content-length` larger than the bytes left, or the body growing past them → `too_large`. All the pictures
    together are at most `VIDEO_UPLOAD_MAX_MB` MB.
  - Bytes not starting like JPEG (`FF D8 FF`), PNG, WebP (`RIFF....WEBP`) or HEIC (`....ftyp` + a HEIF brand) →
    `not_a_photo`.
- **Retries:** 3 tries in all, pauses of 2 s then 4 s, for every failure except `too_large` and `gallerydl_missing`.
  The answer is the last try's result.
- Picture addresses carry signed tokens: never log, return or store them.

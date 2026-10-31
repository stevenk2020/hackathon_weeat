# WeEat API

Node.js 22.13+; run `npm ci` to install the PostgreSQL driver.

Copy `.env.example` to `.env` and set `YOUTUBE_API_KEY`, `GEMINI_API_KEY`, and a `SAVE_TOKEN_SECRET` of at least 32 characters. Set `FIREBASE_PROJECT_ID` for signed-in routes. Set `EXTRACT_API_KEY` (at least 32 letters, digits, `.`, `_`, or `-`) to enable `POST /api/extract`. Optional TikTok video and photo readers use installed yt-dlp and gallery-dl when `TIKTOK_YTDLP=1` and `TIKTOK_GALLERYDL=1`.

Run `npm start` or `node --env-file=.env server.js`. The default address is `http://127.0.0.1:3000`; `PORT` and `HOST` can override it. `GET /api/categories` is public. Personal routes require a Firebase ID token as `Authorization: Bearer <token>`. The extract route uses the configured extract API key instead.

The API stores library rows and individual comments in local SQLite (`data/library.db` by default; override with `LIBRARY_DB_PATH`) and analysis cache files in `cache/` (override with `CACHE_DIR`). Set `PG_WRITE_ENABLED=1` to copy `POST /api/extract` results to `public.hackathon_video_places`, `public.quan_hackathon_video_places`, and `public.quan_hackathon_video_comments` through `public.user_dim`. PostgreSQL writing is off by default.

Run `npm test` for the API tests. Use [API.md](API.md) as the source of truth for the extract API and share it with API consumers. Detailed field definitions are under `spec/`; runtime prompt files and category data also live there. The separate `inspection/` directory holds the local results from the eight-link comparison and always disables PostgreSQL writing.

TikTok thumbnails are image files in `TIKTOK_COVER_DIR` (`data/tiktok-covers` by default). PostgreSQL stores their URLs, so moving the database or code also requires moving this directory. Keep it on persistent storage. To restore images from a previous installation, run `node --env-file=.env scripts/restore-tiktok-covers.js /path/to/previous/data/tiktok-covers`. This copies valid cover files into the configured directory and preserves existing files. Set `COVER_BASE_URL` to the API address reachable by your frontend when deploying to a different host.

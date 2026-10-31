# Error replies

Every error is `{"error": {"code", "message"}}` with the status below. `${...}` parts are filled in as the code shows. Where one code has several messages, the context decides (see PIPELINE.md / SAVE.md).

| Status | Code | Message |
|---|---|---|
| 401 | `login_required` | Please sign in with Google to continue. |
| 503 | `auth_unavailable` | Could not check your sign-in right now. Please try again in a moment. |
| 401 | `session_expired` | Your sign-in expired. Please sign in again. |
| 401 | `invalid_token` | Your sign-in could not be verified. Please sign in again. |
| 429 | `rate_limited` | Too many tries. Please wait ${wait} seconds and try again. |
| 400 | `bad_request` | Send a nickname and the access code. |
| 400 | `bad_nickname` | Choose a nickname of 1 to 24 letters, numbers or spaces. |
| 401 | `bad_code` | That access code is not right. |
| 429 | `rate_limited` | Too many requests. Please wait ${ipSlot.retryAfterSec} seconds and try again. |
| 429 | `rate_limited` | Too many requests. Please wait ${slot.retryAfterSec} seconds and try again. |
| 415 | `bad_request` | Send JSON with Content-Type: application/json. |
| 413 | `bad_request` | Request body is too large. |
| 400 | `bad_request` | The request body is not valid JSON. |
| 400 | `invalid_url` | Please paste a public YouTube Shorts or TikTok video link, like https://www.youtube.com/shorts/XXXXXXXXXXX or https://vt.tiktok.com/XXXXXXXXX/ |
| 500 | `internal_error` | Something went wrong on the server. Please try again. |
| 413 | `file_too_large` | These files are larger than ${config.maxUploadMb} MB in total. Choose a shorter video, or fewer or smaller photos. |
| 415 | `bad_request` | Send the files as multipart/form-data. |
| 503 | `uploads_busy` | The server is analyzing other uploads right now. Please try again in a minute. |
| 400 | `bad_request` | The upload did not arrive completely. Please try again. |
| 400 | `invalid_url` | That link is not a TikTok link. |
| 400 | `invalid_url` | Paste a public TikTok video or photo post link here, or leave the link empty and upload the file on its own. |
| 400 | `bad_request` | The upload could not be read. |
| 400 | `mixed_files` | Choose one video or some photos, not both. |
| 400 | `no_files` | Choose a video or some photos to upload. |
| 400 | `mixed_files` | Choose only one video. |
| 400 | `too_many_photos` | Choose up to ${MAX_PHOTOS} photos. |
| 400 | `bad_request` | One of the files is empty. |
| 403 | `library_denied` | Your library storage refused the request. If this keeps happening, the Firestore security rules may not be published. |
| 503 | `library_quota` | The library database is busy or over its free quota. Please try again later. |
| 404 | `not_found` | That saved restaurant was not found. |
| 501 | `note_unsupported` | Notes need the SQLite library. The Firestore library cannot edit saved cards. |
| 504 | `timeout` | The library database took too long to respond. Please try again. |
| 502 | `upstream_unreachable` | Could not reach the library database. Check the server's internet connection. |
| 503 | `upstream_unavailable` | The library database is temporarily unavailable. Please try again. |
| 400 | `bad_request` | That request could not be processed. |
| 502 | `upstream_error` | The library database returned an unexpected error. |
| 413 | `save_token_too_large` | That save request is too large. |
| 410 | `save_token_expired` | This card is more than 7 days old. Analyze the video again, then save it. |
| 403 | `save_token_wrong_user` | This card was analyzed by a different account, so it cannot be saved here. Analyze the video again. |
| 400 | `invalid_save_token` | This card could not be saved because its save token is not valid. Analyze the video again. |
| 429 | `rate_limited` | You have saved a lot of cards recently. Please try again later. |
| 401 | `invalid_api_key` | Send the API key as Authorization: Bearer <key>. |
| 400 | `invalid_email` | Send the user's email address as \"email\". |
| 400 | `bad_query` | Search for at most 200 characters. |
| 400 | `bad_category` | cate_id must be one of the numbers from GET /api/categories. |
| 501 | `library_unsupported` | This needs the SQLite library (LIBRARY_STORE=sqlite). |
| 400 | `bad_request` | That is not a valid video_id and restaurant_id. |
| 413 | `note_too_long` | A note can be up to ${NOTE_MAX} characters. |
| 400 | `bad_request` | Send the changes as {\"edits\": {\"user_note\": \"...\"}}. |
| 501 | `edit_not_supported` | Only user_note can be edited so far. Editing the name, dish, price or address is not built yet. |
| 400 | `bad_request` | The only edit that can be sent is user_note. |
| 400 | `bad_note` | The note must be text, or null to clear it. |
| 503 | `ai_busy` | The AI service is busy or its free quota is used up. Wait a minute and try again. |
| 504 | `timeout` | The AI took too long to answer. Please try again. |
| 502 | `ai_auth` | The AI service rejected the server's API key. Ask the app owner to check the server configuration. |
| 500 | `server_config` | The configured AI model was not found. Ask the app owner to check GEMINI_MODEL. |
| 500 | `server_config` | The server is missing its Gemini API key. |
| 502 | `ai_bad_output` | The AI returned an answer that could not be read. Please try again. |
| 502 | `upstream_unreachable` | Could not reach the AI service. Check the server's internet connection. |
| 400 | `bad_session` | session_id must be 1 to 64 letters, digits, - or _. |
| 400 | `bad_question` | Please ask a question between ${MIN_QUESTION} and ${MAX_QUESTION} characters. |
| 429 | `rate_limited` | You have asked a lot of questions. Please wait ${slot.retryAfterSec} seconds and try again. |
| 502 | `upstream_error` | The AI service returned an unexpected error. |
| 400 | `bad_request` | That is not a valid saved-restaurant ID. |
| 405 | `method_not_allowed` | Use GET. |
| 404 | `not_found` | Not found. |
| 429 | `rate_limited` | Too many tries. Please wait ${ipSlot.retryAfterSec} seconds and try again. |
| 500 | `internal_error` | Something went wrong on the server. |
| 405 | `method_not_allowed` | Use POST. |
| 405 | `method_not_allowed` | Use GET or POST. |
| 405 | `method_not_allowed` | Use PUT or DELETE. |
| 405 | `method_not_allowed` | Use PATCH. |
| 405 | `method_not_allowed` | Use DELETE or PATCH. |
| 404 | `video_unavailable` | YouTube has no public video with that ID. It may be private, deleted, or the link is wrong. |
| 503 | `youtube_quota` | The YouTube API refused the request (daily quota may be used up). Try again later. |
| 500 | `server_config` | The server's YouTube API key is invalid. Ask the app owner to check the server configuration. |
| 500 | `server_config` | The server is missing its YouTube API key. |
| 504 | `timeout` | YouTube took too long to respond. Please try again. |
| 502 | `upstream_unreachable` | Could not reach YouTube. Check the server's internet connection and try again. |
| 502 | `upstream_error` | YouTube returned an unexpected error. Please try again. |
| 504 | `timeout` | The AI took too long to analyze this video. Please try again, or try a shorter video. |
| 422 | `video_not_analyzable` | The AI could not open this video. It must be public (not private or unlisted), and some videos cannot be analyzed. |
| 502 | `ai_bad_output` | The AI returned an answer that could not be read. Try the Refresh button. |
| 502 | `upstream_unreachable` | Could not reach the AI service. Check the server's internet connection and try again. |
| 502 | `upstream_error` | The AI service returned an unexpected error. Please try again. |
| 429 | `live_limit` | The server has reached its limit of new video analyses for now. Cached videos still work; try a new one later. |
| 422 | `video_too_long` | This video is ${video.durationSec} seconds long. The limit is ${config.maxVideoSeconds} seconds. |
| 422 | `video_not_analyzable` | The AI could not read this video file. Save the video again, or choose a different file. |
| 413 | `file_too_large` | These files are too large for the AI. Choose a shorter video or fewer or smaller photos. |
| 422 | `video_not_analyzable` | The AI could not read these photos. Choose different pictures (JPEG, PNG, WebP or HEIC). |
| 415 | `unsupported_video` | That file is not a video we can read. Choose an MP4 or MOV video. |
| 422 | `video_too_long` | This video is ${v.durationSec} seconds long. The limit is ${config.maxVideoSeconds} seconds. |
| 400 | `too_many_photos` | Choose between 1 and ${MAX_PHOTOS} photos. |
| 415 | `unsupported_photo` | One of the files is not a photo we can read. Use JPEG, PNG, WebP or HEIC pictures. |
| 400 | `invalid_url` | Please paste a public YouTube Shorts or TikTok video link. |
| 422 | `not_a_video` | That TikTok link doesn't lead to a video or photo post. It may be a profile. Copy the link from the post's Share button. |
| 404 | `video_unavailable` | TikTok has no public video at that link. It may be private, deleted, or the link is wrong. |
| 502 | `tiktok_lookup_failed` | TikTok did not let us open that share link. Open the video in a web browser and paste its full address (https://www.tiktok.com/@…/video/…) instead. |
| 504 | `timeout` | TikTok took too long to respond. Please try again. |
| 502 | `upstream_unreachable` | Could not reach TikTok. Check the server's internet connection and try again. |
| 502 | `upstream_error` | TikTok returned an unexpected answer. Please try again. |
| 422 | `media_mismatch` | That link is a TikTok photo post. Choose its photos, not a video file. |
| 422 | `media_mismatch` | That link is a TikTok video. Choose a video file, not photos. |
| 422 | `photo_caption_unavailable` | TikTok did not give us this photo post's caption. Choose \"Upload a video or photos\" (or attach the photos below the link) so the AI can read the photos instead. |
| 422 | `nothing_to_read` | This TikTok has no caption to read. Attach the ${isPhotoPost ? "photos" : "video file"} you saved from TikTok so the AI can look at ${isPhotoPost ? "them" : "it"}. |

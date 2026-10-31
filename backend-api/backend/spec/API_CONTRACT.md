# WeEat AI V2 — API Contract thống nhất (23/10/2026)

> Tài liệu này ghi lại hợp đồng thiết kế trước đây. Với API v0.2.0 hiện tại, xem [API.md](../API.md): chỉ `POST /api/extract` có thể ghi PostgreSQL khi `PG_WRITE_ENABLED=1`; các route cá nhân khác vẫn dùng SQLite.

**Trạng thái:** QUYẾT ĐỊNH THIẾT KẾ cho team. **Cập nhật 24/10/2026:** phần lõi (Analyze lưu quán với `is_saved = 0`, Save/Unsave, Library search/filter, sửa ghi chú, Categories, Ask) **đã code** trong repo trên branch `feature/dish-group-comments-script`, có test, **chưa commit, chưa deploy**. Phần nào đã có, phần nào chưa: xem **mục 10**. Mọi người code theo file này, nếu cần đổi thì sửa file và báo cả team.

## 1. Nguyên tắc dễ nhớ
- Frontend gửi yêu cầu và hiển thị kết quả. Backend xử lý Gemini/YouTube/TikTok, database, search, Ask và quyền truy cập.
- API response/request dùng **snake_case trùng chính xác tên cột trong CSV**. Không dùng camelCase, không tạo alias tùy ý. Các trường bổ sung chưa có trong CSV được ghi rõ là NEW.
- Dùng trực tiếp `video_id` trong CSV; backend phải chuẩn hóa URL để cùng một video trên cùng nền tảng có cùng `video_id`. Kết hợp `platform` nếu cần chống trùng ID giữa nền tảng; không tạo thêm trường `videoKey`.
- Mỗi record của một user/quán/video là duy nhất theo **(`user_id`, `video_id`, `restaurant_id`)**. `user_id` lấy từ Firebase token ở backend, không lấy từ body frontend.
- `doc_id` chỉ là mã tài liệu tham chiếu, **không dùng làm khóa unique cho Save**.
- Trả lỗi theo `{ "error": { "code": "...", "message": "..." } }`; UI hiển thị `message` dễ hiểu. `code` viết **chữ thường snake_case** như server đang trả (ví dụ `video_too_long`, `invalid_url`, `login_required`); frontend so sánh theo `code`, không theo `message`.

## 2. Luồng Find the Food → Save → Library
1. User dán URL, frontend gọi `POST /api/analyze`.
2. Backend nhận diện video, kiểm tra **duration > 300 giây** thì từ chối; non-F&B thì từ chối. Không tạo restaurant records cho hai trường hợp này. Nếu không lấy được duration, trả lỗi xác minh hoặc xử lý theo chính sách được team thống nhất; **không tự giả định video hợp lệ**.
   - *Thực tế (24/10):* giới hạn là biến `MAX_VIDEO_SECONDS`, **mặc định 190 giây** (YouTube Shorts tối đa 180 giây), chặt hơn 300; muốn đúng 300 thì đặt `MAX_VIDEO_SECONDS=300` trong `.env`. Lỗi: HTTP 422, `code = "video_too_long"`. Link TikTok **không có duration** (oEmbed không trả độ dài), nên `duration_seconds = null` và hiện server **vẫn phân tích** (chỉ đọc caption, trừ khi người dùng tải video lên) → team cần chốt chính sách cho trường hợp này. Kiểm tra non-F&B **chưa làm**: `is_food_beverage` luôn `null`.
3. Nếu phân tích thành công và tìm được quán, backend **upsert** từng quán theo bộ ba khóa, `is_saved = 0` (số nguyên) khi tạo mới. Nếu đã tồn tại, **giữ nguyên `is_saved`**. Nếu video F&B nhưng không tìm được quán, trả danh sách rỗng, không tạo restaurant record.
   - *Thực tế:* quán mới lưu với `saved_via = "analyze"`. Tọa độ (Goong/VietMap) và link ShopeeFood **chỉ tra ở lần Save đầu tiên** (để không tốn quota cho quán user không lưu), nên lúc Analyze `latitude`/`longitude` còn `null`.
4. Frontend hiển thị cards, nút Save. `PUT /api/library/{video_id}/{restaurant_id}/save` đặt `is_saved = 1` (số nguyên); `DELETE /api/library/{video_id}/{restaurant_id}/save` đặt `is_saved = 0` (số nguyên). Hai thao tác idempotent.
5. `GET /api/library` chỉ trả records `is_saved = 1` (số nguyên) của user đang đăng nhập.
   - *Thực tế:* `PUT` và `DELETE` trả `{video_id, restaurant_id, doc_id, is_saved}`; quán chưa có trong library của user (chưa Analyze) → 404 `not_found`. Lần Save đầu tiên đặt `create_time` = lúc Save. Nút Save cũ (`POST /api/library {saveToken}`) vẫn chạy và cũng đặt `is_saved = 1`.

**Lưu ý DB:** CSV `quan_hackathon_video_places` hiện **không có `is_saved`**, nên backend phải bổ sung cột integer 0/1, default 0 hoặc bảng quan hệ tương đương, cùng unique constraint trên ba khóa. Không chỉ chặn duplicate bằng frontend. Nếu có records cũ, xác định cách backfill `is_saved` trước khi migration; không mặc định tất cả đã saved.

*Thực tế (24/10):* nguồn chính là SQLite (`data/library.db`, bảng `library`, khóa chính `(uid, video_id, restaurant_id)` đã có từ trước). Đã thêm cột `is_saved INTEGER NOT NULL DEFAULT 0 CHECK (is_saved IN (0, 1))`. **Backfill:** `1` chỉ cho quán user đã bấm Save trong app (`saved_via = 'app'`); quán do extract-csv / extract API thêm vào (kể cả trước khi có `saved_via`) là `0`. PostgreSQL `quan_hackathon_video_places` là **bản sao** của SQLite (app không đọc từ đó), có thêm cột `is_saved` và `shopeefood_kinds`. Bảng đó đã có sẵn cột `is_saved` kiểu **boolean** (có người thêm tay, 84 dòng đang là `true`) → xem mục 10, việc còn mở. Cột `is_save` (text `yes`/`no`) cũ đã bỏ ngày 29/10 (trùng nghĩa với `is_saved`). Lưu ý: cột `is_saved` trong bảng `hackathon_video_places` và trong CSV extract là chuyện khác: "lưu thành công" (`yes`/`no`), **không** phải user đã bấm Save.

## 3. API endpoints — team dùng chung

| Endpoint | Frontend gửi | Backend trả | Màn hình |
|---|---|---|---|
| `POST /api/analyze` | `{url}` | `{video, restaurants[]}` | Discover |
| `PUT /api/library/{video_id}/{restaurant_id}/save` | Token | `{is_saved:1}` | Save |
| `DELETE /api/library/{video_id}/{restaurant_id}/save` | Token | `{is_saved:0}` | Unsave |
| `GET /api/library?q=&cate_id=` | Token, search/filter | `{restaurants[]}` | Library |
| `PATCH /api/library/{video_id}/{restaurant_id}` | `{edits:{restaurant_name,dish,price_vnd,address,user_note}}` | `{restaurant}` | Library Edit |
| `POST /api/ask` | `{session_id?,message}` | `{answer,references[],session_id}` | Ask |
| `GET /api/categories` | Không cần body | `{categories[]}` | Filters |
| `GET /api/profile` | Token | `{profile}` | Profile |
| `PATCH /api/profile` | `{user_address,user_lat,user_long,...}` | `{profile}` | Profile |
| `GET /api/map/places` | `mode=radius/route` và tham số tương ứng | `{restaurants[]}` | Map |

**Các endpoint là tên thống nhất đề xuất**, không phải khẳng định server hiện đã có. Backend member triển khai hoặc tạo adapter đúng tên này. Trong URL thực tế, `video_id` phải URL-encode.

*Thực tế (24/10):* đã có 7/10 endpoint ở trên (chưa có: `GET/PATCH /api/profile`, `GET /api/map/places`); bảng đầy đủ ở mục 10. Mọi endpoint (trừ `GET /api/categories`) cần `Authorization: Bearer <Firebase ID token>`. `video_id` là ID của nền tảng: YouTube 11 ký tự, TikTok dãy số, file tải lên `upload-<16 hex>`; `restaurant_id` là 32 ký tự hex.

## 4. Ví dụ dữ liệu chuẩn — giữ nguyên tên cột CSV

Các wrapper như `video`, `restaurants`, `references`, `answer`, `error` là cấu trúc API (không phải cột DB). Bên trong đối tượng, dùng đúng field DB. Ví dụ minh họa, không phải dữ liệu thực.

### Analyze request
```json
{"url":"https://www.youtube.com/shorts/abc123"}
```

### Analyze response
```json
{
  "video": {"video_id":"abc123", "platform":"youtube", "video_url":"https://www.youtube.com/shorts/abc123", "thumbnail_url":null, "script_text":"...", "duration_seconds":58, "is_food_beverage":true},
  "restaurants": [
    {"video_id":"abc123", "restaurant_id":"r001", "doc_id":"doc01", "restaurant_name":"Quán A", "dish":"Phở", "address":"TP.HCM", "latitude":10.76, "longitude":106.68, "price_vnd":40000, "price_vnd_max":60000, "cate_id":1, "is_saved":0, "shopeefood_url":null, "shopeefood_kinds":null}
  ]
}
```
`duration_seconds` và `is_food_beverage` là **API-only**, không thêm cột vào bảng restaurant. `is_saved` là **NEW trong bảng restaurant** (integer 0/1), dù đã xuất hiện trong CSV extract. `shopeefood_kinds` đã có trong CSV extract mới nhưng chưa có trong bảng restaurant; bổ sung đúng tên số nhiều này. Giá trị `is_saved=yes` của extract cũ không tự động tương đương với user đã bấm Save.

*Thực tế (24/10):* response thật có **thêm** các trường cũ (`venues`, `video.id`, `video.url`, `script`, `comments`, `warnings`...) để trang web hiện tại vẫn chạy; frontend mới chỉ cần đọc `video` (các khóa snake_case bên dưới) và `restaurants`.
- `video`: `video_id`, `platform` (`youtube` | `tiktok` | `upload`), `media` (`video` | `photo`), `video_url`, `shared_url`, `title`, `channel`, `thumbnail_url`, `script_text`, `duration_seconds`, `is_food_beverage` (luôn `null`, chưa kiểm tra).
- Mỗi phần tử `restaurants` (đúng tên cột `quan_hackathon_video_places`): `video_id`, `restaurant_id`, `doc_id`, `platform`, `media`, `url`, `video_url`, `shared_url`, `title`, `channel`, `thumbnail_url`, `restaurant_name`, `dish`, `address`, `address_text`, `price_text`, `price_vnd`, `price_vnd_max`, `price_inferred`, `cate_id`, `cate_name`, `cate_name_en`, `latitude`, `longitude`, `geo_source`, `maps_url`, `maps_note`, `shopeefood_url`, `shopeefood_search_url`, `shopeefood_kinds`, `match_score`, `has_conflict`, `conflict_fields`, `incomplete`, `missing_fields`, `user_note`, `is_saved`, `saved_via`, `script_text`, `comments_status`, `comments_mood`, `create_time`, `update_time`, và `comments: [{id, text, sentiment, likes}]` (mục 5). Trường không có giá trị là `null`, không bao giờ bịa.
- `is_saved` là `null` khi không biết (thư viện chạy Firestore, hoặc lưu SQLite bị lỗi; khi đó có thêm một dòng trong `warnings`).

### Ask response
```json
{
  "session_id":"s001",
  "answer":"Có một quán phở phù hợp trong Library của bạn.",
  "references":[{"video_id":"abc123", "restaurant_id":"r001", "doc_id":"doc01", "video_url":"https://www.youtube.com/shorts/abc123"}]
}
```
`answer` và `references` là wrapper response mới; `session_id` đã có trong chat CSV, còn ID bên trong references cần backend bổ sung vào kết quả Ask.

*Thực tế (24/10):* request là `{"session_id": "s001", "message": "..."}` (`session_id` tùy chọn, 1-64 ký tự chữ/số/`-`/`_`; không gửi thì server tạo mới). Response có thêm `answerable` (true/false) và `missing_information`. **Chưa lưu và chưa dùng lịch sử chat**: mỗi câu hỏi độc lập, `session_id` chỉ được trả lại; chưa ghi vào `dat_test_chat_message` / `tool_trace`.

### Profile response
```json
{"profile":{"user_id":1,"user_email":"demo@example.com","user_name":"Demo","user_address":"TP.HCM","user_lat":10.76,"user_long":106.68,"age":28,"food_interests":[],"food_notes":"","budget":"any"}}
```

### Category response
```json
{"categories":[{"cate_id":1,"cate_name_vn":"Chay","cate_name_en":"Vegetarian"}]}
```

## 5. Chốt hành vi theo màn hình
- **Discover:** Loading, lỗi URL, video dài, non-F&B, không tìm thấy quán và thành công phải có trạng thái riêng. Không tạo duplicate khi analyze lại.
- **Library:** Search server-side trên tên quán, món, địa chỉ, transcript, ghi chú; chỉ tìm dữ liệu user đã Save. *(Đã làm: mỗi từ trong `q` phải là đầu một từ trong tên, món, địa chỉ, giá, tiêu đề video, danh mục, transcript hoặc ghi chú; không phân biệt dấu và hoa/thường, ví dụ `q=pho thin` tìm "Phở Thìn"; `cate_id` sai → 400 `bad_category`.)* Category filter lấy từ `cate_dim` (14 loại hiện tại), không hardcode sáu loại. Edit cho sửa tên, món, giá, địa chỉ, ghi chú; **lưu phần chỉnh sửa của user riêng với dữ liệu AI gốc**, không ghi đè raw extraction. Unsave không xóa record. *(Đã làm: Unsave giữ record và ghi chú. Edit hiện **chỉ** sửa được `user_note`; gửi `restaurant_name`, `dish`, `price_vnd`, `address` → 501 `edit_not_supported` cho đến khi có chỗ lưu chỉnh sửa riêng.)*
- **Ask:** Chỉ dùng dữ liệu user có quyền xem; với câu hỏi về các quán đã lưu thì giới hạn `is_saved = 1` (số nguyên). Mỗi card tham chiếu trả `video_id + restaurant_id`, để mở đúng Details và focus Map pin. Không dùng tên quán để tìm ID.
- **Map Radius:** Frontend vẽ vòng tròn bán kính; backend trả các quán có tọa độ phù hợp. Khoảng cách bán kính là đường chim bay.
- **Map Along Route:** Cần tuyến đường thực từ routing service; lấy các quán trong hành lang khoảng cách do user chọn quanh đường đi, không thay bằng đường thẳng From–To. Bấm restaurant card phải focus pin, không chuyển sang Library. Nếu route service chưa sẵn sàng, hiển thị unavailable rõ ràng, không giả vờ lọc route.
- **Profile:** Sau đăng nhập lần đầu, bắt buộc nhập address; email lấy từ auth, không cho sửa. Name, age, budget tùy chọn. Budget enum: `any`, `under100`, `100to250`, `over250`; `user_dim` CSV hiện chưa có `budget`, backend phải bổ sung lưu trữ nếu tính năng này được bật.
- **Images:** `thumbnail_url` null thì dùng fallback frontend. **ShopeeFood:** Chỉ hiện link khi có URL hợp lệ và `shopeefood_kinds = store` (đã có trong extract CSV, cần thêm vào bảng restaurant); bảng restaurant cũ chưa có `shopeefood_kinds`, backend cần bổ sung hoặc xác nhận field từ nguồn khác. Không suy ra `store` chỉ vì có URL.
- **Comments:** API nên trả `comments: [{id,text,sentiment,likes}]` hoặc highlight đã xếp hạng; không bắt frontend parse chuỗi comments thô. *(Đã làm trên mỗi restaurant: `id` là thứ tự 1, 2, 3... trong danh sách, không phải ID của YouTube; `sentiment` là `positive` | `negative` | `neutral` | `mixed` | `null`, do AI đánh dấu, chưa kiểm tra. TikTok không có comments: danh sách rỗng.)*

## 6. Phân công theo module
| Người phụ trách | Trách nhiệm | Không làm |
|---|---|---|
| Frontend | UI, call API, loading/errors, Map pins, fallback ảnh | Không đọc DB trực tiếp; không tự đổi tên field |
| Backend Video | URL normalization, validation, Gemini extraction, analyze response, upsert | Không reset saved state |
| Backend Data | Firebase auth, uniqueness, Save/Unsave, Library, Edit, Profile, Categories | Không tin userId do browser gửi |
| Backend Ask/Map | Search/chat, citation references, map queries/routing integration | Không trả tên quán mà thiếu stable ID |

## 7. Việc cần làm trước khi merge (không phải tranh luận lại thiết kế)
- [x] Backend bổ sung `is_saved` hoặc bảng quan hệ tương đương và unique constraint `(user_id, video_id, restaurant_id)`; nếu dùng `video_id` hiện tại, chuẩn hóa ID theo platform ổn định. *(SQLite xong. PostgreSQL: cột kiểu boolean, xem mục 10.)*
- [ ] Backend xác nhận backfill cho dữ liệu cũ và nơi lưu user edits riêng khỏi AI raw. *(Backfill: xong, chỉ Save click = 1. Nơi lưu edits: chưa làm.)*
- [ ] Backend triển khai các endpoints theo bảng hoặc adapter tương thích; cung cấp mock JSON ngay nếu chưa xong. *(7/10 xong; còn Profile và Map.)*
- [ ] Cả team test 8 ca: video >300s; non-F&B; video F&B không có quán; video có 3 quán; Save lại; user khác Save cùng quán; re-analyze vẫn saved; Ask mở đúng Map pin. *(Có test tự động cho: video quá dài, video nhiều quán, Save lại, user khác không Save được quán của người kia, re-analyze vẫn saved, Ask trả đúng `video_id + restaurant_id`. Chưa có: non-F&B, Map pin.)*
- [ ] Xác nhận route service và field `shopeefood_kinds` trước khi bật hai chức năng phụ thuộc. *(`shopeefood_kinds` xong; route service chưa có.)*

**Nguyên tắc khóa:** Thay đổi API phải sửa file này trong GitHub, báo cả team, và update mock/test tương ứng trước khi merge.

## 8. Đối chiếu chính xác với 4 CSV đã upload

- `quan_hackathon_video_places`: 147 cột *(lúc viết file; nay là 150: thêm `saved_via`, `is_saved`, `shopeefood_kinds`; `is_save` đã bỏ ngày 29/10; danh sách đầy đủ ở `docs/QUAN_HACKATHON_VIDEO_PLACES.md`)*. Các field dùng trực tiếp: `user_id`, `video_id`, `restaurant_id`, `doc_id`, `cate_id`, `thumbnail_url`, `url`, `platform`, `media`, `video_url`, `shared_url`, `title`, `restaurant_name`, `dish`, `address`, `address_text`, `price_text`, `price_vnd`, `price_vnd_max`, `latitude`, `longitude`, `maps_url`, `shopeefood_url`, `shopeefood_search_url`, `user_note`, `script_text`, `comments_text`, `search_text`, `create_time`, `update_time`.
- `user_dim`: `user_id`, `user_email`, `user_name`, `user_address`, `user_lat`, `user_long`, `age`, `food_interests`, `food_notes`, `created_at`, `updated_at`.
- `cate_dim`: `cate_id`, `cate_name_vn`, `cate_name_en`. *(14 loại, số `cate_id` cố định 1-14, giống `lib/dish-groups.js`.)*
- `dat_test_chat_message`: `id`, `session_id`, `role`, `content`, `created_at`, `tool_trace`.

**NEW / không thấy trong CSV:** `is_saved` (integer 0/1, bắt buộc trong bảng restaurant), `duration_seconds` (API-only), `is_food_beverage` (API-only), `budget` (thêm vào `user_dim`), `shopeefood_kinds` (đã có trong extract mới, bổ sung vào bảng restaurant). Không trình bày các field này như thể đã tồn tại.

**Edit:** CSV hiện chưa có cấu trúc user override riêng; nếu cho sửa `restaurant_name`, `dish`, `price_vnd`, `address` mà không ghi đè AI gốc, backend phải thiết kế bảng/JSON override riêng. `user_note` có thể cập nhật trực tiếp.

**Chat session:** CSV chat message có `session_id`, nhưng không thấy bảng session/title riêng trong 4 CSV. Nếu UI cần title, backend cần endpoint/session store hoặc title derived từ nội dung.

**Quy tắc đặt tên:** mọi field trùng DB phải giữ nguyên `snake_case` chính xác; endpoint path/wrapper có thể do team định nghĩa, nhưng phải thống nhất trong file này.


## 9. Quyết định cuối cùng 23/10 — ưu tiên phần này nếu mâu thuẫn với phần trên

| Field | Nơi sử dụng chính thức | Quyết định |
|---|---|---|
| `is_saved` | `quan_hackathon_video_places` và API | **Integer 0/1**; default 0 khi analyze thành công; 1 khi user Save; 0 khi Unsave. Không dùng true/false hoặc `yes/no` trong API chính thức. |
| `is_food_beverage` | **Chỉ response `POST /api/analyze`** | Boolean; backend dùng để từ chối non-F&B trước khi insert restaurant; **không thêm cột DB**. |
| `duration_seconds` | **Chỉ response `POST /api/analyze`** | Số giây; video >300 giây bị từ chối trước khi insert restaurant; **không thêm cột DB**. |
| `shopeefood_kinds` | Bảng restaurant và API | **Giữ chính xác tên số nhiều trong CSV extract mới**, không đổi thành `shopeefood_kind`. Lưu cùng từng restaurant. |
| `budget` | `user_dim` và API Profile | Bổ sung vào `user_dim`; enum `any`, `under100`, `100to250`, `over250`; default `any`. |
| `tool_trace` | JSON trong bảng chat message | Giữ nguyên tên cột; thêm `video_id`, `restaurant_id` cho mỗi restaurant reference trong JSON. Không thêm cột ID riêng vào bảng chat message. |

**Chat `tool_trace` minh họa** (JSON nằm trong field `tool_trace`, không phải cột mới):
```json
{
  "references": [
    {"video_id": "abc123", "restaurant_id": "r001"}
  ]
}
```
Backend Ask phải trả cùng các reference này trong response để frontend mở đúng restaurant. Nếu dữ liệu chat cũ không có ID thì không được đoán ID từ tên quán.

**Lỗi analyze:** Ví dụ API-only (không tạo restaurant record):
```json
{
  "video": {"video_id": "abc123", "duration_seconds": 420, "is_food_beverage": true},
  "restaurants": [],
  "error": {"code": "VIDEO_TOO_LONG", "message": "Video dài hơn 5 phút."}
}
```
Với non-F&B: `error.code = "NOT_FOOD_BEVERAGE"`, `is_food_beverage = false`. Thứ tự xác minh duration/F&B có thể khác nhau, nhưng không lưu restaurant record nếu fail.

**Tính duy nhất:** (`user_id`, `video_id`, `restaurant_id`) áp dụng trong phạm vi user. Backend xác thực `user_id` từ token. Một video nhiều quán là hợp lệ; một user lưu cùng quán từ hai video khác nhau cũng hợp lệ. Nếu cùng một video được truy cập bằng nhiều URL, chuẩn hóa về cùng `video_id`.

**Điểm còn cần triển khai chứ không phải quyết định lại:** migration `is_saved`, `shopeefood_kinds`, `budget`; cấu trúc user overrides cho Edit; cập nhật `tool_trace` khi ghi chat; triển khai API và integration tests.

## 10. Trạng thái triển khai (24/10/2026)

Code nằm trong repo (`server.js`, `lib/api-shape.js`, `lib/library-sqlite.js`), có test tự động (`test/library-sqlite.test.js`, các test tên `contract: ...`). Chưa commit, chưa deploy: server đang chạy phải khởi động lại mới có. Các endpoint cũ của trang web hiện tại vẫn giữ nguyên.

| Endpoint | Trạng thái | Ghi chú |
|---|---|---|
| `POST /api/analyze` | Có | Lưu mọi quán tìm được với `is_saved = 0`; trả `video` + `restaurants` (mục 4). Chặn video quá `MAX_VIDEO_SECONDS` (mặc định 190 giây). Chưa chặn non-F&B. |
| `PUT /api/library/{video_id}/{restaurant_id}/save` | Có | `is_saved = 1`; lần đầu tra tọa độ + ShopeeFood. |
| `DELETE /api/library/{video_id}/{restaurant_id}/save` | Có | `is_saved = 0`, giữ record và ghi chú. |
| `GET /api/library?q=&cate_id=` | Có | Chỉ quán `is_saved = 1`; trả `restaurants` (mới) và `records` (cũ). Tối đa `LIBRARY_MAX_LIST` (200) quán mới nhất. |
| `PATCH /api/library/{video_id}/{restaurant_id}` | Một phần | Chỉ `{"edits": {"user_note": "..."}}` (tối đa 500 ký tự, `null` để xóa). Tên/món/giá/địa chỉ → 501. |
| `POST /api/ask` | Có | `{session_id?, message}` → `{session_id, answer, answerable, missing_information, references[]}`. Chỉ đọc quán `is_saved = 1`. Chưa lưu lịch sử chat. |
| `GET /api/categories` | Có | Không cần đăng nhập. 14 loại. |
| `GET /api/profile`, `PATCH /api/profile` | Chưa | Cần thêm `user_address`, `user_lat`, `user_long`, `budget` vào `user_dim` (bảng của kien). |
| `GET /api/map/places` | Chưa | Radius làm được từ `latitude`/`longitude`; Route cần routing service. |

Endpoint có sẵn từ trước, vẫn chạy: `POST /api/analyze/upload` (tải video/ảnh lên), `POST /api/library {saveToken}` (nút Save cũ, cũng đặt `is_saved = 1`), `DELETE /api/library/{doc_id}` (xóa hẳn record), `PATCH /api/library/{doc_id} {note}`, `POST /api/library/ask {question}`, `POST /api/extract` (cho server của teammate, xem `docs/API.md`).

Hành vi cần biết:
- Quán do extract-csv / extract API thêm vào có `is_saved = 0`, nên **không hiện trong Library** cho đến khi user Save (đúng quy tắc mục 4). Ví dụ: 28 quán trong library Google của owner đều do extract-csv thêm, nên Library của tài khoản đó sẽ trống sau khi khởi động lại server, cho đến khi bấm Save.
- Thư viện Firestore (`LIBRARY_STORE=firestore`, chỉ là dự phòng) không có các endpoint theo khóa: trả 501 `library_unsupported`.
- Bảng `hackathon_video_places` (của kien, 1 dòng mỗi link) chỉ nhận quán đã Save hoặc do tool thêm; quán chỉ mới Analyze thì không vào bảng đó.

Việc còn mở (cần team quyết):
1. **Kiểu cột `is_saved` trong PostgreSQL `quan_hackathon_video_places`:** cột đã được thêm tay kiểu `boolean NOT NULL DEFAULT false`, và 84 dòng extract-csv đang là `true` (trái quy tắc backfill ở mục 2). Code ghi 0/1 (PostgreSQL nhận được cả với cột boolean). Đề xuất: đổi sang `smallint` cho đúng mục 9 (`ALTER TABLE quan_hackathon_video_places ALTER COLUMN is_saved DROP DEFAULT, ALTER COLUMN is_saved TYPE smallint USING is_saved::int, ALTER COLUMN is_saved SET DEFAULT 0, ADD CONSTRAINT quan_hackathon_video_places_is_saved_check CHECK (is_saved IN (0, 1))`), thêm cột `shopeefood_kinds text`, rồi chạy `npm run sync-postgres` để lấy giá trị đúng từ SQLite.
2. Video TikTok không biết duration: phân tích hay từ chối?
3. Kiểm tra non-F&B (`is_food_beverage`): cần đổi prompt Gemini.
4. Nơi lưu chỉnh sửa của user (tên, món, giá, địa chỉ) tách khỏi dữ liệu AI.
5. Lịch sử chat cho Ask (`session_id`, `tool_trace`).
6. Profile và Map.

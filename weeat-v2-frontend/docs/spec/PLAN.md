# Kế hoạch đưa WeEat V2 từ mock lên bản chạy thật

Đối chiếu ngày 31/10/2026: đã đọc `AGENTS.md`, `specs/10_FINAL_DELTA_SPEC.md`, `specs/03_TARGET_SPEC.md`, `docs/API_CONTRACT.md`, spec Ask AI 07/11 và 15 ảnh trong `reference-screens-live/` (390, 820, 1280 px); so với code hiện tại trong `src/`. Code hiện có SPA React, các trang, dữ liệu mock, một số lời gọi API và khung giao diện. Chưa có thư mục `server/`; live mode hiện chưa thể đăng nhập, tra địa chỉ, xem Map hoặc dùng Ask AI đầy đủ.

Tiến độ bước 31/10: đã thêm `mapGeometry.ts`, `pinDistance.ts`, `links.ts`, `mapOrigin.ts` đúng import/export của locked tests. Năm file test tương ứng: **37/37 xanh**. `npm run typecheck` còn đỏ do nhiều test ngoài bước này import module chưa tồn tại (`mockData`, `mockApi`, server Ask AI, v.v.); các module vừa thêm được kiểm tra TypeScript riêng. Chưa nối bốn helper vào UI/live flow.

Thứ tự khi tài liệu xung đột: locked tests > spec 11 cho Ask AI > spec 10 > spec 07 > spec 03 > API contract cũ. Đặc biệt: cookie phiên thay Firebase token; DB chỉ có `is_saved` boolean (API trả 0/1), không dùng `is_save`; Map lọc Library ở client, không gọi `/api/map/places`; Along route lọc bằng ellipse dù vẫn vẽ tuyến xe máy thật; card Ask AI lấy từ event `references` do server chọn theo marker `[[n]]` và quy tắc fallback của spec 11. Ảnh là chuẩn bố cục; số lượng quán, ảnh món và vị trí pin là dữ liệu live nên có thể khác.

## Nền tảng

- [ ] Giữ mock mode chạy độc lập để phục vụ các test hiện có, đồng thời nối live mode với server cùng origin. `src/services/apiClient.ts` hiện chặn `base` rỗng và gửi Bearer token; cần `credentials: "include"`, cookie session, timeout và thông báo lỗi đúng contract. Giữ build production luôn ở live mode.
- [ ] Thêm adapter Google OAuth phía client (`liveAuth.ts`), khôi phục phiên bằng `/api/auth/me`, logout bằng `/api/auth/logout`, đồng bộ trạng thái guest → onboarding → ready; redirect người mới tới Profile để chọn Home có tọa độ. Không nhận `user_id` từ browser cho thao tác dữ liệu.
- [ ] Bổ sung cấu hình tên biến môi trường và script `start`, `migrate:ask`, `reindex`, `ask:log`; cài `pg`, `maplibre-gl`. Secret chỉ ở server env, không đưa vào `VITE_*`/Git. Tạo server phục vụ `dist/`, SPA fallback và `/covers/`; chuẩn bị cấu hình deploy trong workspace, không tác động production ở bước này.
- [ ] Duy trì giao diện responsive theo ảnh live: khung hẹp của Discover/Profile, lưới Library, bản đồ và dải card ngang, nav dưới ở 390/820/1280 px. Chuyển copy sang i18n EN/VI đúng `specs/i18n-delta.diff`; giữ target chạm đủ lớn và font input 16 px trên điện thoại. Khi sửa UI ở các bước sau, xem screenshot cạnh ảnh live.

## Server

- [ ] Tạo `server/index.mjs`, `config.mjs`, `db.mjs`, `session.mjs`, `google.mjs` bằng Node ES modules: `/api/health`, Google OAuth và cookie `weeat_session` ký/HMAC HttpOnly, xác minh Origin cho non-GET, lỗi JSON `{error:{code,message}}`, `/api/*` chưa triển khai trả 501. Chỉ dùng DB trong `.env.local`.
- [ ] Tạo `places.mjs` và mapping DB → API: `/api/categories` từ `cate_dim`; `/api/analyze`, `/api/samples`; `/api/library` với `q`, `cate_id`; PUT/DELETE save; PATCH edit; GET/PATCH profile. Khóa bản ghi theo `(user_id, video_id, restaurant_id)` với user lấy từ session; `is_saved` trong DB là boolean, API 0/1. Không đọc/ghi cột `is_save` hoặc sửa cấu trúc các bảng nguồn bị cấm.
- [ ] Analyze theo thứ tự DB trước: tìm video đã có của bất kỳ user nào, chép các quán sang user hiện tại nhưng không chép `user_note` hay saved state của người khác; chỉ video chưa có mới gọi crawl service. Chuẩn hóa link/ID; insert idempotent với `doc_id` ổn định và các cột NOT NULL (`has_conflict`, `incomplete`), giữ save khi analyze lại. Ánh xạ lỗi video dài, non-food, giới hạn, upstream; video không có quán trả danh sách rỗng. Proxy thumbnail TikTok qua `/covers/`.
- [ ] Save/Unsave phải idempotent và không xóa bản ghi khi unsave. PATCH chỉ cập nhật field được sửa; địa chỉ đổi phải có tọa độ và nguồn geocode được chọn; giới hạn ghi chú theo server. Search Library chỉ khớp tên quán, món, địa chỉ và không dấu; bỏ title/transcript/comments/note khỏi điều kiện. Trả category thật, không hardcode sáu loại.
- [ ] Profile lưu email từ OAuth, tên và Home label + lat/lng; chỉ cho trạng thái ready khi Home hợp lệ. `/api/samples` trả hai video gần nhất theo spec. Ghi các dữ liệu transcript/comments/giá/link ShopeeFood đúng nguồn để Details và card không mất thông tin; chỉ bật ShopeeFood cho URL cửa hàng hợp lệ.
- [ ] Giữ đối chiếu API ở spec 10 trong các bước triển khai: `/api/map/places` không sử dụng; `/api/ask` là fallback còn `/api/ask/stream` là luồng chính. Cập nhật tài liệu API cũ khi API thực tế được nối, tránh đem lại các quyết định đã bị spec 10 thay thế.

## Discover

- [x] Tạo `extractLinks` tách URL khỏi caption, thêm `https://`, giữ thứ tự/URL đầu tiên và khử trùng theo video. Helper trả mọi link; màn hình Discover áp giới hạn 10 theo locked test.

- [ ] Đổi input một URL hiện tại thành textarea nhiều link, dùng `extractLinks` và giới hạn 10 link tại màn hình; xử lý tuần tự, hiển thị `processingProgress`, kết quả cộng dồn, lỗi và Retry riêng từng link. Giữ nút Paste link với trạng thái clipboard bị từ chối.
- [ ] Hỗ trợ `?links=`, `?text=`, `?url=` từ share target: điền ô, xóa query khỏi URL, không tự analyze; giữ link qua đăng nhập bằng sessionStorage. Guest/onboarding thấy prompt phù hợp.
- [ ] Nối sample videos từ `/api/samples` cả trong live mode (hiện chỉ render ở mock); chạm sample mở video gốc. Recent Discoveries dùng quán đã lưu thật và cover proxy; trạng thái loading, không có quán, lỗi URL, video dài, non-food, API lỗi, Save từng quán/Save all hiển thị rõ. Bố cục hero, sample, recent theo ảnh live.
- [ ] Thêm manifest, icon và iPhone meta/install banner từ assets/spec để Android share-to-WeEat và PWA hoạt động; không tự khởi chạy khi nhận link.

## Library

- [ ] Nối danh sách saved của user thật với `/api/library`; đồng bộ sau analyze/save/edit/unsave và khi đổi user, giữ lọc platform/category/sort. Hiện `libraryMatches` và mock server còn tìm title/note; chỉnh khớp đúng tên quán, món, địa chỉ, không dấu. Tránh đếm/lưới lệch khi server trả kết quả search mới.
- [ ] Dùng category 14 loại từ `/api/categories`; duy trì trạng thái loading, rỗng, lỗi/retry, count và card grid như ảnh. Identity của quán luôn là bộ ba khóa; Details và Map deep link dùng ID ổn định.
- [ ] Nối Edit trên quán đã lưu: tên, món, giá, ghi chú và địa chỉ qua picker live; gửi tọa độ/`geo_source` khi đổi địa chỉ, không gửi free text thiếu tọa độ. Unsave chỉ đổi `is_saved`. Card giữ Details → Map → Watch → ShopeeFood và fallback ảnh khi thumbnail null; chỉ hiện link ShopeeFood cửa hàng thật.

## Địa chỉ

- [ ] Tạo `/api/geo/search?q=&st=`, `/api/geo/place?ref=`, `/api/geo/reverse?lat=&lng=`. Autocomplete chỉ trả label/ref; gọi Place Detail **một lần khi chọn**; GPS dùng reverse. Goong ưu tiên, VietMap fallback; key pool/rotation, cache, session token và giới hạn 40 geo calls/phút/user theo `docs/MAP_AND_GEO.md`.
- [ ] Sửa `locationService.ts` và `AddressPicker.tsx` cho live: tìm sau 600 ms khi ≥4 ký tự (≥3 nếu có số), địa chỉ của user trước, "Search more addresses", không tự chọn khi gõ/blur/Enter nếu chưa chọn suggestion. Trạng thái đang tìm/không có kết quả/lỗi và chống kết quả cũ ghi đè. Cùng picker dùng cho Profile, Edit, Map và location prompt Ask AI.
- [ ] Profile bắt buộc Home address đã chọn hoặc GPS có label + lat/lng. Map From/To chọn địa chỉ; trường hợp card Map thiếu tọa độ thì tra địa chỉ và chọn suggestion đầu tiên, hiển thị trạng thái resolving, không để picker phát thêm request trùng.

## Map

- [x] Tạo `mapGeometry.ts` (distance, polyline, vòng tròn, bounds, ellipse cùng hệ phẳng cục bộ) và `pinDistance.ts` theo locked tests. Tạo `mapOrigin.ts` lưu/đọc From gần nhất theo user, bỏ qua localStorage lỗi.

- [ ] Giữ bản đồ SVG mock cho test; live mode hiện chỉ hiện `mapBlocked`, cần `GoongMap.tsx` lazy load MapLibre. Lấy `style_url`/`key_tag` từ `/api/map/config`; đổi key một lần khi tile bị 401/403/429. Một map instance mỗi lần vào trang; pin GeoJSON có cluster, số, tên + khoảng cách (thường chỉ từ zoom 15), hover/selected label và các lớp vùng/route đúng thứ tự. Hình bản đồ, vòng tròn nét đứt, điều khiển zoom và dải card theo ảnh live.
- [ ] Map dùng Library đã load trong trình duyệt; Radius mặc định 5 km. Along route có bán kính riêng: live mặc định 3 km, mock 5 km; chip 1/3/5/10, `?radius=` được snap. `?restaurant=<restaurantKey>` mở Along route với To là quán. Empty state "Expand to 5 km" đặt cả hai bán kính về 5.
- [ ] Nối `mapGeometry.ts` vào trang live: Radius là khoảng cách chim bay; Along route lọc và vẽ ellipse hai tiêu điểm theo `|PA|+|PB| ≤ |AB|+2r`; thiếu To/A≈B dùng hình tròn. Category lọc pin, count, card cùng lúc; giữ quán đang chọn và báo số quán thiếu tọa độ.
- [ ] Tạo `/api/map/route` gọi Goong Direction `vehicle=bike`, cache 24 giờ; vẽ đường thật và tóm tắt km/phút, fit camera cả route lẫn ellipse. Nếu route lỗi/rỗng, báo rõ và hiện quán quanh From, không vẽ đường giả; cảnh báo khi hai điểm cách nhau >40 km.
- [ ] From/To marker kéo được: vùng/danh sách cập nhật trong lúc kéo, dragend reverse-geocode và tính route lại; chạm nền map trong Along route đặt To, chạm pin chọn quán. Pin/card dùng chung `getPinDistanceLabel` (~km từ From, To dùng km route khi có); card có số pin. Chạm thân card chọn pin và cuộn tới map khi map đang khuất; nút Map trên card ở mọi trang mở Along route với To là quán.
- [ ] Ask AI location đã xác nhận có thể lưu làm From gần nhất theo user; địa chỉ Home mới hơn được ưu tiên. Map vẫn có From mặc định từ Profile khi chưa có location chat.

## Ask AI

- [ ] Tạo các bảng/index riêng `weeat_place_index`, `weeat_chat_sessions`, `weeat_chat_messages`, `weeat_user_memory`, `weeat_ai_usage`, `weeat_ai_trace` bằng migration idempotent; không ALTER bảng nguồn. Đồng bộ index sau analyze/save/edit và tự kiểm tra độ mới trước lượt chat. Chỉ tìm quán `is_saved` của user hiện tại; hỗ trợ tên/món/địa chỉ, video transcript/comments, giá, category, vị trí và thống kê theo spec 07.
- [ ] Tạo `llm.mjs`, `ask.mjs`, `askTools.mjs`, `askTrace.mjs`, `placeIndex.mjs` dùng prompt và `tools.json` trong `docs/spec/ask-ai/` **nguyên văn**. Vòng tool call, timeout/failover, rate/token limit, usage/trace, ngôn ngữ EN/VI, memory và follow-up. Theo spec 11: tool trả ref 1..N, model đánh dấu `[[n]]`/`[[0]]`, server lọc marker kể cả khi bị cắt giữa các chunk; chọn card theo marker, rồi fallback theo tên được nhắc hoặc toàn bộ kết quả của lượt tìm nếu không có marker. Server phát `references`; client không đoán card từ text. Legend category và từ chỉ vị giác phải xử lý theo spec 11.
- [ ] Server triển khai `POST /api/ask/stream` với SSE `session`, `location`, `status`, `delta`, `references`, `location_prompt`, `done`, `suggestions`, `error`; `/api/ask` fallback; GET/DELETE sessions và memories. ID session/memory của user khác trả 404, client ngắt kết nối thì dừng model. Lưu chat, refs, suggestions và memory phía server.
- [ ] Client đọc SSE và cập nhật tin nhắn ngay khi gửi/delta; chỉ render card từ event `references`, link bằng `video_id + restaurant_id`. Session gần đây và memory tải từ server, xóa có xác nhận; nhớ active chat theo user. Render markdown an toàn, dấu đang suy nghĩ đến delta đầu, 1–3 follow-up chips, prompt chọn vị trí (GPS/Home/địa chỉ gõ tay) và tùy chọn lưu làm Home. Mock Ask AI vẫn hoạt động riêng.
- [ ] Chỉnh layout Ask AI như ảnh live: trang cố định, chỉ vùng tin nhắn cuộn; composer/nav luôn nhìn thấy, xử lý `visualViewport` khi bàn phím iOS bật. Desktop có sidebar ẩn/hiện và kéo rộng 240–420 px, mobile có drawer trap focus/Esc; nhớ trạng thái theo user. Mở trang/chuyển chat phải tới tin mới nhất trước frame đầu; chỉ tự cuộn khi user đang ở cuối. Input xóa ngay khi gửi, khôi phục khi lỗi và tránh tự bật bàn phím điện thoại.

## Việc nhỏ

- [ ] Đồng bộ copy EN/VI, error messages, placeholder To, số lượng/khoảng cách và thông báo route/địa chỉ theo spec; `check:i18n` cần chạy xanh ở bước sửa UI. Kiểm tra `?auth_error=` để người dùng thấy lỗi Google sign-in.
- [ ] Details hiển thị transcript, highlights comments, thông tin nguồn/giá/địa chỉ thật; không suy ra link đặt món chỉ vì có URL tìm kiếm. Ảnh thiếu dùng fallback. Giữ accessibility của input, drawer, nút và trạng thái lỗi.
- [ ] Sau mỗi bước code sau này: cập nhật file này, chạy test theo từng file liên quan, đối chiếu screenshot UI ở 390/820/1280 px; chỉ chạy cả suite cuối cùng. Không sửa locked tests, không chạy loop dịch vụ trả phí.

**Tiếp theo:** làm nền tảng/server auth + API và DB mapping trước; sau đó Discover/Library/Profile/địa chỉ; tiếp Map; cuối cùng Ask AI và polish theo ảnh/test. Mỗi bước triển khai là một commit riêng.

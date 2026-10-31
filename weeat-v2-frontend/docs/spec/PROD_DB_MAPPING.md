# Đối chiếu DB cũ → production (31/10/2026)

Đã kết nối cả hai DB bằng biến `PG*` và `PG*_PROD` trong `.env.local`, kiểm tra schema/dữ liệu bằng truy vấn đọc trước khi đồng bộ. Không ghi giá trị cấu hình hay dữ liệu cá nhân vào tài liệu này. `PGASSWORD_PROD` đang bị thiếu chữ **P**; công cụ đồng bộ chấp nhận cả tên này lẫn `PGPASSWORD_PROD`, nhưng nên đổi sang tên chuẩn.

## Schema và dữ liệu

| Bảng | DB cũ | Production | Cách map an toàn |
|---|---:|---:|---|
| `cate_dim` | 14 | 14 | ID và tên VN/EN giống nhau; dùng ID hiện có, không ghi. |
| `user_dim` | 17 | 18 | Cả 17 user cũ đều có trên production theo email không phân biệt hoa thường. Một ID đổi `154 → 169`; map theo email. Giữ profile production vì 3 user khác địa chỉ/toạ độ hoặc tên. |
| `quan_hackathon_video_places` | 481 | 401 → 412 | PK `(user_id,video_id,restaurant_id)`. Map `user_id` bằng email, chỉ INSERT khóa thiếu. Ban đầu có 360 quán trùng; **98** quán trùng khác `is_saved` (29 cũ saved/prod unsaved, 69 chiều ngược lại), **8** khác `user_note`, 5 khác tọa độ: không ghi đè. Có 121 quán chỉ ở DB cũ, gồm 110 quán (70 saved) của user test `extract-test@example.com`; đã thêm 11 quán còn lại (9 saved) thuộc 3 user thật. Production có 41 quán riêng, giữ nguyên. |
| `weeat_place_index` | 481 | 390 → 412 | Dữ liệu dẫn xuất từ bảng quán; không copy thô. Production ban đầu thiếu 11 hàng index và có 57 `is_saved` không khớp bảng quán. Đã reindex trong cùng transaction; hiện không còn hàng thiếu, hàng thừa hoặc lệch trạng thái lưu. |
| `weeat_place_embedding` | 0 | 210 | Giữ embeddings production; có 5 hàng không còn quán nguồn, không xóa tự động. |
| `weeat_chat_sessions` | 2 | 55 | UUID không trùng; 2 chat cũ thuộc user ID 2. Chỉ gộp nếu chủ dự án muốn giữ lịch sử chat cũ. |
| `weeat_chat_messages` | 4 | 266 | FK tới session. Nếu gộp chat, chép sau session và giữ UUID/refs/ui. |
| `weeat_user_memory` | 0 | 6 | Không có dữ liệu cũ cần chép. |
| `weeat_ai_usage` | 4 | 695 | ID số có trùng nhưng là log dùng token; không chép để tránh tính lại quota. |
| `weeat_ai_trace` | 2 | 115 | ID số có trùng; không chép khi chưa gộp chat. |
| `weeat_geo_audit` | không có | 64 | Chỉ có ở production; giữ nguyên. |

Mười bảng chung có cùng tên cột, kiểu dữ liệu và nullability (thứ tự cột ở vài bảng khác nhau). Chỉ `weeat_place_index.doc` khác default; reindex luôn cấp giá trị `doc`, nên không phụ thuộc default. PK/FK/unique/check constraints tương ứng giống nhau. Production không có quán/chat/memory/usage/trace mồ côi user; index không có hàng thừa. `pg_trgm`, `unaccent`, `vector` đã có ở production.

## Công cụ đồng bộ

`server/sync-prod.mjs` mặc định chỉ audit, không ghi dữ liệu. Nó xác nhận schema, category, map user bằng email và in số hàng dự kiến. Chế độ ghi chỉ thêm quán thiếu, giữ toàn bộ quán và profile đang có trên production, rồi sửa chỉ mục dẫn xuất trong cùng transaction. Nếu số hàng thay đổi so với audit hoặc chỉ mục chưa khớp sau khi ghi, transaction rollback. Đã chạy `--apply --expect=11`: thêm đúng 11 hàng; audit lại cho thấy còn 0 quán thiếu trong phạm vi user thật, 110 quán user test vẫn được loại trừ. Chat/session/memory/log giữ nguyên số hàng production.

```bash
# Audit mặc định: 11 quán của user thật, bỏ user test
node server/sync-prod.mjs

# Audit gồm user test: 121 quán
node server/sync-prod.mjs --include-test-user

# Lệnh ghi đã chạy cho phạm vi user thật; chỉ chạy lại nếu có quán mới:
node server/sync-prod.mjs --apply --expect=11
# hoặc: node server/sync-prod.mjs --apply --include-test-user --expect=121
```

Các chat/memory/log chưa nằm trong lệnh ghi trên. App hiện vẫn kết nối bằng `PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD`; thêm `PG*_PROD` một mình chưa đổi DB mà server đang dùng.

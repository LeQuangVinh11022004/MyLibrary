# Trang Sách

Thư viện cá nhân để lưu sách và tài liệu lên Supabase, sắp xếp theo thư mục, tìm kiếm, đánh dấu yêu thích/đã đọc và mở PDF, EPUB hoặc AZW3 trong trình đọc riêng toàn màn hình.

## Cấu trúc mã nguồn

- `src/App.jsx`: ghép giao diện trang thư viện và điều phối trạng thái.
- `src/components/`: sidebar, thanh công cụ, thẻ tài liệu, danh sách, hộp thoại đăng nhập/thư mục và toast.
- `src/hooks/useAuth.js`: phiên Supabase Auth và đăng nhập bằng mã ID.
- `src/hooks/useLibrary.js`: đọc/ghi thư viện, upload file/thư mục và thao tác tài liệu.
- `src/lib/`: khởi tạo Supabase và hàm định dạng/ánh xạ dữ liệu.
- `src/reader/`: trang đọc riêng, bộ đọc EPUB/PDF/AZW3 và cache tiến độ đọc.
- `src/styles.css`, `src/reader/reader.css`: style riêng cho từng màn hình.
- `index.html`, `reader.html`: hai entry point do Vite build.

## Chạy trên máy

Cần Node.js 22.13 trở lên. Từ thư mục dự án:

```powershell
Copy-Item .env.example .env.local
```

Điền `VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` vào `.env.local`, sau đó:

```powershell
npm install
npm run dev
```

Mở địa chỉ localhost do Vite hiển thị. Có thể tạo bản production và chạy thử bằng:

```powershell
npm run build
npm run preview
```

`.env.local`, `supabase-config.js` và `supabase-schema.sql` được Git bỏ qua. Giữ riêng cấu hình Supabase và chạy schema thủ công trong Supabase SQL Editor. Dùng public anon/publishable key ở frontend; tuyệt đối không dùng `service_role` hoặc secret key.

## Cấu hình Supabase

1. Tạo project Supabase trên gói Free.
2. Dùng nội dung `supabase-schema.sql` tại máy của bạn trong **SQL Editor** để tạo bảng, RLS, Storage bucket và policies.
3. Trong **Authentication → Settings → User Signups**, bật đăng ký khi tạo mã ID. Có thể tắt lại sau đó.
4. Bật **Email provider** và tắt **Confirm email**. Website chỉ yêu cầu mã ID; email tổng hợp chỉ được dùng nội bộ cho Supabase Auth.
5. Thêm URL local và URL website triển khai vào **Authentication → URL Configuration → Redirect URLs**.

Mã ID là bí mật đăng nhập. Ai có mã đều có thể truy cập thư viện; nếu mất mã và không còn phiên đăng nhập thì không thể khôi phục tài khoản. Mã được lưu trên thiết bị hiện tại nếu chọn ghi nhớ; hãy sao chép hoặc tải mã để dùng trên thiết bị khác.

## CI/CD GitHub Pages

Workflow nằm trong `.github/workflows/`:

- `ci.yml`: chạy `npm ci` và `npm run build` trên pull request và push lên `main`.
- `deploy.yml`: build rồi deploy tự động lên GitHub Pages khi push lên `main` (hoặc chạy thủ công).

Trong GitHub repository, thêm hai **Actions variables**:

- `VITE_SUPABASE_URL`: Project URL.
- `VITE_SUPABASE_ANON_KEY`: public anon/publishable key.

Sau đó vào **Settings → Pages**, chọn source **GitHub Actions**. Vite đã cấu hình base path cho repository `MyLibrary`; workflow build website và đưa nội dung `dist/` lên Pages. Các giá trị này được nhúng vào mã trình duyệt nên chỉ dùng public anon key, còn quyền truy cập dữ liệu phải được giới hạn bằng RLS.

## Dữ liệu và giới hạn

- File gốc nằm trong private Supabase Storage bucket `library-files`; metadata và thư mục nằm trong PostgreSQL.
- Hỗ trợ tải nhiều file hoặc cả thư mục, giới hạn client/storage 50 MB mỗi file.
- Tệp trùng nội dung trong cùng tài khoản được bỏ qua bằng SHA-256.
- Hỗ trợ xem trực tiếp PDF, EPUB, AZW3 không DRM, hình ảnh và một số file văn bản. Loại khác có thể tải xuống để mở bằng ứng dụng phù hợp.
- Tiến độ PDF (trang), EPUB (vị trí CFI) và AZW3 (chương) được lưu trong bộ nhớ trình duyệt theo tài khoản và tài liệu; mở lại trên cùng thiết bị sẽ tiếp tục từ vị trí đó. Tiến độ này không đồng bộ giữa các thiết bị và sẽ mất nếu xóa dữ liệu trình duyệt.
- Reader tối ưu cho điện thoại và tablet: trang PDF vừa chiều rộng, điều khiển chạm/swipe, EPUB/AZW3 hỗ trợ vuốt chuyển trang/chương, cùng tùy chỉnh cỡ chữ và nền sáng/sepia/tối.
- Không đưa Supabase service key vào client hoặc GitHub Actions variables.

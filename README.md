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

`.env.local`, `supabase-config.js` và `supabase-schema.sql` được Git bỏ qua. Giữ riêng cấu hình Supabase và chạy schema thủ công trong Supabase SQL Editor. Dùng public anon/publishable key ở frontend; tuyệt đối không dùng `service_role` hoặc secret key. Public key có thể nhìn thấy trong bundle trình duyệt; RLS, Storage policies và giới hạn Supabase mới là ranh giới bảo vệ dữ liệu.

## Chạy bằng Docker

Docker chỉ đóng gói frontend tĩnh; PostgreSQL, Auth và Storage tiếp tục chạy trên Supabase Cloud. Không mở cổng database ra Internet.

```powershell
Copy-Item docker.env.example docker.env
```

Điền URL và public anon/publishable key vào `docker.env`, sau đó:

```powershell
docker compose --env-file docker.env up --build -d
```

Mở `http://localhost:8080`. Nginx chạy non-root, filesystem chỉ đọc, có security headers, giới hạn request cơ bản và health check. Vite nhúng các giá trị `VITE_*` vào frontend trong lúc build; chúng không phải nơi lưu bí mật.

Giới hạn Nginx là lớp bảo vệ cơ bản cho container, **không phải biện pháp chống DDoS**: nội dung file và API Auth/DB đi trực tiếp tới Supabase. Khi public website, đặt CDN/WAF như Cloudflare trước hostname, bật managed WAF/DDoS protection, giới hạn request cho Auth và Storage phù hợp với lưu lượng thực, chỉ cho phép domain website cần thiết trong Supabase Auth URL configuration, và theo dõi cảnh báo/usage của Supabase. Không đưa service-role key vào container frontend. Cần cấu hình DNS/tài khoản CDN và Supabase Dashboard thủ công; repo không thể tự bật các dịch vụ đó.

## Mã hóa và dữ liệu riêng tư

Ứng dụng dùng TLS tới Supabase, private Storage bucket và RLS theo `auth.uid()`. Database/storage at-rest được nhà cung cấp Supabase quản lý; xác minh trạng thái, phạm vi và chính sách lưu trữ trong dashboard/tài liệu của project. Đây **không phải mã hóa đầu cuối**: Supabase vẫn xử lý dữ liệu sau khi xác thực. Không tự mã hóa dữ liệu ở frontend theo mặc định vì sẽ làm tìm kiếm, khôi phục tài khoản và xử lý nội dung sách phức tạp hơn. Không lưu khóa bí mật hoặc service-role key trong Vite variables, Docker image hay trình duyệt.

Tiến độ đọc đồng bộ qua cột `reading_progress`; nếu mất mạng, reader tiếp tục lưu tạm tiến độ trên thiết bị và thử đồng bộ lại khi mạng hoạt động. Dấu trang và ghi chú được lưu trong `reader_annotations` với RLS theo chủ sở hữu. Bản offline được lưu trong IndexedDB của trình duyệt và **không có mã hóa ứng dụng riêng**; chỉ bật trên thiết bị đáng tin cậy, xóa bản offline trước khi chia sẻ thiết bị.

## Blockchain proof-of-integrity

Không ghi sách, tên file, tài khoản hoặc metadata cá nhân lên blockchain. Một hash công khai vẫn có thể tiết lộ việc người dùng sở hữu một file đã biết; chỉ neo hash theo lựa chọn rõ ràng của người dùng. Contract mẫu nằm tại `contracts/FileHashRegistry.sol`.

1. Triển khai contract trên **Sepolia testnet** bằng ví của bạn (ví dụ qua Remix, compiler Solidity 0.8.24).
2. Đặt địa chỉ contract vào `VITE_FILE_HASH_REGISTRY_ADDRESS` trong `.env.local` hoặc `docker.env`, rồi build lại ứng dụng.
3. Trong reader, chọn biểu tượng dấu vân tay. Lần đầu ví sẽ yêu cầu ký; các lần sau kiểm tra hash hiện tại với bản neo của cùng ví. Giao dịch hash công khai và người dùng trả phí gas Sepolia.

Không đưa private key vào ứng dụng. Chỉ dùng testnet cho bản mẫu; cần review contract và quy trình triển khai độc lập trước khi dùng mạng chính.

## Giới hạn bảo vệ mạng

Không hệ thống nào đảm bảo website “không bị tấn công” hoặc miễn nhiễm DDoS. Nginx rate limit trong Docker chỉ giảm một phần lạm dụng vào frontend; nó không che chắn endpoint Supabase. Đưa domain sau CDN/WAF, bật DDoS protection và managed rules, giới hạn Supabase Auth/Storage theo khả năng của project, theo dõi quota/alerts, giữ RLS bật và dùng MFA cho tài khoản quản trị. Các thiết lập dashboard/CDN và key của project phải do chủ sở hữu cấu hình; Docker không thay thế các lớp đó.

## Cấu hình Supabase

1. Tạo project Supabase trên gói Free.
2. Với project mới, dùng nội dung `supabase-schema.sql` trong **SQL Editor** để tạo bảng, RLS, Storage bucket và policies. Với project đã có dữ liệu, chạy migration `supabase/migrations/20261027000000_reader_features.sql` trong SQL Editor để thêm tiến độ đồng bộ và dấu trang/ghi chú.
3. Trong **Authentication → Settings → User Signups**, bật đăng ký khi tạo mã ID. Có thể tắt lại sau đó.
4. Bật **Email provider** và tắt **Confirm email**. Website chỉ yêu cầu mã ID; email tổng hợp chỉ được dùng nội bộ cho Supabase Auth.
5. Thêm URL local và URL website triển khai vào **Authentication → URL Configuration → Redirect URLs**.

Mã ID là bí mật đăng nhập. Ai có mã đều có thể truy cập thư viện; nếu mất mã và không còn phiên đăng nhập thì không thể khôi phục tài khoản. Mã được lưu trên thiết bị hiện tại nếu chọn ghi nhớ; hãy sao chép hoặc tải mã để dùng trên thiết bị khác.

## CI/CD GitHub Pages và HTTPS

- `.github/workflows/ci.yml` chạy build và audit trên pull request, push lên `main`.
- `.github/workflows/deploy.yml` build rồi deploy lên GitHub Pages khi push lên `main` hoặc chạy thủ công.

Trong GitHub repository, thêm các **Actions variables**:

- `VITE_SUPABASE_URL`: Project URL.
- `VITE_SUPABASE_ANON_KEY`: public anon/publishable key.
- `VITE_FILE_HASH_REGISTRY_ADDRESS`: địa chỉ contract đã triển khai trên Sepolia (có thể để trống).

Vào repository **Settings → Pages → Build and deployment → Source**, chọn **GitHub Actions**. Sau khi workflow hoàn tất, mở URL GitHub Pages được hiển thị trong phần Pages/Actions, thường là `https://lequangvinh11022004.github.io/MyLibrary/`.

GitHub tự cấp và gia hạn TLS certificate cho domain `github.io`; không đưa file certificate/private key vào repository. HTTPS được hỗ trợ mặc định cho domain `github.io`. Trong **Settings → Pages**, bật **Enforce HTTPS** nếu tùy chọn này xuất hiện. Nếu sau này dùng custom domain, cần cấu hình DNS đúng và chờ GitHub xác minh/cấp certificate trước khi bật Enforce HTTPS.

Các `VITE_*` values được nhúng vào mã trình duyệt nên chỉ dùng public anon key; quyền truy cập dữ liệu phải được giới hạn bằng RLS. Không đưa Supabase service-role key hoặc private key blockchain vào Actions variables hay client.

## Dữ liệu và giới hạn

- File gốc nằm trong private Supabase Storage bucket `library-files`; metadata và thư mục nằm trong PostgreSQL.
- Hỗ trợ tải nhiều file hoặc cả thư mục, giới hạn client/storage 50 MB mỗi file.
- Tệp trùng nội dung trong cùng tài khoản được bỏ qua bằng SHA-256.
- Hỗ trợ xem trực tiếp PDF, EPUB, AZW3 không DRM, hình ảnh và một số file văn bản. Loại khác có thể tải xuống để mở bằng ứng dụng phù hợp.
- Tiến độ PDF (trang), EPUB (vị trí CFI) và AZW3 (chương) được lưu tại Supabase để đồng bộ giữa các thiết bị, đồng thời giữ bản tạm cục bộ để phục hồi khi mất mạng.
- Có thể lưu dấu trang, ghi chú, tìm nội dung trong PDF/EPUB/AZW3 và văn bản thuần; tìm kiếm PDF chỉ chuyển tới trang có kết quả, không tô sáng đoạn văn.
- Có thể chủ động lưu file vào IndexedDB để đọc offline trên thiết bị hiện tại. Bản offline không được mã hóa riêng bởi ứng dụng.
- Reader tối ưu cho điện thoại và tablet: trang PDF vừa chiều rộng, điều khiển chạm/swipe, EPUB/AZW3 hỗ trợ vuốt chuyển trang/chương, cùng tùy chỉnh cỡ chữ và nền sáng/sepia/tối.
- Không đưa Supabase service key vào client hoặc GitHub Actions variables.

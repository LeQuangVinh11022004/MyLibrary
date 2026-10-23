# Trang sách

Thư viện cá nhân lưu file trên Supabase Storage riêng tư, đồng bộ tài liệu và thư mục theo tài khoản. Đọc PDF trong trình xem tích hợp và đọc EPUB ngay trên trang.

## Cấu hình Supabase miễn phí

1. Tạo project Supabase trên gói Free và chờ project hoạt động.
2. Mở **SQL Editor**, dán nội dung `supabase-schema.sql` rồi chạy. Lệnh này tạo bảng thư mục/tài liệu, chính sách Row Level Security (RLS) và private Storage bucket `library-files` với giới hạn 50 MB cho mỗi tệp.
3. Trong **Project Settings → API**, sao chép **Project URL** và **anon/public key** (hoặc publishable key) vào `supabase-config.js`.
4. Không đưa `service_role`/secret key vào mã website. URL và anon/publishable key được dùng ở trình duyệt; RLS và chính sách Storage trong schema giới hạn từng tài khoản chỉ xem, tải lên và xóa dữ liệu của chính mình.
5. Trong **Authentication → Settings → User Signups**, bật **Allow new users to sign up** để tạo tài khoản. Nếu chỉ dùng cá nhân, có thể tắt lại sau khi tạo mã.
6. Trong **Authentication → Sign In / Providers**, bật **Email** (website dùng provider này nội bộ để đăng nhập bằng mã ID, không yêu cầu email thật). Trong cài đặt Email, tắt **Confirm email**.
7. Trong **Authentication → URL Configuration**, thêm URL triển khai vào Site URL và Redirect URLs.
8. Deploy thư mục lên GitHub Pages, Netlify hoặc Cloudflare Pages. Nhấn **Tạo tài khoản** để sinh mã ID, lưu mã lại, rồi dùng chính mã đó để đăng nhập.

Mã ID là một UUID ngẫu nhiên, đóng vai trò như mật khẩu: ai có mã đều có thể vào tài khoản. Khi đăng ký, có thể chọn ghi nhớ mã trong trình duyệt hiện tại; mã cũng có thể sao chép hoặc tải thành tệp để dùng trên thiết bị khác. Không nên ghi nhớ mã trên máy dùng chung. Nếu mất mã và không còn phiên đăng nhập, không thể khôi phục tài khoản. Không cần backend riêng hoặc bước build. Trình duyệt cần kết nối internet để đăng nhập, tải file và lấy thư viện đọc EPUB từ CDN. Giữ việc dùng trong quota hiện hành của gói Free; dung lượng/giới hạn của nhà cung cấp có thể thay đổi.

## Chạy trên máy

Chạy web server tĩnh trong thư mục này, ví dụ trên PowerShell nếu đã cài Python:

```powershell
python -m http.server 8000
```

Mở `http://localhost:8000`. Đăng nhập, tạo thư mục rồi tải file lên. Nút tải thư mục sẽ lưu các file đã chọn vào thư mục trên cùng của cây thư mục được tải lên; file vẫn có thể được tìm qua đường dẫn tương đối ban đầu.

## Lưu trữ và quyền riêng tư

- File gốc nằm trong private Supabase Storage; metadata (tên, thư mục, trạng thái đọc và yêu thích) nằm trong cơ sở dữ liệu Supabase.
- Cần đăng nhập để sử dụng. Các chính sách RLS và Storage trong `supabase-schema.sql` giới hạn dữ liệu theo tài khoản; không bật bucket thành public.
- Hỗ trợ tải nhiều file và thư mục. Giới hạn client và bucket được đặt là 50 MB mỗi file để phù hợp cấu hình Free thông thường.
- PDF, EPUB, hình ảnh và một số file văn bản có thể mở trực tiếp trong trình đọc của website. Định dạng khác có thể tải xuống để mở bằng ứng dụng phù hợp.
- Xóa một tài liệu sẽ xóa file gốc trong Storage và thông tin của file trong thư viện. Không thể tự khôi phục sau khi xóa.

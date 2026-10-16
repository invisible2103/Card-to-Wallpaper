# Lockscreen Magic

Khán giả tìm kiếm trên app ảo thuật → màn hình khoá iPhone của bạn đổi thành ảnh khớp với từ khoá.

```
App ảo thuật ──webhook──▶ Web app này ──tìm ảnh (Wikipedia)──▶ lưu ảnh mới nhất
                                                                    ▲
iPhone (Phím tắt + Tự động hoá) ──tải /api/w/<mã>.jpg───────────────┘ → Đặt hình nền màn hình khoá
```

Lưu ý: iOS không cho web app tự đổi hình nền. Phần đó do **Phím tắt (Shortcuts)** trên iPhone làm; hướng dẫn nằm ngay trên trang dashboard.

## Đưa lên mạng miễn phí (Vercel + Upstash Redis)

Cách này chạy 24/7, không bị "ngủ" nên không trễ khi biểu diễn. Làm được hoàn toàn từ trình duyệt, không cần cài gì.

### Bước 1. Đưa code lên GitHub
1. Đăng ký/đăng nhập https://github.com
2. Tạo repository mới (New repository), đặt tên tuỳ ý, để **Private** cũng được.
3. Giải nén file zip, rồi dùng **Add file → Upload files** kéo thả toàn bộ nội dung thư mục `lockscreen-app` (gồm `api/`, `public/`, `app.js`, `server.js`, `package.json`, `vercel.json`…) và Commit.

### Bước 2. Deploy lên Vercel
1. Đăng nhập https://vercel.com bằng tài khoản GitHub (gói Hobby miễn phí).
2. **Add New → Project**, chọn repository vừa tạo, bấm **Deploy** (không cần đổi cài đặt nào).

### Bước 3. Gắn cơ sở dữ liệu miễn phí (bắt buộc)
1. Trong project trên Vercel, vào tab **Storage** → **Create / Connect Database** → chọn **Upstash (Redis)** → gói **Free**.
2. Kết nối với project. Vercel tự thêm biến môi trường (`KV_REST_API_URL`, `KV_REST_API_TOKEN` hoặc `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`). App nhận được cả hai kiểu tên.
3. Vào tab **Deployments** → **Redeploy** để biến môi trường có hiệu lực.

### Bước 4. Kiểm tra
- Mở `https://<tên-project>.vercel.app/api/health` → phải thấy `"storage":"redis"`.
- Mở `https://<tên-project>.vercel.app` trên iPhone, thử ô "Thử nhanh". Có thể bấm Chia sẻ → **Thêm vào Màn hình chính** để dùng như app.

## Dùng
1. **Bước 1:** chép URL webhook, dán vào app ảo thuật.
2. **Bước 2:** nếu app gửi nhiều trường, nhập tên trường chứa từ khoá (vd `q`). Chọn ngôn ngữ Wikipedia.
3. **Bước 3:** thử một từ và xem ảnh hiện trong khung điện thoại.
4. Làm theo mục "Cài đặt trên iPhone" trên trang để tạo Phím tắt + Tự động hoá.

Nên đóng trang dashboard khi không dùng: trang tự hỏi server mỗi vài giây, mỗi lần tốn một lệnh Redis trong hạn mức miễn phí.

## Giới hạn của gói miễn phí
- Vercel Hobby chỉ cho dự án phi thương mại. Dùng thu phí, bán lại thì cần gói trả phí.
- Upstash Free và Vercel Hobby đều có hạn mức, đủ dùng cho biểu diễn cá nhân.
- Mã bí mật nằm trong URL, ai có URL đều đổi được hình nền của bạn. Đừng chia sẻ.

## Chạy local (tuỳ chọn)
Cần Node.js 18+:
```bash
npm install
npm start     # http://localhost:3000, dữ liệu lưu vào data.json
```

## API
| Đường dẫn | Mô tả |
|---|---|
| `GET/POST /api/h/<mã>` | Webhook. Tự nhận từ khoá trong `q, query, search, term, word, text, name...` |
| `GET/POST /api/h/<mã>/<từ khoá>` | Từ khoá nằm ngay trong URL |
| `GET /api/w/<mã>.jpg?w=1290&h=2796` | Ảnh hình nền đã cắt, dùng cho Phím tắt |
| `POST /api/reset/<mã>` | Về màn hình đen |
| `GET /api/health` | Kiểm tra kiểu lưu trữ |

## Mẹo biểu diễn
- Thử trước nhiều lần để biết độ trễ thật (app gửi từ khoá → tìm ảnh → Phím tắt chạy).
- Từ khoá mơ hồ thì dùng mục "ép từ khoá ra đúng ảnh" để chỉ định ảnh.
- Ảnh lấy từ Wikipedia/Wikimedia Commons, có thể có bản quyền riêng. Chỉ dùng cho biểu diễn.

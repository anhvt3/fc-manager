# ⚽ FC Manager - Project Handoff Document

## 1. Project Overview
**FC Manager** là một Progressive Web App (PWA) được thiết kế đặc biệt cho đội trưởng đội bóng (Low-tech friendly). Ứng dụng giúp số hóa toàn bộ quy trình quản lý đội bóng từ file Excel thủ công sang một hệ thống Web App hiện đại, kết nối trực tiếp với Google Sheets làm Database.

- **Frontend:** Vanilla HTML, CSS, JavaScript (Không Framework, siêu nhẹ).
- **Backend (BFF):** Vercel Serverless Functions (`/api/*`) chạy Node.js.
- **Data Layer:** Google Apps Script (`Code.gs`) đóng vai trò như một CRUD Driver siêu nhẹ.
- **Database:** Google Sheets.
- **Hosting:** Vercel (`fcfriend.vercel.app`).
- **Design System:** Mobile-first, Dark Theme, Glassmorphism, Custom UI.

---

## 2. Completed Features (Đã hoàn thiện)

### A. Kiến trúc Vercel Serverless BFF (Nâng cấp lớn nhất)
- Đã loại bỏ hoàn toàn việc gọi trực tiếp script.google.com từ trình duyệt của người dùng (tăng cường bảo mật và tốc độ).
- Xây dựng hệ thống API nội bộ trên Vercel:
  - `GET /api/init`: Kéo toàn bộ dữ liệu ban đầu.
  - `POST, PUT, DELETE /api/members`: Quản lý thành viên.
  - `POST, PUT, DELETE /api/matches`: Quản lý kết quả trận đấu.
  - `POST, PUT, DELETE /api/fixtures`: Quản lý lịch thi đấu.
  - `POST /api/funds`: Quản lý nộp quỹ.
- **Security:** Thêm `SCRIPT_KEY` xác thực 2 chiều giữa Vercel backend và Google Apps Script.

### B. Database Architecture (Google Sheets)
- Đã migrate dữ liệu sang 4 bảng chuẩn hóa:
  - `data.new.ThanhVien`: Quản lý danh sách thành viên.
  - `data.new.TranDau`: Quản lý lịch sử các trận đã đấu và kết quả.
  - `data.new.DongQuy`: Quản lý lịch sử nộp quỹ.
  - `data.new.LichThiDau`: Quản lý lịch thi đấu sắp tới.

### C. Backend Data Layer (`Code.gs`)
- Refactor toàn bộ `Code.gs` thành một Data Driver thuần túy. Code này KHÔNG chứa bất kỳ business logic nào nữa.
- Chỉ nhận payload chuẩn `{ action: "update", sheet: "...", matchColumn: 2, matchValue: "...", data: [...] }`.
- Tự động handle trailing spaces (`.trim()`) để fix triệt để lỗi không update được Google Sheets khi tên thành viên bị dư khoảng trắng.

### D. Frontend Modules (`app.js`, `index.html`)
- **UI Lịch thi đấu (Fixtures):** 
  - Đã thêm Tab "Lên kèo" với Bottom Navigation chuẩn layout 5 Tabs.
  - Có nút để tạo lịch mới, hiển thị Màu áo, Sân bóng đầy đủ.
  - Nút "Hoàn thành" giúp chuyển nhanh 1 Lịch thi đấu thành 1 Trận đấu (chỉ cần nhập kết quả Thắng/Thua).
- **Format Tiền tệ (Update mới nhất):** 
  - Fix logic hiển thị số dư quỹ: Quỹ dương hiển thị số bình thường và text màu xanh (VD: 1.5Mđ). Quỹ âm có thêm dấu `-` và text màu đỏ (VD: -500Kđ).
- **Dashboard:** Thống kê tổng dư quỹ, số trận, số thành viên. Biểu đồ Chart.js tự động cập nhật.

---

## 3. Deployment & Sync Instructions cho Đội Trưởng
*Lưu ý quan trọng:* Cập nhật cấu hình URL.
- **Vercel:** Hệ thống đã được đẩy lên Repo Github `fc-manager` và tự động deploy qua Vercel. Frontend và Vercel API đang chạy version mới nhất.
- **Google Apps Script:** Do `clasp` trên máy bị lỗi Auth (`Invalid script key`), anh cần Copy toàn bộ nội dung file `Code.gs` ở máy tính (đã được Antigravity fix lỗi `.trim()`), dán đè vào trình duyệt Google Apps Script Editor -> Bấm Save -> Bấm Deploy (Manage Deployments -> New Version).
- **Environment Variables:** Nếu Deploy ra URL Web App mới, cần sửa biến `SCRIPT_URL` trong file `api/_lib/googleClient.js` và Deploy lại Vercel bằng lệnh `vercel --prod` trên Terminal.

---

## 4. Code Structure
- `index.html`: Chứa toàn bộ giao diện, modal, bottom nav (đã fix lỗi hiển thị FAB).
- `style.css`: Hệ thống CSS Variables, Mobile-first responsive (đã fix vị trí nút tạo mới FAB cho Mobile).
- `app.js`: Logic App, State Management, thay thế 100% lệnh `fetch` cũ bằng `apiCall('/api/...')`.
- `data.js`: Cấu hình danh sách tháng nộp quỹ (`FUND_PERIODS`).
- `Code.gs`: Mã nguồn Google Apps Script (CRUD Data Layer).
- `api/`: Thư mục chứa các route Serverless API của Vercel (BFF).

*End of Handoff.*

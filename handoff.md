# ⚽ FC Manager - Project Handoff Document

## 1. Project Overview
**FC Manager** là một Progressive Web App (PWA) được thiết kế đặc biệt cho đội trưởng đội bóng (Low-tech friendly). Ứng dụng giúp số hóa toàn bộ quy trình quản lý đội bóng từ file Excel thủ công sang một hệ thống Web App hiện đại, kết nối trực tiếp với Google Sheets làm Database.

- **Frontend:** Vanilla HTML, CSS, JavaScript (Không Framework, siêu nhẹ).
- **Backend/Database:** Google Apps Script (REST API) + Google Sheets.
- **Hosting:** Vercel (`fcfriend.vercel.app`).
- **Design System:** Mobile-first, Dark Theme, Glassmorphism, Custom UI.

---

## 2. Completed Features (Đã hoàn thiện)

### A. Database Architecture & Migration
- Đã thiết lập script tự động chuyển đổi dữ liệu phi cấu trúc từ file Excel cũ sang 3 bảng chuẩn hóa:
  - `data.new.ThanhVien`: Quản lý danh sách thành viên.
  - `data.new.TranDau`: Quản lý lịch sử các trận đã đấu và kết quả.
  - `data.new.DongQuy`: Quản lý lịch sử nộp quỹ.
- **Fix Logic Thể thao:** Cập nhật logic nhận diện kết quả tự động (Ví dụ: "Đối thắng" = Đội nhà Thua, "Đối thua" = Đội nhà Thắng).

### B. REST API Backend (`Code.gs`)
- Xây dựng file `Code.gs` đóng vai trò làm API nhận request từ Frontend.
- Triển khai phương thức `doGet` để kéo toàn bộ dữ liệu (Read).
- Triển khai phương thức `doPost` để xử lý các tác vụ thêm, sửa, xóa (Create, Update, Delete) cho Thành viên, Trận đấu, Nộp Quỹ.
- Tự động gán `timestamp` chuẩn cho mọi thao tác.

### C. Frontend Modules (`app.js`, `index.html`)
- **Dashboard:** Thống kê tổng dư quỹ, số trận, số thành viên. Tích hợp Chart.js vẽ biểu đồ tỷ lệ Thắng/Thua/Hòa và biểu đồ chi phí theo tháng.
- **Quản lý Trận đấu:** 
  - Xem danh sách trận đấu theo từng tháng.
  - Sắp xếp thông minh: Trận mới thêm hiển thị ở trên cùng.
  - Form thêm trận đấu với UI Result Selector (Pill buttons: Thắng/Thua/Hòa/Nội bộ).
- **Quản lý Nộp Quỹ:**
  - Logic tạo chu kỳ quỹ động: Tự động render danh sách các tháng thu quỹ từ T5/2026 đến T12/2027.
  - Theo dõi trạng thái Đã nộp / Chưa nộp của từng cá nhân theo từng tháng.
- **Quản lý Thành viên (CRUD đầy đủ):**
  - Thêm thành viên mới (Tên, Số áo, Size, Đối tượng Đi làm/Sinh viên).
  - Cập nhật thông tin và Trạng thái (Hoạt động / Tạm nghỉ).
  - Xóa thành viên.

---

## 3. Next Task: "Lịch thi đấu" (Upcoming Fixtures) Tab
**Ngữ cảnh:** Đội trưởng đang quản lý lịch các trận *sắp tới* ở một bảng riêng (Cột J -> P trong file Excel gốc).

**Requirement cho Claude Code:**
Cần xây dựng thêm một Tab **Lịch thi đấu** trên PWA với các yêu cầu sau:

1. **Database Update:** 
   - Tạo thêm sheet `data.new.LichThiDau` với các cột: `timestamp, date, opponent, venue, kitColor, status, note`.
   - Update `Code.gs` để hỗ trợ thêm/sửa/xóa bảng này.
2. **Frontend UI:**
   - Thêm một Tab mới dưới Bottom Navigation (ví dụ icon Calendar).
   - Liệt kê các trận đấu sắp diễn ra (Gồm: Ngày, Đối tác, Sân bóng, Màu áo).
   - Thêm nút FAB để "Tạo lịch thi đấu mới".
   - (Tùy chọn) Nút "Chuyển thành Trận đã đấu" để tự động đưa dữ liệu từ Lịch thi đấu sang Tab Trận đấu (kèm cập nhật kết quả Thắng/Thua và Chi phí).

---

## 4. Code Structure
- `index.html`: Chứa toàn bộ giao diện, modal, bottom nav.
- `style.css`: Hệ thống CSS Variables, Mobile-first responsive, Component styles.
- `app.js`: Logic App, State Management (`state` object), API fetch/push, DOM render functions.
- `data.js`: Cấu hình danh sách tháng nộp quỹ (`FUND_PERIODS`) và mock data (fallback khi offline).
- `Code.gs`: Mã nguồn Google Apps Script (cần dán vào project Apps Script tương ứng trên Google Sheets).
- `vercel.json`: Cấu hình routing cho Vercel.

*End of Handoff.*

# Kế hoạch triển khai: Kết nối AWS Cost Explorer API thật

Người dùng đã cung cấp thông tin đăng nhập AWS tạm thời (AWS Session Credentials). Do chính sách bảo mật trình duyệt (CORS) và bảo vệ an toàn cho khóa truy cập, chúng ta không thể gọi trực tiếp API AWS từ Frontend (trình duyệt). Thay vào đó, chúng ta sẽ xây dựng một cấu trúc **Full-stack Node.js & Express** gọn nhẹ chạy cục bộ (Local Proxy Server) để kết nối trực tiếp với AWS và trả dữ liệu về giao diện đẹp mắt hiện có.

---

## 🏗️ Kiến trúc kết nối dữ liệu AWS thật

```mermaid
graph LR
    A[Frontend Browser - app.js] -->|Fetch /api/costs| B[Local Backend - server.js]
    B -->|Đọc cấu hình| C[.env file - AWS Credentials]
    B -->|Gọi ce:GetCostAndUsage| D[AWS Cost Explorer Service]
    D -->|Trả dữ liệu chi phí thật| B
    B -->|Chuẩn hóa dữ liệu| A
    style B fill:#ff9900,stroke:#333,stroke-width:2px,color:#fff
```

---

## 🛠️ Các thành phần thay đổi và bổ sung

### 1. [NEW] [package.json](file:///d:/Code/package.json)
*   Khởi tạo dự án Node.js.
*   Cài đặt các thư viện cần thiết:
    *   `express`: Tạo máy chủ API cục bộ.
    *   `cors`: Cho phép Frontend gọi API từ Backend không bị chặn CORS.
    *   `dotenv`: Quản lý biến môi trường bảo mật chứa các AWS keys.
    *   `@aws-sdk/client-cost-explorer`: SDK AWS v3 chính thức để truy vấn dữ liệu chi phí.
*   Thêm script `npm start` để khởi chạy local server.

### 2. [NEW] [.env](file:///d:/Code/.env)
*   Lưu trữ các biến môi trường bảo mật (AWS credentials) do người dùng cung cấp:
    ```env
    AWS_ACCESS_KEY_ID=ASIARPMM6TNCKALVXXFZ
    AWS_SECRET_ACCESS_KEY=kFt4ReMR0sZmXt9Ji88o/QfNGrxWnAKTz5nYAj9v
    AWS_SESSION_TOKEN=IQoJb3JpZ2lu... (token đầy đủ)
    PORT=3000
    ```
> [!WARNING]
> File `.env` sẽ được lưu trữ cục bộ trên máy tính của bạn và được thêm vào `.gitignore` để đảm bảo an toàn tuyệt đối, không bao giờ bị lộ ra ngoài.

### 3. [NEW] [server.js](file:///d:/Code/server.js)
*   Xây dựng một Express server siêu nhẹ lắng nghe ở cổng `3000`.
*   Tạo endpoint chính `/api/costs` đảm nhận:
    1. Khởi tạo `CostExplorerClient` với credentials từ `.env`.
    2. Gọi lệnh `GetCostAndUsageCommand` để lấy dữ liệu chi phí AWS trong vòng **30 ngày qua** ( DAILY granularity).
    3. Hỗ trợ lấy dữ liệu gộp nhóm (Group By) theo **SERVICE** hoặc **REGION** dựa trên yêu cầu từ frontend.
    4. Trả dữ liệu dạng JSON đã chuẩn hóa về cho Frontend.
*   Tạo endpoint `/api/resources` để truy vấn danh sách một số tài nguyên đang hoạt động (ví dụ bằng cách gọi AWS EC2/S3 API nếu được phân quyền, hoặc tự động ánh xạ dữ liệu chi phí thành tài nguyên tương ứng).

### 4. [MODIFY] [app.js](file:///d:/Code/app.js)
*   **Kết nối Backend thật**: Khi khởi chạy, app sẽ tự động cố gắng gửi request tới `http://localhost:3000/api/costs`.
*   **Trạng thái Kết nối AWS thật (AWS Connection Status)**: 
    *   *Thành công*: Cập nhật giao diện sang trạng thái **"AWS Connected: Real Data"** (màu xanh ngọc cực đẹp), cập nhật các thẻ KPI (Month-to-Date Cost, Forecast) và biểu đồ Doughnut dựa trên dữ liệu thật lấy từ tài khoản AWS của bạn!
    *   *Thất bại (CORS, sai Key, hết hạn Token, hoặc thiếu quyền ce:GetCostAndUsage)*: Tự động đưa ra thông báo Toast chi tiết lỗi và kích hoạt **Fallback Mode** sang bộ giả lập thời gian thực (AWS API Simulator) để đảm bảo giao diện luôn hoạt động trơn tru mà không bị crash.
*   **Nút Chuyển đổi Real/Mock (Data Source Toggle)**: Bổ sung công tắc nhỏ trên giao diện cho phép bạn chuyển đổi linh hoạt giữa dữ liệu AWS thật từ API và dữ liệu giả lập thời gian thực để test thử các tính năng simulator.

### 5. [MODIFY] [index.html](file:///d:/Code/index.html)
*   Thêm thanh chỉ báo trạng thái dữ liệu **"DATA SOURCE: AWS API (REAL)"** hoặc **"DATA SOURCE: SIMULATOR (MOCK)"** ngay trên Header.
*   Thêm nút bấm cấu hình kết nối nhanh.

---

## 📋 Quy trình kiểm tra & xác minh (Verification Plan)

### Automated & Manual Verification
1.  **Cài đặt dependencies**: Chạy `npm install` để tải các thư viện AWS SDK, Express, CORS.
2.  **Chạy Backend Server**: Chạy lệnh `node server.js` và xác nhận server khởi động thành công trên cổng `3000`.
3.  **Kiểm tra API Cost Explorer**: Truy cập `http://localhost:3000/api/costs` trên trình duyệt để kiểm tra xem API có lấy được dữ liệu thật từ AWS và trả về JSON chuẩn hay không.
4.  **Xác minh Frontend**: Mở `index.html`, xác nhận giao diện chuyển trạng thái sang **AWS API Connected** màu xanh lục và hiển thị đúng biểu đồ chi phí thực tế của tài khoản AWS của bạn!
5.  **Kiểm tra Fallback**: Sửa thử file `.env` nhập sai Key để kiểm tra xem Frontend có tự động fallback về chế độ Simulator an toàn và hiển thị thông báo lỗi rõ ràng hay không.

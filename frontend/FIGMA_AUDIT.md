# Đối chiếu 23 frame Figma

Nguồn: [Figma PharmaChain](https://www.figma.com/design/zPmVid4MusvZg27JeEMnGV/Untitled?node-id=0-1). Danh sách tên frame được đọc từ bảng Layers ngày 08/11/2026. Các frame là biến thể trạng thái của bốn trang React và một hộp thoại, không phải 23 URL riêng.

| # | Frame trong Figma | Triển khai React | Kiểm tra |
|---|---|---|---|
| 1 | Connect Wallet | `ConnectPage` khi chưa chọn ví | Đã mở trong trình duyệt |
| 2 | Connect Wallet - Manufacturer | `ConnectPage` chọn Manufacturer | Đã mở trong trình duyệt |
| 3 | Connect Wallet - Distributor | `ConnectPage` chọn Distributor | Đã mở trong trình duyệt |
| 4 | Connect Wallet - Pharmacy/ Hospital | `ConnectPage` chọn Pharmacy | Đã mở trong trình duyệt |
| 5 | Connect Wallet - End user/ Inspector | `ConnectPage` chọn Inspector | Đã mở trong trình duyệt |
| 6 | Track & Trace - In transit | `TracePage` lô 00142 | Đã mở trong trình duyệt |
| 7 | Track & Trace - Dispensed | `TracePage` lô 00139 | Đã mở trong trình duyệt |
| 8 | Track & Trace - Registered | `TracePage` lô 00135 | Đã mở trong trình duyệt |
| 9 | Track & Trace - Expired | `TracePage` lô 00128 | Đã mở trong trình duyệt |
| 10 | Scan QR - Camera scan | `ScanPage` chế độ camera | Có UI và mã quét; chưa cấp quyền camera/thiết bị để kiểm tra thực tế |
| 11 | Scan QR - Manual input | `ScanPage` chế độ nhập mã | Đã mở và xác minh mã mẫu |
| 12 | Verification result - Authentic product | Kết quả lô 00142 | Đã mở trong trình duyệt |
| 13 | Verification result - Batch expired | Kết quả lô 00128 | Đã mở trong trình duyệt |
| 14 | Verification result - Not found/ counterfeit | Kết quả mã không tồn tại | Đã mở trong trình duyệt |
| 15 | Verification result - Querying/ Loading | Nút `Preview querying state`; trạng thái chờ khi gọi RPC | Đã mở và thoát trong trình duyệt |
| 16 | Manage (Manufacturer) - Register medicine | `ManagePage` vai trò Manufacturer, tab Register | Đã mở; nút ghi bị khóa trong preview |
| 17 | Manage (Manufacturer) - Transfer Ownership | `ManagePage` vai trò Manufacturer, tab Transfer | Đã mở; nút ghi bị khóa trong preview |
| 18 | Manage (Distributor) - Transfer Ownership | `ManagePage` vai trò Distributor, tab Transfer | Đã mở; nút ghi bị khóa trong preview |
| 19 | Manage (Pharmacy) - Dispense Medicine | `ManagePage` vai trò Pharmacy, tab Dispense | Đã mở; nút ghi bị khóa trong preview |
| 20 | Transaction Status/ Loading | `TransactionModal` trạng thái chờ ký | Đã mở qua nút preview signing |
| 21 | Transaction Status/ Loading | `TransactionModal` trạng thái chờ xác nhận | Đã mở qua nút preview pending |
| 22 | Transaction Status/ Loading - success | `TransactionModal` thành công | Đã mở qua nút preview success |
| 23 | Transaction Status/ Loading - failed | `TransactionModal` thất bại | Đã mở qua nút preview failed |

Hai frame giao dịch trong Figma cùng tên `Transaction Status/ Loading`; bảng phân biệt chúng bằng trạng thái chờ ký và chờ receipt của luồng thực.

## Kiểm tra chức năng

- `pnpm build` trong `frontend/`: đạt, TypeScript và Vite biên dịch thành công. Vite còn cảnh báo bundle JavaScript lớn (>500 kB); không chặn build.
- `pnpm test` trong `contracts/`: 16/16 bài test Hardhat đạt.
- Trình duyệt: đã thử chọn bốn vai trò mẫu; lọc/truy xuất bốn trạng thái lô; xác minh hợp lệ, hết hạn, đã tiêu thụ và không tồn tại; mở biểu mẫu theo vai trò; mở/đóng bốn trạng thái giao dịch mẫu. Không thấy lỗi console JavaScript trong các luồng đã thử.
- Chế độ xem mẫu không gửi giao dịch. Logic live dùng ABI chung, `staticCall` trước giao dịch, chờ receipt, quét event để dựng lịch sử, và đối chiếu origin/chain ID/contract của QR URL.

## Chưa thể xác nhận đầu cuối

Chưa có địa chỉ hợp đồng triển khai Sepolia hoặc `.env.local`, nên chưa thử kết nối ví đã cấp vai trò, ký/gửi giao dịch, receipt thật, truy vấn RPC thật hoặc giải mã giá từ event thật. Camera cần thiết bị và quyền truy cập trong trình duyệt. Tải lên và giải mã tài liệu IPFS hạn chế cần backend SIWE/Pinata riêng theo bản thiết kế. Figma MCP đã hết lượt gọi trên gói Starter, vì vậy chưa thể đối chiếu chi tiết từng pixel của mọi frame; bảng trên xác nhận trạng thái và luồng, không xác nhận pixel-perfect.

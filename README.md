# Drug Supply Chain Traceability — phần blockchain

Giao diện React theo Figma nằm trong [`frontend/`](./frontend/README.md). Hai phần dùng chung ABI biên dịch trong `shared/abi/`.

Mã nguồn trong `contracts/` triển khai lớp on-chain của [bản thiết kế](./Drug_Supply_Chain_System_Design.md): một ERC-721 cho mỗi lô thuốc, quản lý vai trò, đăng ký, chuyển lô đúng tuyến, xác minh, lưu CID chứng từ và kết thúc vòng đời bằng burn. ABI được xuất từ artifact compiler vào `shared/abi/DrugSupplyChain.json` để frontend/backend dùng chung.

## Cấu trúc

```text
contracts/
  contracts/
    DrugSupplyChain.sol
    interfaces/IDrugSupplyChain.sol
    test/ReenteringReceiver.sol
  test/
    AccessControl.test.ts
    Lifecycle.test.ts
    NFTTransferBypass.test.ts
    Documents.test.ts
    fixture.ts
  scripts/
    deploy.ts
    export-abi.mjs
  hardhat.config.ts
  package.json
  pnpm-lock.yaml
shared/abi/DrugSupplyChain.json
```

## Cài đặt và chạy local

Yêu cầu Node.js >= 22.13 và pnpm 11. Từ thư mục `contracts/`:

```powershell
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

`pnpm build` biên dịch Solidity 0.8.30, target Cancun, rồi tạo lại ABI. Các bài test chạy trên mạng EVM cục bộ của Hardhat. Thời gian trong hợp đồng là Unix seconds; `tokenId` nên truyền dưới dạng chuỗi trong JSON/TypeScript để tránh mất độ chính xác.

## Triển khai Sepolia

Chuẩn bị RPC URL, ví triển khai đã có Sepolia ETH và private key riêng. Đặt biến môi trường trong terminal, không ghi vào mã nguồn:

```powershell
$env:SEPOLIA_RPC_URL = "https://..."
$env:SEPOLIA_PRIVATE_KEY = "0x..."
pnpm build
pnpm deploy:sepolia
```

Script kiểm tra `chainId == 11155111`, triển khai contract với ví deployer làm admin và in địa chỉ contract cùng transaction hash. Sau đó admin phải gọi `setParticipant` để cấp vai trò cho các ví Manufacturer, Distributor, Pharmacy/Hospital. Chỉ ghi địa chỉ vào cấu hình frontend sau khi đã kiểm tra transaction thành công trên Sepolia. Chưa có địa chỉ hoặc transaction hash Sepolia trong kho mã này.

## Quy tắc nghiệp vụ và giới hạn

- Một token là **toàn bộ một lô**; mã `(manufacturer, gtin, batchNumber)` không được tái sử dụng sau burn.
- Tuyến chuyển hợp lệ: Manufacturer → Distributor → Pharmacy/Hospital. `transferFrom`, cả hai `safeTransferFrom` và approvals không thể đi vòng qua tuyến này.
- Lô hết hạn không được chuyển hoặc đánh dấu tiêu thụ; owner hợp lệ vẫn có thể burn với trạng thái `DESTROYED`. Hồ sơ và CID vẫn đọc được sau burn, còn `ownerOf` sẽ revert theo ERC-721.
- `encryptedPrice` phải là bytes ciphertext được mã hóa AES-GCM **trước khi gọi contract**. Contract chỉ giới hạn kích thước 29–1024 bytes, không thể tự chứng minh bytes thực sự đã mã hóa. Khóa và plaintext phải do tầng backend/khách có quyền giữ, không đưa lên chuỗi hoặc commit vào repo.
- CID on-chain là tham chiếu công khai. Tệp hạn chế cần được mã hóa **trước khi upload IPFS**, và quyền giải mã phải được kiểm soát ngoài chuỗi. Contract không triển khai Pinata, SIWE, AES, Oracle, QR hoặc giao diện web; đó là các module khác trong bản thiết kế.
- `verifyProduct` phản ánh hồ sơ số, chữ ký transaction và trạng thái lô. Nó không chứng minh hộp thuốc vật lý hay cảm biến là thật.

Các ca kiểm thử bao gồm mint sai quyền, lô trùng/hết hạn, chuyển sai tuyến, bypass ERC-721, owner sai, receiver tái nhập, CID và burn lưu archive. Kết quả local chỉ chứng minh phần blockchain hoạt động trên Hardhat; tiêu chí triển khai và demo Sepolia cần RPC/ví/funding thực tế.

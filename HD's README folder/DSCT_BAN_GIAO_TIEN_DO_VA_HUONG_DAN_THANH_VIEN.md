# DSCT – BẢN TỔNG HỢP TIẾN ĐỘ VÀ BÀN GIAO CÔNG VIỆC

**Mục đích:** Tổng hợp những phần đã thực hiện, phần còn thiếu và hướng dẫn thành viên tiếp quản triển khai phần còn lại trên máy của mình.

**Nguồn đối chiếu:**

- `IS355-Project` – snapshot source code được gửi trong cuộc trò chuyện.
- `InstructionI.docx` – hướng dẫn/ghi nhận các bước chuẩn bị ví, Sepolia, Alchemy, deploy contract, cấp quyền và tích hợp Frontend.
- `Drug_Supply_Chain_System_Design.md` – đặc tả kiến trúc và tiêu chí hoàn thành hệ thống.
- Ảnh bảng TASK-01 đến TASK-20.

---

## 1. Kết luận tổng quan

Dự án đã hoàn thành nền tảng Blockchain và phần lớn khung Frontend Live Mode. Smart Contract đã được biên dịch, có bộ 16 unit test, đã triển khai lên Sepolia, cấp bốn role và đồng bộ ABI với Frontend. Frontend đã có MetaMask connection, đọc role từ contract, trang Track & Trace, QR scan/manual verification và các thao tác Register/Transfer/Burn/Document CID ở mức code.

**Khoảng trống lớn nhất hiện tại là Backend và tích hợp IPFS thực tế.** Trong source chưa có thư mục `backend/`, chưa có FastAPI, Web3.py indexer, database, Pinata adapter, RBAC tài liệu hoặc Oracle simulator. Ba file Frontend `api.ts`, `wallet.ts`, `metadata.ts` đã có code client, nhưng API server mà chúng gọi chưa có trong repository.

### 1.1. Tóm tắt theo mức độ

- **Đã hoàn thành:** TASK-01 đến TASK-06 ở mức nền tảng; contract, deploy, cấp role, ABI và kết nối Frontend–Sepolia đã có.
- **Đã có code, còn hoàn thiện/kiểm thử:** TASK-07, TASK-08, TASK-10, TASK-12, TASK-15, TASK-16, TASK-18, TASK-19.
- **Chưa triển khai:** TASK-09, TASK-11, TASK-13, TASK-14, TASK-17.
- **Có thể để sau MVP:** TASK-20 (P2).

### 1.2. Những thông tin triển khai đã có

| Hạng mục                      | Giá trị                                                                                            |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Mạng                          | Ethereum Sepolia                                                                                   |
| Chain ID                      | `11155111`                                                                                         |
| Contract                      | `0x6711403562C5688bc8cc6CFA5227Cdee41c17ec7`                                                       |
| Deployment block              | `12153539`                                                                                         |
| Deployment transaction        | `0x922c8404376ad94bae55970c68cfd1f50ba65b413392d282cf0c69b24dfd79e1`                               |
| Admin                         | `0x7F727c2d6182628cF5cBc49353b7e2f5B52cde66`                                                       |
| Explorer – Contract           | https://sepolia.etherscan.io/address/0x6711403562C5688bc8cc6CFA5227Cdee41c17ec7                    |
| Explorer – Deploy transaction | https://sepolia.etherscan.io/tx/0x922c8404376ad94bae55970c68cfd1f50ba65b413392d282cf0c69b24dfd79e1 |

Bốn participant đã được cấp role trên contract:

| Role         | Tài khoản test      | Public address                               |
| ------------ | ------------------- | -------------------------------------------- |
| MANUFACTURER | `DSCT_Manufacturer` | `0x0135b764190A75D879d0946EA80D9F9F82AB75ac` |
| DISTRIBUTOR  | `DSCT_Distributor`  | `0xf72ba2958182F5C3a8AfC9C57a7E645DCf8e7f2A` |
| PHARMACY     | `DSCT_Pharmacy`     | `0xb8260E96C0bA8dA96025118e95517116DbC0acED` |
| HOSPITAL     | `DSCT_Hospital`     | `0x43675a034dD1105c03aF185dA049408241061ff0` |

Đây chỉ là địa chỉ công khai. Không chia sẻ private key của các tài khoản hiện tại. Admin không phải participant nghiệp vụ, nên khi kết nối Admin có thể thấy role `NONE`; đây là hành vi phù hợp với mô hình contract hiện tại.

---

## 2. Ma trận trạng thái TASK-01 đến TASK-20

| ID      | Công việc                                    | Trạng thái theo source hiện tại                 | Phần còn lại                                                                                                                      |
| ------- | -------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| TASK-01 | Rà soát và chạy toàn bộ source code hiện tại | **Đã làm vòng đầu**                             | Chạy lại build/typecheck/test trên snapshot mới nhất của nhóm trước khi merge/demo.                                               |
| TASK-02 | Kiểm thử và hoàn thiện Smart Contract        | **Đã hoàn thành phần chính**                    | Giữ 16 test hiện có; bổ sung test nếu thay đổi contract/interface.                                                                |
| TASK-03 | Deploy contract lên Sepolia                  | **Đã hoàn thành**                               | Không deploy lại nếu không có thay đổi contract được cả nhóm duyệt.                                                               |
| TASK-04 | Cấp role cho các ví test                     | **Đã hoàn thành**                               | Nếu thành viên cần dùng ví riêng, Admin phải cấp role cho public address của ví đó.                                               |
| TASK-05 | Đồng bộ ABI và địa chỉ contract              | **Đã hoàn thành**                               | Khi contract thay đổi, build/export ABI và đối chiếu lại trước khi tích hợp.                                                      |
| TASK-06 | Tích hợp React với contract thực tế          | **Đã hoàn thành phần lõi**                      | Kiểm thử lại từng role và xử lý độ ổn định RPC/`eth_getLogs` trước demo.                                                          |
| TASK-07 | Hoàn thiện Register, Transfer, Verify, Burn  | **Một phần**                                    | Kiểm thử E2E trên Sepolia; hoàn thiện validation/reset Register; liên kết Metadata CID thật; thống nhất AES.                      |
| TASK-08 | Hoàn thiện QR và Track & Trace               | **Đã có code, cần nghiệm thu**                  | Kiểm thử camera, QR thật, lịch sử và trạng thái sau burn; lưu ảnh/video minh chứng.                                               |
| TASK-09 | Xây dựng Backend FastAPI cơ bản              | **Chưa triển khai**                             | Tạo `backend/`, health endpoint, cấu hình, CORS, Web3.py provider, database và test.                                              |
| TASK-10 | Tích hợp Pinata upload/retrieve              | **Một phần chuẩn bị**                           | Implement upload/retrieve thật ở Backend; test NFT metadata và đủ PDF/ảnh/JSON; đối chiếu CID/hash.                               |
| TASK-11 | Phân quyền truy cập tài liệu IPFS            | **Chưa triển khai**                             | SIWE/session + RBAC + mã hóa file restricted trước khi upload; test user không quyền.                                             |
| TASK-12 | Hoàn thiện AES và kiểm thử giải mã           | **Có demo AES phía FE, chưa đạt thiết kế cuối** | Chọn kiến trúc Backend-managed theo System Design hoặc cập nhật đặc tả nếu giữ client-side; làm key management và negative tests. |
| TASK-13 | Xây dựng Oracle Sensor Simulator             | **Chưa triển khai**                             | Signed sensor payload, xác minh chữ ký, timestamp/sequence/replay, cảnh báo nhiệt độ.                                             |
| TASK-14 | Kiểm thử tích hợp toàn hệ thống              | **Chưa triển khai**                             | E2E Register → Documents → Transfer → Verify → Burn, test lỗi và lưu evidence.                                                    |
| TASK-15 | Chuẩn bị báo cáo, slide, minh chứng          | **Một phần**                                    | Hoàn thiện báo cáo/slide/video caption và bộ bằng chứng theo rubric.                                                              |
| TASK-16 | SIWE hoàn chỉnh và quản lý session           | **Có FE client, thiếu BE**                      | Implement nonce/verify/logout, HttpOnly session, RBAC on-chain và test replay.                                                    |
| TASK-17 | Event Indexer và đồng bộ database            | **Chưa triển khai**                             | Web3.py indexer, confirmed events, unique event key, blockHash/reorg handling, DB.                                                |
| TASK-18 | Dashboard nâng cao, bộ lọc và thống kê       | **Một phần**                                    | Hiện có danh sách và tìm kiếm cơ bản; bổ sung số liệu, lọc trạng thái/hạn dùng/owner và phân trang.                               |
| TASK-19 | Admin UI cấp và thu hồi role                 | **Một phần**                                    | Contract và script CLI đã có; còn thiếu giao diện Admin và xác nhận transaction.                                                  |
| TASK-20 | GPS, chia lô, chống sao chép QR nâng cao     | **Chưa làm – P2**                               | Chỉ làm nếu còn thời gian; không chặn MVP.                                                                                        |

---

## 3. Những phần đã hoàn thành và bằng chứng

### 3.1. TASK-01 đến TASK-02 – Source và Smart Contract

Trong `contracts/` hiện có:

- `DrugSupplyChain.sol` và `interfaces/IDrugSupplyChain.sol`.
- Hardhat config, deploy script, script cấp participant và script export ABI.
- Bốn nhóm unit test: AccessControl (4), Documents (2), Lifecycle (7), NFTTransferBypass (3), tổng cộng **16 test**.
- `pnpm` scripts gồm `build`, `typecheck`, `test`, `deploy:sepolia`, `export:abi`.

Các chức năng contract có trong source:

- Participant/Role: `setParticipant`, `getParticipant`, đồng bộ AccessControl.
- Register: chỉ Manufacturer active, kiểm dữ liệu/ngày/CID, chống trùng `(manufacturer, gtin, batchNumber)`, mint ERC-721.
- `tokenURI()` trả `ipfs://{metadataCID}`.
- Transfer theo tuyến Manufacturer → Distributor → Pharmacy/Hospital, chỉ owner hiện tại, có ciphertext giá.
- Verify: `verifyProduct`, `verifyAuthenticity`, trả trạng thái không tìm thấy/hết hạn/đã tiêu thụ/đã tiêu hủy/owner không hợp lệ.
- Documents: lưu `DocumentType` và CID, chỉ owner hợp lệ theo stage được cập nhật.
- Burn: `CONSUMED`/`DESTROYED`, lưu archive/last owner và phát event.
- Chặn `transferFrom`, safe transfer/approval bypass và dùng ReentrancyGuard.

README trong source ghi nhận bộ contract test 16/16 đã pass. Khi thành viên tiếp quản, cần chạy lại `pnpm build`, `pnpm typecheck`, `pnpm test`; không chỉ dựa vào kết quả cũ.

### 3.2. TASK-03 đến TASK-05 – Deploy, cấp role, ABI

- Contract đã được deploy lên Sepolia và transaction được xác minh thành công; địa chỉ, deploy tx và block được ghi ở mục 1.2.
- Script `contracts/scripts/register-participant.ts` dùng Admin cấp bốn participant.
- ABI artifact và `shared/abi/DrugSupplyChain.json` hiện có cùng 75 ABI entries và nội dung ABI khớp nhau trong snapshot đã kiểm tra.
- Frontend `chain.ts` import ABI dùng chung và đọc `VITE_CONTRACT_ADDRESS`, `VITE_SEPOLIA_RPC_URL`, `VITE_DEPLOYMENT_BLOCK` từ môi trường.

### 3.3. TASK-06 và TASK-08 – Frontend Live Mode, QR, Trace

Trong `frontend/src/` hiện có:

- `App.tsx`: kết nối ví, refresh danh sách, theo dõi `accountsChanged`/`chainChanged`, luồng transaction receipt.
- `ConnectPage.tsx`: Connect MetaMask và Browse public.
- `ScanPage.tsx`: camera scan bằng `@zxing/browser`, nhập mã thủ công, kiểm tra QR URL, xác minh lô.
- `TracePage.tsx`: danh sách batch, tìm kiếm cơ bản, lấy history và document references từ Sepolia.
- `ManagePage.tsx`: UI Register, Transfer, Dispense/Burn, Document CID.
- `chain.ts`: ethers v6, ABI, read/write Contract, `staticCall`, event query theo block chunk 10.

Đã có kiểm tra nhận role từ `getParticipant()` và phân quyền UI theo Manufacturer/Distributor/Pharmacy/Hospital. `ScanPage` và `TracePage` trong snapshot không còn gọi dữ liệu preview; tuy nhiên `Header`, `Ui`, `types`, `data/preview.ts` và CSS vẫn còn một số dấu vết Preview cần dọn nếu muốn kết thúc Live Mode hoàn toàn.

### 3.4. TASK-09/10/16 – Frontend API client đã chuẩn bị

Ba file này **đã có code**, không còn rỗng:

- `services/api.ts`: HTTP client, JSON request/response, cookie `credentials: include`, chuẩn hóa lỗi HTTP.
- `services/wallet.ts`: `authenticateWallet()` gọi `/api/v1/auth/nonce`, `/auth/verify`, `logoutWalletSession()` gọi `/auth/logout`; ký message bằng MetaMask.
- `services/metadata.ts`: `createMedicineMetadata()` gọi `POST /api/v1/metadata/medicine-batches`, kèm `Idempotency-Key`, nhận `metadataCID` và `ipfs://` URI.
- `frontend/DSCT_API_Metadata_Contract_VI.md`: đặc tả API riêng cho xác thực ví và NFT Metadata.

Nhưng đây mới là **Frontend service/client contract**. Source ZIP không có thư mục `backend/`, FastAPI app, requirements, database hoặc API routes. Vì vậy TASK-09/10/16 chưa thể coi là hoàn thành runtime.

---

## 4. Những phần cần hoàn thành trước MVP – P0

### 4.1. TASK-07 – Kiểm thử và hoàn thiện nghiệp vụ Register/Transfer/Verify/Burn

Code các thao tác đã hiện diện, nhưng `ManagePage.tsx` trong snapshot vẫn:

- Gửi Register trực tiếp từ inline `onSubmit`.
- GTIN chưa có kiểm tra đúng 14 chữ số ở form.
- Batch Number/Drug Name chưa có giới hạn độ dài.
- Chưa kiểm tra ngày sản xuất không ở tương lai và ngày hết hạn sau ngày sản xuất ở tầng form (một số kiểm tra ngày đã có trong `chain.ts`).
- Metadata CID vẫn do người dùng nhập thủ công.
- Chưa có luồng reset form dựa trên kết quả giao dịch thành công.

Việc cần làm:

1. Hoàn thiện `validateRegistration()` cho GTIN, batch, medicine name, dates và CID.
2. Tạo `handleRegister()` tách validation khỏi JSX.
3. Giữ CID đã upload nếu người dùng từ chối MetaMask hoặc transaction revert; không upload lại metadata khi chỉ retry giao dịch.
4. Kiểm thử Manufacturer register, Manufacturer→Distributor, Distributor→Pharmacy/Hospital, Verify, Pharmacy/Hospital Burn.
5. Chụp transaction hash, kiểm tra `ownerOf`, `getMedicine`, `verifyProduct` và lịch sử.

### 4.2. TASK-09 – Backend FastAPI cơ bản

Repository hiện chưa có Backend. Thành viên phụ trách cần tạo tối thiểu:

```text
backend/
  app/
    main.py
    core/config.py
    api/auth.py
    api/metadata.py
    api/documents.py
    api/encryption.py
    api/oracle.py
    services/web3_service.py
    services/pinata_service.py
    services/crypto_service.py
    services/indexer.py
    schemas/
    models/
  tests/
  requirements.txt
  .env.example
```

Làm lần lượt:

1. Tạo FastAPI app và `GET /api/v1/health`.
2. Cấu hình settings qua environment; không hardcode RPC/JWT/session/AES secrets.
3. Cấu hình CORS cho đúng Frontend origin và `allow_credentials=True` khi dùng cookie.
4. Tạo Web3.py provider kết nối Sepolia, nạp ABI/contract address, đọc `getParticipant`, `ownerOf`, `getMedicine`, `verifyProduct`.
5. Thiết lập database (SQLite cho demo hoặc PostgreSQL nếu nhóm thống nhất).
6. Viết test API cơ bản và mô tả OpenAPI.

### 4.3. TASK-10 – Pinata upload/retrieve

Phân biệt hai nhóm JSON:

- **NFT Metadata JSON:** API đã được chuẩn bị ở `metadata.ts`, trả `metadataCID` dùng trong `registerMedicine()`/`tokenURI()`.
- **CHEMICAL_METADATA JSON:** một trong ba tài liệu của Document Management; schema có `gtin`, `batchNumber`, `medicineName`, `dosageForm`, `ingredients`, `storage`, `issuedBy`, `disclaimer`.

Demo phải có đủ ba loại tài liệu khác định dạng:

1. Certificate of Origin – PDF.
2. Quality Certificate/photo – JPEG hoặc PNG.
3. Chemical Metadata – JSON.

Backend cần nhận file, kiểm MIME/magic bytes/kích thước/schema, upload Pinata bằng `PINATA_JWT` server-side và trả CID/hash. Frontend gửi CID bằng ví tới `setDocumentCID()`, sau đó retrieve và so sánh nội dung/hash. Hãy xử lý trạng thái upload thành công nhưng transaction gắn CID thất bại (`UPLOADED_NOT_LINKED`).

### 4.4. TASK-11 – RBAC cho tài liệu IPFS

Không chỉ chặn API là đủ: CID trên IPFS có thể truy cập trực tiếp nếu nội dung còn được gateway cung cấp. Với tài liệu restricted:

- Mã hóa file trước khi upload IPFS.
- Backend xác thực session wallet và quyền on-chain/owner/issuer theo chính sách.
- API chỉ trả ciphertext hoặc stream đã giải mã cho người được phép.
- Không đưa khóa giải mã vào contract, CID public, frontend bundle hoặc URL.
- Có test anonymous/role không hợp lệ không lấy được plaintext, kể cả khi biết CID.

### 4.5. TASK-12 – AES cho giá giao dịch

Frontend hiện đã có AES-256-GCM trong `chain.ts`, dùng PBKDF2-SHA256 và passphrase được chia sẻ thủ công; `PriceAccess.tsx` hỗ trợ giải mã giá với passphrase. Đây là demo phía trình duyệt, **chưa phải kiến trúc Backend-managed được System Design chọn làm MVP**.

Cần họp nhóm chốt một phương án trước khi sửa:

- **Theo System Design MVP:** Backend xác thực sender/owner và recipient; tạo DEK 256-bit, nonce GCM 96-bit, AAD ràng buộc chain/contract/token/sender/recipient/currency; giữ DEK đã wrap trong Key Store; trả ciphertext cho FE; giải mã chỉ cho bên được phép và ghi audit.
- **Nếu giữ client-side encryption hiện tại:** phải cập nhật System Design, quy trình phân phối khóa và tiêu chí kiểm thử; passphrase chia sẻ ngoài băng không tự tạo ra RBAC mạnh.

Dù chọn cách nào, event `CustodyTransferred` chỉ chứa ciphertext; kiểm tra plaintext không xuất hiện trong calldata/log/console. Test sai key/tag/AAD và user không có quyền.

### 4.6. TASK-13 – Oracle Sensor Simulator

Theo System Design, simulator gửi payload có `schemaVersion`, `tokenId`, `sensorId`, `temperatureC`, `recordedAt`, `sequence`, `signature`. Gateway kiểm chữ ký trên toàn payload canonicalized, sensor được cấp phép, timestamp window và sequence tăng để chống replay.

Bộ demo tối thiểu:

- Một reading hợp lệ trong ngưỡng minh họa 2–8°C.
- Một reading vượt ngưỡng tạo cảnh báo.
- Một reading sai chữ ký hoặc replay bị từ chối.

Dashboard phải ghi rõ chữ ký chỉ xác nhận nguồn ký/toàn vẹn sau khi ký, không chứng minh sensor vật lý không bị can thiệp.

### 4.7. TASK-14 – Kiểm thử tích hợp toàn hệ thống

Tạo bộ E2E cho luồng:

`Register → Upload documents → Link CIDs → Transfer → QR Verify/Trace → Burn → Verify after burn`.

Kiểm thử tối thiểu:

- API health/auth/metadata/document/encryption/oracle.
- Sai role, sai owner, sai tuyến, expired, duplicate batch.
- Upload Pinata lỗi, CID sai, gateway timeout, upload thành công nhưng link chain thất bại.
- Unauthorized document retrieval và replay nonce/sensor.
- Kiểm tra trạng thái chỉ thành công khi `receipt.status == 1`; không kết luận counterfeit chỉ vì RPC/IPFS/indexer lỗi.

### 4.8. TASK-15 – Báo cáo, slide và minh chứng

`InstructionI.docx` là tài liệu ghi lại bước chuẩn bị và deploy; `Drug_Supply_Chain_System_Design.md` là đặc tả thiết kế. Hai tài liệu này chưa thay thế báo cáo cuối cùng và slide.

Cần gom:

- Contract address, deploy tx, chain ID, role wallets công khai.
- Ảnh 16 unit tests pass.
- Tx hash Register, hai lần Transfer, gắn CID, Burn.
- Ảnh QR trước/sau burn và timeline có ba mắt xích.
- Pinata CID + ảnh upload/retrieve ba loại file + hash check.
- Ảnh test RBAC denied, AES ciphertext/decrypt đúng quyền, Oracle valid/invalid/replay.
- Caption, bảng viết tắt, tài liệu tham khảo, video có caption nếu dùng.

---

## 5. P1 và P2 sau khi hoàn tất P0

### 5.1. P1

- **TASK-16 – SIWE/session:** Frontend client đã có; Backend cần thực hiện nonce một lần, TTL, binding domain/chain/address, verify chữ ký, chống replay, cookie HttpOnly/Secure/SameSite, logout và role check on-chain mỗi lần truy cập API hạn chế.
- **TASK-17 – Event Indexer/DB:** Hiện Frontend tự đọc `eth_getLogs` theo block chunk 10. Cần indexer Web3.py đọc `MedicineRegistered`, `CustodyTransferred`, `DocumentCIDUpdated`, `TokenBurned`, `ParticipantUpdated`; unique key `(chainId, contractAddress, txHash, logIndex)`, confirmations và xử lý reorg/blockHash.
- **TASK-18 – Dashboard:** `TracePage` hiện có list/search cơ bản. Bổ sung số batch theo trạng thái, batch đang sở hữu, lọc role/owner/status/expiry, cảnh báo sắp hết hạn, phân trang.
- **TASK-19 – Admin UI:** Contract `setParticipant()` và script CLI đã có; cần UI Admin để nhập địa chỉ, role, organization, active/inactive, gọi giao dịch bằng ví Admin và hiển thị receipt. Giữ Admin không được sở hữu/ghi thay participant nếu contract không cho phép.

### 5.2. P2

TASK-20 gồm GPS thực, chia/ghép lô, QR chống sao chép nâng cao hoặc định danh từng hộp. Đây là P2/ngoài MVP theo System Design; chỉ triển khai sau khi mọi acceptance P0 được đáp ứng.

---

## 6. Hướng dẫn chạy trên máy riêng

### 6.1. Nhận source đúng cách

```bash
git clone....
cd IS355-Project
git pull
```

### 6.2. Yêu cầu phần mềm

- Node.js **>= 22.13**.
- pnpm **11**.
- Git.
- MetaMask và Sepolia test ETH nếu cần gửi transaction.
- Backend: Python 3.12 có thể dùng theo môi trường nhóm; Backend member cần pin dependencies trong `requirements.txt`.

### 6.3. Kiểm tra Smart Contract

Mở terminal tại `contracts/`:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm test
```

Ý nghĩa:

- `build`: compile Solidity và export ABI vào `shared/abi/DrugSupplyChain.json`.
- `typecheck`: compile + TypeScript noEmit.
- `test`: chạy 16 Hardhat unit tests trên local network.

**Không cần deploy lại** chỉ để chạy test local hoặc tích hợp Backend. Chỉ deploy contract mới nếu có thay đổi Solidity được nhóm review và thống nhất migration.

### 6.4. Chạy Frontend

Từ `frontend/`:

```bash
pnpm install --frozen-lockfile
```

Tạo `frontend/.env.local` từ `.env.example` (Git Bash: `cp .env.example .env.local`; PowerShell: `Copy-Item .env.example .env.local`) và tự điền:

```env
VITE_CONTRACT_ADDRESS=0x6711403562C5688bc8cc6CFA5227Cdee41c17ec7
VITE_SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/<ALCHEMY_API_KEY_CUA_THANH_VIEN>
VITE_DEPLOYMENT_BLOCK=12153539
VITE_API_BASE_URL=http://127.0.0.1:8000
```

`VITE_API_BASE_URL` cần bổ sung vào `.env.example` của repository vì snapshot hiện tại chỉ có ba biến Blockchain.

Chạy:

```bash
pnpm build
pnpm dev
```

Mở URL Vite in ra terminal. MetaMask phải ở Sepolia (chain ID `11155111`).

### 6.5. Ví và role

- Để đọc dữ liệu công khai, không cần private key của ví participant.
- Để gửi transaction, MetaMask cần tài khoản mà người đang test kiểm soát private key và tài khoản đó đã được cấp role on-chain.
- Không gửi/import private key của tài khoản thành viên khác. Nếu thành viên cần role riêng, tạo ví test của họ rồi gửi **public address** cho Admin cấp `setParticipant()`.
- Role Admin (`DEFAULT_ADMIN_ROLE`) không đồng nghĩa participant nghiệp vụ; giao diện có thể hiển thị `NONE` cho Admin.

### 6.6. Chuẩn bị và chạy Backend

Trong repository hiện tại chưa có `backend/`; Backend member cần tạo skeleton theo System Design. Sau khi đã có `requirements.txt` và `.env.example`, trên Windows PowerShell:

```powershell
cd backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Backend `.env` cần các nhóm cấu hình (tên biến cụ thể do Backend member chốt):

- Sepolia RPC URL, chain ID, contract address, đường dẫn ABI.
- Pinata JWT.
- Database URL.
- Session signing/secret và CORS origins.
- AES key wrapping/KMS secret.
- Sensor public keys hoặc sensor registry cho Oracle.

Không commit `.env`. Chỉ giữ `.env.example` với placeholder.

Sau khi chạy, kiểm tra `/docs` của FastAPI và `GET /api/v1/health` trả HTTP 200. FE/BE khác origin cần CORS cho đúng origin Vite và cho phép credentials khi sử dụng cookie session.

---

## 7. Thứ tự triển khai đề xuất cho người tiếp quản

1. **Đọc trước:** `Drug_Supply_Chain_System_Design.md` các mục 2, 5, 6, 7, 8, 10, 12, 15, 16; đọc `frontend/DSCT_API_Metadata_Contract_VI.md`.
2. **Xác nhận contract/API schema:** không tự đổi enum, function/event, endpoint, request/response. Nếu cần thay đổi, cập nhật tài liệu và thông báo Frontend/Blockchain trước.
3. **TASK-09:** dựng FastAPI + health + config + Web3.py + database skeleton.
4. **TASK-16:** implement SIWE/session trước khi khóa tài liệu; kiểm tra nonce one-time và chain/domain.
5. **TASK-10:** implement NFT metadata endpoint `/api/v1/metadata/medicine-batches`, tạo JSON, upload Pinata, trả đúng response mà `metadata.ts` đang mong đợi. Sau đó mở rộng document upload/retrieve cho ba loại file.
6. **TASK-11:** phân loại public/restricted, mã hóa restricted file trước upload, RBAC retrieve.
7. **TASK-12:** chốt kiến trúc AES với cả nhóm; triển khai encrypt/decrypt, key storage, AAD, audit và negative tests.
8. **TASK-13:** Sensor Simulator và Oracle Gateway.
9. **TASK-17:** Event Indexer và DB nếu chia song song được; phải xác định confirmed events và reorg strategy.
10. **TASK-07/08/18/19:** hoàn thiện form/operations, kiểm thử QR/trace, dashboard và Admin UI.
11. **TASK-14/15:** chạy rehearsal E2E, thu thập minh chứng, báo cáo và slide.
12. **TASK-20:** chỉ làm nếu còn thời gian.

### 7.1. Hợp đồng API tối thiểu Frontend đang chờ

| Method | Endpoint                            | Mục đích                                 |
| ------ | ----------------------------------- | ---------------------------------------- |
| POST   | `/api/v1/auth/nonce`                | Cấp nonce/message cho ví                 |
| POST   | `/api/v1/auth/verify`               | Xác minh chữ ký, tạo session             |
| POST   | `/api/v1/auth/logout`               | Hủy session (được FE client gọi)         |
| POST   | `/api/v1/metadata/medicine-batches` | Tạo NFT Metadata, upload Pinata, trả CID |
| GET    | `/api/v1/health`                    | Health check đề xuất theo System Design  |

Các API trong System Design còn cần cho MVP:

- `POST /api/v1/batches/{tokenId}/documents` (multipart upload).
- `GET /api/v1/batches/{tokenId}/documents` và `GET .../{type}/content` (retrieve/RBAC).
- `POST /api/v1/encryption/prices` và `/decrypt`.
- `POST /api/v1/oracle/readings`, `GET /api/v1/oracle/batches/{tokenId}`.
- Batch/timeline read API nếu nhóm dùng Backend Indexer.

### 7.2. Acceptance khi Backend và Frontend ghép được

- `/health` trả 200 và không lộ secret.
- Manufacturer ký nonce đúng Sepolia, Backend tạo session; nonce reuse, sai chain, sai domain bị từ chối.
- Ví không có role Manufacturer không được tạo NFT Metadata theo endpoint có bảo vệ.
- Metadata API trả `data.metadataCID` dạng CID thuần, `data.uri` bắt đầu `ipfs://`, `contentType` là `application/json`.
- Pinata gateway tải được JSON và SHA-256 khớp response.
- Retry cùng `Idempotency-Key` không tạo pin duplicate; request mới dùng key mới.
- CID trả về được FE chuyển vào `registerMedicine()`; `tokenURI(tokenId)` trả `ipfs://{CID}`.
- Không có Pinata JWT, private key, AES master key/session secret trong bundle frontend hoặc Git.

---

## 8. Tài liệu dùng khi tiếp quản

1. `Drug_Supply_Chain_System_Design.md` – đặc tả tổng thể, đặc biệt §0.3, §2, §5–§10, §12, §15–§16.
2. `InstructionI.docx` – quy trình đã thực hiện: ví Deployer, Sepolia, Alchemy, cấu hình môi trường, deploy, xác minh, cấp role, cấu hình Frontend.
3. `frontend/DSCT_API_Metadata_Contract_VI.md` – hợp đồng API Frontend–Backend cho SIWE và NFT Metadata.
4. `contracts/README.md`/root `README.md` – lệnh cài đặt, build, typecheck, test, deploy.
5. Ảnh bảng TASK-01 đến TASK-20 – trạng thái/ưu tiên/quan hệ phụ thuộc của nhóm.

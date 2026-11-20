# DSCT – BÁO CÁO TIẾN ĐỘ BACKEND VÀ TÍCH HỢP HỆ THỐNG

**Đồ án:** IS355 – Drug Supply Chain Tracking (PharmaChain)  
**Phần việc báo cáo:** Backend, các API tích hợp, bảo mật tài liệu và giá, Oracle, Event Indexer, hoàn thiện kết nối Frontend và kiểm thử liên tầng  
**Ngày cập nhật:** 21/11/2026  
**Mạng triển khai:** Ethereum Sepolia – Chain ID `11155111`  
**Hợp đồng sử dụng:** `0x6711403562C5688bc8cc6CFA5227Cdee41c17ec7`

> **Tình trạng chung:** Phần triển khai mã nguồn cho MVP đã hoàn thành theo phạm vi được bàn giao; các bài kiểm thử tự động và tích hợp cục bộ đã đạt. Đã xác minh một số luồng đọc và xác thực với Sepolia, nhưng **chưa nghiệm thu trọn vòng đời lô thuốc bằng giao dịch thực trên Sepolia**. Những kết quả cục bộ/mô phỏng và kết quả trên mạng thật được phân biệt rõ trong báo cáo.

---

## 1. Tổng quan công việc

### 1.1. Bối cảnh và phần việc tiếp nhận

Theo bản bàn giao tiến độ của nhóm, nền tảng Smart Contract, hợp đồng đã deploy trên Sepolia, bộ ABI dùng chung và khung giao diện React/ethers đã có trước đó. Những phần còn cần bổ sung chủ yếu nằm ở Backend, tích hợp lưu trữ IPFS, phân quyền và mã hóa, hệ thống đọc sự kiện, mô phỏng cảm biến, cũng như kiểm thử các luồng nghiệp vụ xuyên suốt.

Phần triển khai được tổng hợp trong báo cáo này tập trung vào:

1. Hoàn thiện **FastAPI Backend** và kết nối với Web3.py, SQLite, Pinata/IPFS.
2. Tích hợp **xác thực ví, session và phân quyền** dựa trên trạng thái tài khoản và lô thuốc ở Smart Contract.
3. Xử lý **NFT Metadata, ba loại chứng từ, mã hóa tài liệu RESTRICTED**, kiểm soát retry và khôi phục CID chưa liên kết.
4. Triển khai **mã hóa giá chuyển giao** theo phương án quản lý khóa tại Backend.
5. Triển khai **Oracle Sensor Simulator** và API tiếp nhận dữ liệu nhiệt độ có chữ ký.
6. Xây dựng **Event Indexer** để đọc sự kiện đã xác nhận, cung cấp registry, chi tiết và timeline cho Frontend.
7. Hoàn thiện các thao tác giao diện **Register, Transfer, Burn, QR/Trace, Dashboard và Admin**, đồng thời bổ sung kiểm thử.
8. Thực hiện **kiểm thử Backend, Contract, Frontend và một kịch bản tích hợp EVM cục bộ**.

### 1.2. Kết quả nổi bật

| Hạng mục | Kết quả đã ghi nhận | Phạm vi kiểm chứng |
| --- | --- | --- |
| Backend | **87 tests passed** | FastAPI, SQLite, service, phân quyền, Pinata giả lập, tích hợp Hardhat |
| Smart Contract | **18 tests passed** | Hardhat cục bộ; có thêm ca inactive recipient và non-owner burn |
| Frontend | **7 nhóm kiểm thử Chrome PASS** | Trình duyệt headless với API/RPC/ví mô phỏng |
| Typecheck | **PASS** | TypeScript cho Frontend và Contracts |
| Frontend build | **PASS – 415 modules transformed** | Bản build Vite |
| Tích hợp nghiệp vụ | **PASS trên EVM cục bộ** | FastAPI + SQLite + Hardhat chain `31337`, Pinata HTTP mock |
| Sepolia | **Đã kiểm tra một phần** | MetaMask, xác thực ví/session, Indexer và API đọc registry |
| E2E Sepolia | **Chưa nghiệm thu** | Chưa có bộ receipt thật cho mint → documents → transfer → burn |

### 1.3. Giới hạn phạm vi

- **TASK-01 đến TASK-06** có nền tảng do nhóm triển khai trước. Phần báo cáo dưới đây ghi rõ các việc tiếp nối, kiểm thử hoặc tích hợp; không coi toàn bộ nền tảng Smart Contract/Frontend ban đầu là phần xây mới.
- **TASK-15** (báo cáo học thuật, slide và thuyết trình) được nhóm thực hiện sau khi chốt minh chứng kỹ thuật; tài liệu này chỉ báo cáo tiến độ triển khai.
- **TASK-20** là chức năng mở rộng P2, không phải điều kiện bắt buộc của MVP hiện tại.

---

## 2. Kiến trúc hệ thống sau khi tích hợp

### 2.1. Các thành phần

| Thành phần | Công nghệ | Nhiệm vụ |
| --- | --- | --- |
| Smart Contract | Solidity, ERC-721, AccessControl; Ethereum Sepolia | Quản lý lô thuốc, role, vòng đời, chủ sở hữu, CID và event chuyển giao |
| Frontend | React, TypeScript, Vite, ethers v6 | Kết nối MetaMask, gọi API, gửi giao dịch, quét QR và tra cứu |
| Backend API | FastAPI, Python | Xác thực, quản lý phiên, kiểm quyền, Pinata, mã hóa, dữ liệu lô và Oracle |
| Cơ sở dữ liệu | SQLite | Session/nonce, nhật ký upload, khóa mã hóa đã bọc, sự kiện blockchain, dữ liệu cảm biến và audit |
| Lưu trữ nội dung | Pinata / IPFS | NFT Metadata JSON và chứng từ PDF/PNG/JSON; tài liệu RESTRICTED lưu dưới dạng ciphertext |
| Event Indexer | Web3.py và SQLite | Đọc event theo block, chỉ mục hóa, lưu checkpoint và xử lý dữ liệu chưa xác nhận/reorg |
| Sensor Simulator | Python, Ed25519 | Tạo reading nhiệt độ có chữ ký để kiểm thử Oracle Gateway |

### 2.2. Phân chia dữ liệu on-chain và off-chain

**Trên blockchain:** thông tin lô thuốc, vai trò participant, owner/stage, trạng thái cuối, NFT Metadata CID, Document CID và các event như đăng ký, chuyển giao, thay đổi chứng từ, burn. Giá chuyển giao không lưu dưới dạng plaintext trong event.

**Ngoài blockchain:** nội dung JSON/PDF/PNG trên IPFS; session, nonce, lịch sử đồng bộ, thông tin upload, wrapped key, nhật ký truy cập và reading cảm biến trong Backend/SQLite. Quyền sở hữu và trạng thái nghiệp vụ vẫn được đối chiếu từ Smart Contract khi cần bảo vệ thao tác.

### 2.3. Luồng nghiệp vụ chính

```text
Ví MetaMask ── ký challenge ──> FastAPI xác thực/session
       │                               │
       │                               ├── Tạo NFT Metadata / upload Pinata → CID
       │                               ├── Upload chứng từ PUBLIC/RESTRICTED
       │                               ├── Mã hóa/giải mã giá có kiểm quyền
       │                               └── Nhận dữ liệu Oracle
       │
       └── Gửi giao dịch bằng ví ──> DrugSupplyChain trên Sepolia
                                         │
                                         └── Event → Indexer → SQLite
                                                                 │
                                                                 └── Registry / Timeline / Dashboard
```

Giao dịch ghi vào blockchain được ký bằng ví của người thao tác. Backend không thay người dùng giữ private key để thực hiện các giao dịch này.

---

## 3. Ma trận tiến độ TASK-01 đến TASK-20

Bảng sau thể hiện **trạng thái triển khai mã nguồn và kiểm thử hiện có**, không đồng nhất việc test cục bộ với nghiệm thu trên Sepolia.

| TASK | Nội dung | Công việc đã thực hiện/đối chiếu | Trạng thái |
| --- | --- | --- | --- |
| **01** | Kiểm tra source nền | Kiểm tra môi trường, khả năng chạy Backend/Frontend/Contract và kiểm thử hồi quy | Đã kiểm tra |
| **02** | Smart Contract và unit test | Bổ sung 2 ca Hardhat về recipient inactive và non-owner burn; tổng 18 test | Đã kiểm thử cục bộ |
| **03** | Deploy lên Sepolia | Sử dụng deployment đã có của nhóm, không triển khai hợp đồng mới | Nền tảng có sẵn |
| **04** | Role của participant | Tích hợp kiểm role và luồng thao tác theo vai trò; cần ví có quyền để nghiệm thu transaction | Tích hợp xong; chờ nghiệm thu role thật |
| **05** | ABI và contract address | Dùng ABI chung, không thay đổi logic Solidity đã deploy | Đã đối chiếu cục bộ |
| **06** | React ↔ Sepolia | Kiểm kết nối MetaMask, chain, role; bổ sung API/indexer phục vụ UI | Đã kiểm tra một phần trên Sepolia |
| **07** | Register/Transfer/Verify/Burn | Hoàn thiện validation, receipt/reset, trạng thái DESTROYED và các luồng phụ thuộc API | Đã triển khai; chờ E2E Sepolia |
| **08** | QR và Track & Trace | Kiểm mã QR, sai chain, trạng thái sau burn, camera với video tổng hợp và lịch sử | Đã triển khai; cần demo thiết bị/lô thật |
| **09** | Backend FastAPI | App, config, SQLite, Web3.py, API, test và OpenAPI | Đã triển khai, test đạt |
| **10** | Metadata và Pinata | NFT Metadata, ba chứng từ, validation, retry/idempotency và Recover Pending CID | Đã triển khai; cần gắn CID thật với NFT Sepolia |
| **11** | Bảo vệ chứng từ | PUBLIC/RESTRICTED, AES-256-GCM, kiểm owner/role/issuer trước khi trả plaintext | Đã triển khai, test đạt |
| **12** | Mã hóa giá | AES-GCM, wrapped key, kiểm receipt/event/confirmations và kiểm quyền đọc | Đã triển khai, test đạt cục bộ |
| **13** | Oracle Simulator | Reading ký Ed25519, chặn replay, kiểm sensor/timestamp/sequence và hiển thị nhiệt độ | Đã triển khai, test đạt cục bộ |
| **14** | Kiểm thử tích hợp | Vòng đời NFT trên Hardhat EVM kết hợp FastAPI/SQLite; kiểm thử Chrome | Đạt cục bộ; chờ E2E Sepolia |
| **15** | Minh chứng, báo cáo, slide | Có kết quả kỹ thuật để nhóm tổng hợp; thiếu bộ receipt nghiệp vụ Sepolia | Chờ nghiệm thu và tổng hợp nhóm |
| **16** | Xác thực ví/session | Nonce, ký challenge, HttpOnly cookie, logout, quota và kiểm chống replay | Đã triển khai; test trình duyệt thật đạt |
| **17** | Event Indexer | Backfill, checkpoint, confirmations, reorg và API timeline/registry | Đã đồng bộ và đọc được Sepolia; cần đánh giá với lô thật |
| **18** | Dashboard nâng cao | Lọc, phân trang, owner filter trước paging, trạng thái registry và xử lý request cũ | Đã triển khai; cần dữ liệu lô thật để nghiệm thu |
| **19** | Admin UI | Form participant, kích hoạt/vô hiệu hóa, xử lý giao dịch từ ví Admin, kiểm từ chối | Đã test UI mô phỏng; chờ Admin thật |
| **20** | GPS/chia lô/QR nâng cao | Ngoài phạm vi MVP, chưa triển khai | P2 – chưa bắt buộc |

---

## 4. Chi tiết các phần đã triển khai

### 4.1. TASK-09 – Backend FastAPI, Web3.py và SQLite

**Mục tiêu:** Tạo Backend có thể phục vụ Frontend, đọc trạng thái từ Smart Contract, lưu dữ liệu hỗ trợ off-chain và mở các API cho những phần nghiệp vụ tiếp theo.

**Nội dung thực hiện:**

- Xây dựng ứng dụng FastAPI, chia router theo xác thực, metadata, batch, documents, prices và oracle.
- Quản lý cấu hình qua biến môi trường: RPC, network/contract, ABI, SQLite, CORS origin, Pinata và khóa mã hóa; thông tin nhạy cảm không cần nằm trong mã Frontend.
- Sử dụng Web3.py để đọc contract, tra role, owner, thông tin lô và trạng thái on-chain.
- Khởi tạo/nâng cấp schema SQLite phục vụ nonce/session, dữ liệu chứng từ, đồng bộ event, khóa giá và cảm biến.
- Cấu hình CORS và cookie cho luồng Frontend–Backend; expose tài liệu Swagger/OpenAPI để kiểm tra các endpoint.
- Bổ sung các bài test API, service và database, gồm cả kiểm tra việc nâng cấp schema không làm mất dữ liệu cũ.

**Một số file chính:**

- `backend/app/main.py`
- `backend/app/core/config.py`
- `backend/app/core/database.py`
- `backend/app/services/web3_service.py`
- `backend/requirements.txt`, `backend/.env.example`
- `backend/tests/test_health.py`, `backend/tests/test_database.py`, `backend/tests/test_web3_service.py`

**Cơ sở dữ liệu:** Schema hiện phục vụ 12 nhóm bảng: `auth_nonces`, `auth_sessions`, `wallet_profiles`, `organizations`, `metadata_requests`, `document_uploads`, `documents`, `price_key_access`, `indexed_blocks`, `chain_events`, `oracle_readings`, `audit_logs`.

**Kết quả:** Backend khởi động được, health endpoint trả HTTP 200; các test liên quan nằm trong bộ pytest tổng thể đã đạt.

### 4.2. TASK-16 – Xác thực MetaMask và quản lý session

**Mục tiêu:** Xác minh người gọi API thực sự kiểm soát ví, thay vì tin một địa chỉ ví được gửi trực tiếp trong request.

**Luồng xử lý:**

1. Frontend yêu cầu challenge/nonce với địa chỉ ví, chain và origin phù hợp.
2. Backend tạo challenge có thời hạn và lưu trạng thái trong SQLite.
3. Người dùng ký thông điệp bằng MetaMask.
4. Backend kiểm chữ ký, domain/origin, chain, hạn và việc nonce chưa được sử dụng.
5. Nếu hợp lệ, Backend cấp session qua cookie `HttpOnly`; khi gọi API bảo vệ, Backend đối chiếu session và quyền hiện hành.
6. Logout thu hồi session và xóa cookie.

**Kiểm soát an toàn đã bổ sung:** nonce dùng một lần; chống replay; quota tạo nonce được gắn với peer vận chuyển cùng ví/domain/chain, không tin `X-Forwarded-For` do client tự gửi; session không cần chứa private key.

**File chính:** `backend/app/api/auth.py`, `backend/tests/test_auth.py`, `frontend/src/services/wallet.ts`, `frontend/src/services/api.ts`.

**Kết quả:** Test tự động đạt. Đã xác minh thủ công bằng Chrome + MetaMask: lấy nonce HTTP 200, ký challenge, verify HTTP 200, tạo session, logout HTTP 200 và cookie session được xóa. Đây là kiểm tra trình duyệt/ví thật, không phải giao dịch nghiệp vụ ghi lên blockchain.

### 4.3. TASK-10 – NFT Metadata, chứng từ và Pinata/IPFS

**Hai loại dữ liệu được phân biệt:**

- **NFT Metadata:** JSON mô tả lô, tạo trước khi mint; sau khi upload có `metadataCID` để sử dụng trong `registerMedicine`/`tokenURI`.
- **Document Management:** chứng từ gắn với lô theo loại; CID được ghi lên chain qua thao tác cập nhật document của owner hợp lệ.

**Ba tệp mẫu dùng cho kiểm thử:**

| Loại | Tệp | Mục đích |
| --- | --- | --- |
| Chứng nhận nguồn gốc | `sample-data/documents/certificate-of-origin.pdf` | Upload/retrieve PDF và so byte/hash |
| Chứng nhận/chứng từ chất lượng | `sample-data/documents/coa-scan.png` | Upload/retrieve ảnh và kiểm thử visibility |
| Thông tin hóa học | `sample-data/documents/chemical-metadata.json` | Kiểm schema JSON và đối chiếu GTIN/số lô với dữ liệu trên chain |

**Các chức năng đã xử lý:**

- Kiểm kiểu dữ liệu/nội dung và tính hợp lệ của file đầu vào trước khi đưa lên Pinata.
- Gửi nội dung lên Pinata tại Backend; trả CID và thông tin phục vụ kiểm chứng nội dung tải về.
- Metadata có cơ chế idempotency: request tương đương không cần tạo pin mới khi đã có kết quả hợp lệ.
- Ghi nhận ý định upload để đối soát khi mất phản hồi từ dịch vụ hoặc khi bước lưu database bị gián đoạn.
- **Recover Pending CID:** người dùng có thể tìm lại CID đã upload thành công nhưng chưa gắn lên contract, cho cả `PUBLIC` và `RESTRICTED`.
- Đối chiếu trạng thái document hiện tại và lịch sử sự kiện trên chain để **không trả nhầm CID phiên bản cũ đã bị thay thế**. Khi indexer chưa đủ căn cứ hoặc checkpoint không an toàn, API từ chối tạm thời thay vì đưa ra kết quả sai.
- Frontend giữ lựa chọn lô/loại/visibility sau reload và khi ví từ chối giao dịch; thử lại bước liên kết CID mà không phải upload file lần nữa.
- Chặn Chemical Metadata có `gtin` hoặc `batchNumber` không khớp lô thuốc liên quan trước khi pin.

**File chính:** `backend/app/api/metadata.py`, `backend/app/api/documents.py`, `backend/app/services/pinata_service.py`, `backend/app/services/document_service.py`, `frontend/src/services/documents.ts`, `frontend/src/pages/ManagePage.tsx`; các bài test tại `test_metadata.py`, `test_pinata_service.py`, `test_document_api.py`, `test_document_service.py`.

**Kết quả:** Unit/integration test đạt, bao gồm lỗi request/retry và khôi phục CID. Có lần kiểm thử upload ba file mẫu với Pinata thật ở tầng service và đối chiếu nội dung/hash trong quá trình phát triển; **chưa có bằng chứng mới về luồng đầy đủ API có role → Pinata thật → transaction gắn CID → retrieve trên cùng NFT Sepolia**.

### 4.4. TASK-11 – Phân quyền và bảo mật tài liệu RESTRICTED

**Vấn đề:** Nếu chỉ kiểm quyền tại giao diện, người có CID vẫn có thể truy cập nội dung PUBLIC trên IPFS. Với tài liệu hạn chế, cần mã hóa dữ liệu trước khi upload.

**Giải pháp triển khai:**

- Hỗ trợ hai loại visibility: `PUBLIC` và `RESTRICTED`.
- Với `RESTRICTED`, Backend mã hóa byte tệp bằng **AES-256-GCM** trước khi đưa ciphertext lên IPFS.
- Thông tin xác thực/mã hóa được gắn với ngữ cảnh chain, contract, token, loại tài liệu và người upload để tránh tráo ngữ cảnh.
- Khi tải lại, Backend đối chiếu CID, tài khoản đã xác thực và quyền theo trạng thái owner/role/issuer trên chain; chỉ người được phép mới nhận plaintext.
- Kiểm tra toàn vẹn nội dung sau khi đọc lại dữ liệu.

**File chính:** `backend/app/services/document_crypto.py`, `backend/app/api/documents.py`, `backend/tests/test_document_retrieve.py`, `backend/tests/test_document_api.py`, `frontend/src/pages/TracePage.tsx`.

**Kết quả:** Test cục bộ kiểm quyền đọc của chủ mới, chủ cũ sau chuyển giao và người phát hành tài liệu. Việc quản lý/sao lưu khóa và truy xuất từ IPFS thật với nhiều ví vẫn cần nghiệm thu vận hành.

### 4.5. TASK-12 – Mã hóa giá chuyển giao và kiểm quyền giải mã

**Mục tiêu:** Giá chuyển giao được lưu trong event ở dạng ciphertext; chỉ những bên hợp lệ của giao dịch mới xem được giá trị gốc.

**Các bước chính:**

1. Frontend yêu cầu Backend mã hóa giá trước khi chuyển giao.
2. Backend xác minh owner hiện tại, người nhận, tuyến nghiệp vụ và dữ liệu yêu cầu.
3. Tạo khóa dữ liệu dùng cho lần mã hóa, áp dụng AES-256-GCM với ngữ cảnh ràng buộc chain/contract/token/sender/recipient và định danh transfer.
4. Bọc khóa dữ liệu bằng cơ chế AES-KW, lưu thông tin quyền truy cập phù hợp tại Backend/SQLite.
5. Frontend sử dụng ciphertext cho giao dịch `transferOwnership`.
6. Khi giải mã, Backend đọc receipt/event đã xác nhận và kiểm ví yêu cầu có quyền đối với lần chuyển đó trước khi trả plaintext; ghi nhận audit theo luồng đã triển khai.

**File chính:** `backend/app/api/prices.py`, `backend/app/core/database.py`, `frontend/src/components/PriceAccess.tsx`, `frontend/src/services/chain.ts`, `backend/tests/test_prices.py`.

**Kết quả:** Đã có kiểm thử giá đúng quyền, người ngoài bị từ chối, chủ cũ không được đọc giá của chuyển giao không tham gia và receipt chưa đủ xác nhận bị từ chối. Luồng đọc passphrase cũ được giữ cho dữ liệu tương thích. **Chưa thử với receipt chuyển giao Sepolia thực tế**; chính sách dọn wrapped key khi người dùng hủy ký giao dịch và sao lưu khóa vận hành cần thống nhất thêm.

### 4.6. TASK-13 – Oracle Sensor Simulator và dữ liệu nhiệt độ

**Mục tiêu:** Mô phỏng nguồn dữ liệu nhiệt độ có thể xác thực để kiểm thử theo dõi điều kiện vận chuyển/bảo quản thuốc.

**Nội dung:**

- Tạo payload reading gồm sensor ID, token ID, nhiệt độ, thời điểm đo, sequence và chữ ký.
- Dùng **Ed25519** xác minh nội dung do sensor đã đăng ký ký ra; đối chiếu sensor với lô được phép gửi.
- Kiểm tra timestamp trong cửa sổ cho phép (mốc triển khai: ±300 giây) và sequence phải tăng, ngăn gửi lại reading cũ.
- Lưu reading/trạng thái trong SQLite và trả dữ liệu lịch sử cho Frontend.
- Hiển thị nhiệt độ, trạng thái/cảnh báo theo ngưỡng minh họa **2–8°C** tại giao diện Track & Trace.

**File chính:** `backend/app/sensor_simulator.py`, `backend/app/services/sensor.py`, `backend/app/api/oracle.py`, `frontend/src/components/TemperatureHistory.tsx`, `backend/tests/test_oracle.py`.

**Kết quả:** Kiểm thử local với reading hợp lệ, chữ ký hoặc sequence không hợp lệ, replay và phân quyền sensor đạt. Đây là **sensor simulator**, chưa phải dữ liệu từ thiết bị IoT vật lý hoặc xác nhận nhiệt độ bằng phần cứng.

### 4.7. TASK-17 – Event Indexer và API Registry/Timeline

**Mục tiêu:** Hạn chế việc Frontend tự quét một lượng lớn blockchain event, cung cấp dữ liệu đã xác nhận để tìm kiếm, phân trang và truy vết lô thuốc.

**Nội dung:**

- Worker `indexer.py` chạy riêng với API, quét log từ deployment block theo từng đoạn và ghi checkpoint vào SQLite.
- Theo dõi các event liên quan đăng ký lô, chuyển giao, cập nhật CID, burn và participant.
- Kiểm số block confirmations, block hash và tình huống chain reorg; không coi dữ liệu chưa xác nhận là trạng thái cuối.
- Khi checkpoint chưa sẵn sàng, stale hoặc thiếu căn cứ, API trả `503 INDEX_NOT_READY` thay vì khẳng định dữ liệu sai.
- Các API `/batches`, `/batches/{token_id}` và `/batches/{token_id}/timeline` hỗ trợ frontend đọc registry và timeline.
- Bộ lọc owner xác định chủ tại snapshot đã xác nhận từ lịch sử mint/transfer/burn **trước khi phân trang**, tránh kết quả sai khi lô đổi chủ.
- Frontend kiểm metadata chain/contract/block hash giữa các trang và xử lý tình huống RPC/indexer chưa ổn định.

**File chính:** `backend/app/services/indexer.py`, `backend/app/api/batches.py`, `backend/tests/test_indexer.py`, `frontend/src/services/chain.ts`, `frontend/src/pages/TracePage.tsx`.

**Kết quả:** Các ca indexer cục bộ (pagination, owner, reorg, lỗi RPC, checkpoint) đạt. Trong lần chạy thủ công, indexer đã đồng bộ được Sepolia và API `/api/v1/batches?page=1` trả HTTP 200 với checkpoint hợp lệ. Tại thời điểm kiểm tra, kết quả `data: []` vì chưa có lô thuốc được index cho deployment đang dùng. Cần đo/kiểm thêm khi có lô và chuỗi giao dịch thật.

### 4.8. TASK-07, TASK-08 và TASK-18 – Hoàn thiện luồng giao diện nghiệp vụ

**Register, Transfer và Burn:**

- Liên kết thao tác form với metadata/document API và hợp đồng hiện có.
- Kiểm trước các ràng buộc nghiệp vụ và tình trạng ví, role, owner, stage trước khi yêu cầu ký giao dịch.
- Cập nhật/khôi phục giao diện dựa trên transaction receipt; xử lý ví từ chối ký và tránh làm mất CID đã upload.
- Cho phép Manufacturer/Distributor sử dụng trạng thái **DESTROYED** trong trường hợp contract cho phép; không mở **CONSUMED** cho các vai trò upstream.
- Loại bỏ phản hồi registry cũ nếu request về sau một kết quả mới và làm sai trạng thái giao diện.

**QR và truy xuất nguồn gốc:**

- Quét mã bằng ZXing, hỗ trợ đọc QR URL và nhập thủ công.
- Kiểm chain/token trong QR; từ chối sai mạng và không tự chọn một lô khi GTIN/số lô khớp nhiều kết quả.
- Hiển thị trạng thái xác minh, lịch sử chuyển giao, chứng từ, giá nếu đủ quyền và nhiệt độ từ Oracle.
- Kiểm QR trước/sau burn và bảo đảm video track được giải phóng khi kết thúc quét trong bài test trình duyệt mô phỏng camera.

**Dashboard:**

- Lọc trạng thái/owner, tìm kiếm và phân trang lô thuốc qua Registry API.
- Thể hiện trạng thái dữ liệu từ Sepolia và trường hợp danh sách trống/Index chưa sẵn sàng, thay vì hiển thị dữ liệu preview như dữ liệu thực.

**File chính:** `frontend/src/App.tsx`, `frontend/src/pages/ManagePage.tsx`, `frontend/src/pages/ScanPage.tsx`, `frontend/src/pages/TracePage.tsx`, `frontend/src/services/chain.ts`, `frontend/src/types.ts`, `frontend/src/styles.css`, `frontend/tests/workflows.mjs`.

**Kết quả:** Đã qua các kịch bản Chrome headless với ví/API/RPC mô phỏng. Mạng Sepolia đã kiểm được kết nối ví và giao diện đọc danh sách rỗng; chưa có lô thật để nghiệm thu đầy đủ QR, transfer và burn trên trình duyệt.

### 4.9. TASK-19 – Giao diện quản lý participant cho Admin

**Nội dung:** Tích hợp form nhập địa chỉ ví, tổ chức, vai trò và trạng thái kích hoạt/vô hiệu hóa participant; kiểm tra điều kiện trước khi mở giao dịch; chỉ ví có quyền Admin thực sự mới có thể thực hiện thao tác trên contract.

**Kiểm thử đã có:** Bài test Contract kiểm giới hạn cấp/thu hồi quyền và từ chối người không có thẩm quyền; bài test trình duyệt mô phỏng đường gọi UI Admin và các trường hợp ví từ chối.

**Giới hạn:** Chưa có receipt một giao dịch `setParticipant` được thực hiện trực tiếp qua Admin UI trên Sepolia trong đợt kiểm tra này. Việc cấp quyền để nghiệm thu phải do người giữ ví Admin của nhóm thực hiện.

### 4.10. TASK-02 và TASK-14 – Bổ sung test hợp đồng và tích hợp liên tầng

**Hardhat:** Bổ sung hai bài kiểm thử độc lập tại `contracts/test/Lifecycle.test.ts`:

- Recipient bị deactive không thể nhận chuyển giao.
- Người không phải owner không thể burn token.

Hai bài test kiểm custom error thích hợp và trạng thái sở hữu vẫn được giữ. Tổng bộ contract ghi nhận **18/18 PASS**. Solidity và ABI của deployment đang sử dụng không bị thay đổi bởi các bổ sung test này.

**Tích hợp cục bộ:** `backend/integration/test_local_lifecycle.py` sử dụng FastAPI, SQLite tạm, bytecode Smart Contract thực chạy trên Hardhat EVM và dịch vụ Pinata HTTP giả lập. Kịch bản kiểm:

1. Ký challenge/đăng nhập và tạo NFT Metadata.
2. Mint lô thuốc, kiểm `tokenURI`, `ownerOf` và thông tin đăng ký.
3. Upload/gắn ba chứng từ PDF/PNG/JSON, kiểm nội dung tải lại.
4. Chuyển từ Manufacturer sang Distributor, tiếp tục sang Pharmacy; kiểm owner/event và ciphertext giá.
5. Đọc/giải mã theo quyền mới, từ chối các ví không còn quyền.
6. Burn lô, xác minh trạng thái cuối và dữ liệu lịch sử.
7. Kiểm các trường hợp phục hồi CID khi document được thay thế, index chậm hoặc dữ liệu thiếu xác thực.

**Kết luận:** Luồng phối hợp các tầng đã chạy được ở môi trường cục bộ. Đây là kết quả quan trọng cho tính nhất quán nghiệp vụ, nhưng không thay thế việc chạy lại trên Sepolia với RPC, Pinata và ví có quyền thực tế.

---

## 5. Danh mục API Backend đã có

Tất cả đường dẫn sau sử dụng tiền tố `/api/v1`.

| Phương thức | Endpoint | Vai trò |
| --- | --- | --- |
| `GET` | `/health` | Kiểm dịch vụ Backend |
| `POST` | `/auth/nonce` | Sinh challenge xác thực ví |
| `POST` | `/auth/verify` | Xác minh chữ ký, tạo session |
| `POST` | `/auth/logout` | Thu hồi session |
| `POST` | `/metadata/medicine-batches` | Tạo và upload NFT Metadata, trả CID |
| `GET` | `/batches` | Danh sách lô, lọc và phân trang theo index |
| `GET` | `/batches/{token_id}` | Chi tiết lô thuốc |
| `GET` | `/batches/{token_id}/timeline` | Lịch sử event của lô |
| `POST` | `/batches/{token_id}/documents` | Upload chứng từ |
| `GET` | `/batches/{token_id}/documents` | Liệt kê chứng từ |
| `GET` | `/batches/{token_id}/documents/pending` | Khôi phục CID chưa liên kết |
| `GET` | `/batches/{token_id}/documents/{document_type}/content` | Tải/giải mã chứng từ theo quyền |
| `POST` | `/encryption/prices` | Mã hóa giá chuyển giao |
| `POST` | `/encryption/prices/decrypt` | Kiểm receipt/quyền và giải mã giá |
| `POST` | `/oracle/readings` | Nhận reading cảm biến có chữ ký |
| `GET` | `/oracle/batches/{token_id}` | Dữ liệu nhiệt độ của lô |

Các API được khai báo trong FastAPI/OpenAPI. **HTTP 200 của `/health` chỉ xác nhận Backend đáp ứng**, không tự chứng minh RPC, Pinata hoặc Indexer đều đang sẵn sàng.

---

## 6. Kết quả kiểm thử và bằng chứng hiện có

### 6.1. Tổng hợp lần kiểm thử gần nhất

| Kiểm thử | Công cụ/lệnh đại diện | Kết quả | Ghi chú |
| --- | --- | --- | --- |
| Backend | `python -m pytest -q` trong `backend/` | **87 passed, 1 warning** | Gồm API, service, SQLite, bảo mật, indexer và integration local |
| Contract | `pnpm test` trong `contracts/` | **18 passing** | Hardhat trên EVM cục bộ |
| Contracts typecheck | `pnpm typecheck` | **PASS** | Không có lỗi typecheck |
| Frontend build | `pnpm build` trong `frontend/` | **PASS** | 415 modules transformed |
| Chrome workflows | `node tests/workflows.mjs` trong `frontend/` | **7 nhóm PASS** | API, RPC, ví và camera video mô phỏng |
| Backend health | `GET /api/v1/health` | **HTTP 200** | Kiểm thủ công trên Backend đang chạy |
| Xác thực MetaMask | Nonce → ký → verify → logout | **PASS** | Trình duyệt/MetaMask thật trên localhost |
| Sepolia registry | Indexer → `GET /api/v1/batches?page=1` | **HTTP 200** | Đọc chain thật; danh sách trống ở thời điểm kiểm tra |

**Cảnh báo chưa chặn kết quả test:** deprecation của Starlette TestClient/httpx trong Backend; bundle Frontend có cảnh báo kích thước chunk lớn hơn 500 kB. Hai cảnh báo không đồng nghĩa test thất bại.

### 6.2. Các nhóm kiểm thử chính

- **Backend/API:** dữ liệu đầu vào sai, xác thực và role, nonce/replay, metadata và idempotency, JSON/PDF/ảnh, lỗi provider, document visibility/retrieval, mã hóa/giải mã, sensor signature/replay, indexer checkpoint/reorg và migration SQLite.
- **Smart Contract:** participant role, owner, mint hợp lệ/không hợp lệ, chống trùng lô, tuyến chuyển quyền, expiry, CID, burn/archival và chặn đường chuyển ERC-721 ngoài nghiệp vụ.
- **Frontend:** điều kiện hiển thị theo role, reset sau receipt, lỗi ví từ chối, quản lý CID sau reload, registry/filter/paging, giao diện Admin, QR hợp lệ/sai mạng/sau burn, giải phóng video stream.
- **Tích hợp cục bộ:** kết nối FastAPI → SQLite → Hardhat Smart Contract → các API mô phỏng lưu trữ, kiểm quyền qua nhiều bước chuyển giao và truy vấn lịch sử cuối vòng đời.

### 6.3. Phân biệt loại bằng chứng

- **Unit/API test có mock:** chứng minh logic của nhánh được kiểm thử theo các điều kiện mô phỏng; không chứng minh dịch vụ bên ngoài luôn sẵn sàng.
- **Hardhat và EVM cục bộ:** thực thi bytecode hợp đồng, có thể kiểm luật nghiệp vụ và nhiều bước liên tầng; không sinh transaction receipt Sepolia.
- **Chrome headless:** dùng trình duyệt và code UI thật nhưng API/RPC/ví fixture; camera dùng video QR tổng hợp, chưa kiểm camera phần cứng.
- **Pinata trực tiếp:** đã có lần upload/đối chiếu ba mẫu ở tầng service; chưa có minh chứng chuỗi thao tác được bảo vệ theo role trên cùng NFT Sepolia.
- **Đọc Sepolia thực tế:** đã có bằng chứng kết nối ví, session và indexer; **không đồng nghĩa toàn bộ giao dịch ghi đã được nghiệm thu**.

---

## 7. Kết quả đã kiểm tra trên Ethereum Sepolia

### 7.1. Môi trường kiểm tra

| Hạng mục | Giá trị |
| --- | --- |
| Network | Sepolia |
| Chain ID | `11155111` |
| Contract | `0x6711403562C5688bc8cc6CFA5227Cdee41c17ec7` |
| Deployment block | `12153539` |
| Deploy transaction lịch sử | `0x922c8404376ad94bae55970c68cfd1f50ba65b413392d282cf0c69b24dfd79e1` |

### 7.2. Những bước đã xác minh

1. Frontend chạy được tại localhost, kết nối MetaMask và đọc được network/role hiện tại.
2. Backend FastAPI chạy và phục vụ API health.
3. Luồng thử nonce, ký challenge và verify từ **đúng origin Frontend** thành công; session HttpOnly được tạo và logout thu hồi đúng.
4. Event Indexer chạy riêng, đọc log Sepolia từ deployment block và bắt kịp block head trong đợt kiểm tra.
5. Sau khi indexer sẵn sàng, `GET /api/v1/batches?page=1` trả HTTP 200, có metadata checkpoint/chain/contract, `data: []`.
6. Frontend Track & Trace hiện trạng thái `Live from Sepolia / Confirmed on-chain data`, hiển thị danh sách rỗng phù hợp dữ liệu Registry API.

### 7.3. Những việc chưa thể kết luận đã nghiệm thu

- Chưa có NFT lô thuốc mới được mint qua một ví Manufacturer trong phiên nghiệm thu hiện tại.
- Chưa có transaction gắn ba CID chứng từ trên cùng NFT và kiểm tra tải lại từ Pinata thật qua API có quyền.
- Chưa có hai transaction chuyển giao và burn trên Sepolia để đối chiếu receipt, decrypt, QR và timeline.
- Chưa có thao tác Admin UI ký transaction cấp/thu hồi participant trên Sepolia trong đợt nghiệm thu này.
- Chưa có lô thật để kiểm liên tục Oracle reading → Track & Trace/Index sau chuyển giao hoặc burn.

**Nguyên nhân cần phối hợp:** Những giao dịch ghi yêu cầu ví có đúng role/owner hiện hành và SepoliaETH để trả gas. Không cần trao đổi private key; người giữ từng ví có thể thực hiện thao tác và cung cấp receipt công khai để đối chiếu.

---

## 8. Các công việc còn lại trước khi nghiệm thu cuối

### 8.1. Checklist E2E trên một lô thuốc thực

- [ ] Xác nhận ví Admin, Manufacturer, Distributor và Pharmacy/Hospital có role active và đủ SepoliaETH; không dùng khóa bí mật của người khác.
- [ ] Đồng bộ Frontend, Backend, Indexer về cùng chain ID, contract, deployment block và cơ sở dữ liệu; chờ Indexer bắt kịp.
- [ ] Tạo metadata lô mới, mint NFT và ghi `tokenId`, receipt, `ownerOf`, `getMedicine`, `tokenURI`.
- [ ] Upload chứng từ PDF, PNG, Chemical Metadata JSON; gắn CID, kiểm `getDocument`, tải lại byte/hash.
- [ ] Kiểm PUBLIC đọc được theo thiết kế; RESTRICTED chỉ cho ví được phép; kiểm trường hợp từ chối truy cập.
- [ ] Thực hiện **Manufacturer → Distributor → Pharmacy/Hospital**, xác minh owner/stage, event và quyền đọc giá qua mỗi receipt.
- [ ] Gửi reading Oracle hợp lệ/vượt ngưỡng/replay cho chính lô đang test và xem lịch sử trên giao diện.
- [ ] Quét QR trên thiết bị thực; so sánh thông tin/timeline trước và sau burn.
- [ ] Burn theo quyền hợp lệ; đối chiếu trạng thái cuối, dữ liệu archive và các event được Indexer ghi nhận.
- [ ] Lưu ảnh giao diện, CID, transaction hash, trạng thái API và kết quả kiểm quyền làm bằng chứng nhóm.

### 8.2. Các điểm kỹ thuật cần chú ý khi chạy demo

1. **Tính sẵn sàng của Indexer:** worker phải chạy riêng; nếu còn đồng bộ hoặc RPC bị giới hạn `eth_getLogs`, registry có thể trả 503 hoặc chậm. Không diễn giải lỗi dịch vụ thành lô thuốc giả mạo.
2. **Phân biệt mật khẩu/khóa/cookie:** cấu hình Pinata JWT và khóa mã hóa chỉ ở Backend; cần có kế hoạch sao lưu khóa/SQLite để dữ liệu RESTRICTED và giá cũ có thể truy xuất sau khi chuyển máy.
3. **Giao dịch bị người dùng hủy:** cần thống nhất chính sách dọn wrapped key chưa gắn với receipt, cùng phạm vi ghi audit.
4. **Cấu hình môi trường:** origin Frontend, CORS, cookie và RPC phải phù hợp cách chạy thực tế; cookie `Secure` cần được đặt đúng khi chạy dưới HTTPS.
5. **RPC và hiệu năng:** đánh giá giới hạn log query, độ trễ index và thời gian chờ confirmation trên mạng Sepolia với dữ liệu thật.
6. **Các chức năng mở rộng:** TASK-20 chỉ thực hiện nếu nhóm quyết định sau khi hoàn tất các mục nghiệm thu MVP.

---

## 9. Danh sách source để các thành viên đối chiếu

| Nhóm | File/thư mục chính | Nội dung |
| --- | --- | --- |
| FastAPI & cấu hình | `backend/app/main.py`, `backend/app/core/` | Routes, settings, schema SQLite |
| Wallet auth | `backend/app/api/auth.py`, `backend/tests/test_auth.py` | Nonce, verify, session, logout, replay |
| NFT metadata | `backend/app/api/metadata.py`, `backend/tests/test_metadata.py` | Metadata CID, idempotency |
| Documents/IPFS | `backend/app/api/documents.py`, `backend/app/services/document_service.py`, `backend/app/services/pinata_service.py` | Upload/retrieve, schema, CID recovery |
| Document encryption | `backend/app/services/document_crypto.py` | AES-GCM cho RESTRICTED |
| Price encryption | `backend/app/api/prices.py`, `backend/tests/test_prices.py` | Ciphertext, wrapped key, receipt/ACL |
| Oracle | `backend/app/api/oracle.py`, `backend/app/services/sensor.py`, `backend/app/sensor_simulator.py` | Reading và chữ ký sensor |
| Blockchain read/index | `backend/app/services/web3_service.py`, `backend/app/services/indexer.py`, `backend/app/api/batches.py` | Đọc contract, event, registry, timeline |
| Local E2E | `backend/integration/test_local_lifecycle.py` | Vòng đời lô thuốc trên Hardhat EVM |
| Frontend API | `frontend/src/services/api.ts`, `wallet.ts`, `metadata.ts`, `documents.ts`, `chain.ts` | Wallet, HTTP, metadata, tài liệu, chain |
| Frontend nghiệp vụ | `frontend/src/pages/ManagePage.tsx`, `ScanPage.tsx`, `TracePage.tsx` | Register/Transfer/Burn, QR, Dashboard |
| Components bổ sung | `frontend/src/components/PriceAccess.tsx`, `TemperatureHistory.tsx` | Giá và cảm biến |
| Browser tests | `frontend/tests/workflows.mjs` | Các nhóm kịch bản Chrome headless |
| Contract tests | `contracts/test/Lifecycle.test.ts` và bộ `contracts/test/` | Luật vòng đời/role trên Hardhat |
| Dữ liệu mẫu | `sample-data/documents/` | Ba định dạng chứng từ phục vụ test |

### 9.1. Các lệnh kiểm tra và vận hành cơ bản

```text
Backend API (trong backend/):
  .venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

Event Indexer (terminal riêng, trong backend/):
  .venv\Scripts\python.exe -m app.services.indexer --follow

Backend tests (trong backend/):
  .venv\Scripts\python.exe -m pytest -q

Contract tests (trong contracts/):
  pnpm test
  pnpm typecheck

Frontend (trong frontend/):
  pnpm dev
  pnpm build
```

Để tái hiện các kết quả trên, máy thử cần cài dependencies đúng dự án và cấu hình các biến môi trường từ `.env.example`. Không chia sẻ URL RPC có token bí mật, Pinata JWT, private key hoặc khóa mã hóa trong tài liệu bàn giao.

---

## 10. Kết luận và hướng phối hợp

**Đã hoàn thành ở mức lập trình và kiểm thử cục bộ:** các module Backend cho MVP; tích hợp Frontend với session, metadata, tài liệu, giá, Oracle, Registry/Timeline; bộ test Backend, Hardhat, Chrome và vòng đời NFT liên tầng trên EVM cục bộ. Kết quả đã được ghi nhận là **87 Backend tests, 18 Hardhat tests và 7 nhóm Chrome tests PASS**.

**Đã có kiểm tra thực tế với Sepolia:** kết nối MetaMask, xác thực/session qua trình duyệt thật, Backend health và Event Indexer đồng bộ dữ liệu đọc. Các kết quả này hỗ trợ đánh giá hệ thống đã ghép được các thành phần nền tảng, nhưng **chưa đủ để khẳng định toàn bộ quy trình nghiệp vụ trên Sepolia đã nghiệm thu thành công**.

**Bước kế tiếp của nhóm:** phối hợp các ví có role phù hợp, hoàn thành một kịch bản giao dịch thật từ đăng ký lô đến burn, kiểm chứng tài liệu/giá/Oracle/QR và lưu minh chứng. Sau khi xử lý lỗi thực tế nếu phát sinh, nhóm có thể dùng các kết quả kỹ thuật và minh chứng đã đối soát để hoàn thiện báo cáo, slide và demo.

---

## 11. Tài liệu đối chiếu

1. `Drug_Supply_Chain_System_Design.md` – đặc tả kiến trúc và phạm vi chức năng.
2. `HD's README folder/DSCT_BAN_GIAO_TIEN_DO_VA_HUONG_DAN_THANH_VIEN.md` – tình trạng nền tảng và danh sách TASK trước khi tiếp nhận.
3. `HD's README folder/DSCT_API_Metadata_Contract_VI.md` – các hợp đồng API liên quan wallet/metadata theo bản bàn giao.
4. `README.md` và `frontend/README.md` – hướng dẫn nền của repository.
5. `backend/tests/`, `backend/integration/`, `contracts/test/`, `frontend/tests/` – source kiểm thử và assertion dùng xác nhận kết quả.

## 12. Hướng dẫn cài đặt và chạy toàn bộ hệ thống

Phần này trình bày các bước cài đặt, cấu hình, khởi động và kiểm thử hệ thống PharmaChain trên Windows. Hệ thống gồm ba thành phần chính: Smart Contract, Backend API kết hợp Event Indexer và Frontend.

### 12.1. Yêu cầu môi trường

Các công cụ cần chuẩn bị:

| Công cụ | Yêu cầu | Mục đích |
| --- | --- | --- |
| Git | Đã cài đặt | Quản lý mã nguồn |
| Node.js | Từ 22.13 trở lên | Chạy Frontend và Hardhat |
| pnpm | Phiên bản tương thích với lockfile của dự án | Cài thư viện JavaScript/TypeScript |
| Python | Khuyến nghị 3.12 | Chạy FastAPI, Indexer và kiểm thử Backend |
| MetaMask | Cài trên trình duyệt | Kết nối ví và ký giao dịch |
| Sepolia RPC | Endpoint hợp lệ | Đọc dữ liệu Ethereum Sepolia |
| Pinata | Tài khoản và JWT | Upload NFT Metadata và chứng từ lên IPFS |

Cấu trúc mã nguồn chính:

```text
IS355-Project/
├── backend/
│   ├── app/
│   ├── tests/
│   ├── integration/
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── tests/
│   ├── package.json
│   └── .env.example
├── contracts/
│   ├── contracts/
│   ├── scripts/
│   ├── test/
│   └── package.json
├── shared/
│   └── abi/
└── sample-data/
    └── documents/
```

### 12.2. Chuẩn bị Smart Contract

Smart Contract đã được triển khai trên Ethereum Sepolia với các thông số:

| Thông số | Giá trị |
| --- | --- |
| Network | Ethereum Sepolia |
| Chain ID | `11155111` |
| Contract Address | `0x6711403562C5688bc8cc6CFA5227Cdee41c17ec7` |
| Deployment Block | `12153539` |

Do đã có Smart Contract trên Sepolia, **không cần deploy lại hợp đồng** khi cài đặt dự án trên máy mới.

Để cài đặt dependencies và kiểm tra Smart Contract, mở CMD:

```cmd
cd /d D:\ProjectBlockChain\IS355-Project\contracts
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

Kết quả kiểm thử đã ghi nhận: **18 Hardhat tests PASS**.

Nếu cần biên dịch và đồng bộ lại ABI trong quá trình phát triển:

```cmd
pnpm build
```

Không tự ý thay đổi hoặc deploy lại Smart Contract đã triển khai nếu nhóm chưa thống nhất.

### 12.3. Cài đặt và cấu hình Backend

**Bước 1: Tạo môi trường Python**

Mở CMD tại thư mục Backend:

```cmd
cd /d D:\ProjectBlockChain\IS355-Project\backend
```

Tạo virtual environment:

```cmd
py -3.12 -m venv .venv
```

Cài đặt thư viện:

```cmd
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Nếu thư mục `.venv` đã được thiết lập và cài đầy đủ dependencies, không cần tạo lại.

**Bước 2: Tạo file cấu hình**

Sao chép `.env.example` thành `.env`:

```cmd
copy .env.example .env
```

Mở file `.env` để điền cấu hình:

```cmd
notepad .env
```

Các biến cấu hình chính:

| Biến | Ý nghĩa |
| --- | --- |
| `SEPOLIA_RPC_URL` | RPC endpoint kết nối Ethereum Sepolia |
| `SEPOLIA_CHAIN_ID` | Chain ID của Sepolia, bằng `11155111` |
| `CONTRACT_ADDRESS` | Địa chỉ Smart Contract đang sử dụng |
| `FRONTEND_ORIGIN` | Origin Frontend được Backend cho phép |
| `DATABASE_URL` | Đường dẫn cơ sở dữ liệu SQLite |
| `ABI_PATH` | Đường dẫn tới ABI dùng chung |
| `PINATA_JWT` | JWT để Backend làm việc với Pinata |
| `DOCUMENT_KEY_V1` | Khóa mã hóa tài liệu hạn chế |
| `PRICE_KEY_V1` | Khóa quản lý dữ liệu mã hóa giá |
| `CHAIN_CONFIRMATIONS` | Số xác nhận block yêu cầu |
| `ORACLE_SENSORS` | Cấu hình sensor được phép gửi dữ liệu |
| `DEPLOYMENT_BLOCK` | Block bắt đầu đọc event |
| `INDEXER_CHUNK_SIZE` | Số block xử lý trong một lần truy vấn |

Một số giá trị cấu hình thông thường:

```env
SEPOLIA_CHAIN_ID=11155111
CONTRACT_ADDRESS=0x6711403562C5688bc8cc6CFA5227Cdee41c17ec7
FRONTEND_ORIGIN=http://localhost:5173
DATABASE_URL=sqlite:///./dsct.db
ABI_PATH=../shared/abi/DrugSupplyChain.json
COOKIE_SECURE=false
CHAIN_CONFIRMATIONS=6
DEPLOYMENT_BLOCK=12153539
INDEXER_CHUNK_SIZE=10
```

Đây chưa phải toàn bộ file cấu hình. Các biến như `SEPOLIA_RPC_URL`, `PINATA_JWT` và khóa mã hóa cần được thiết lập riêng theo môi trường vận hành. Tạo khóa đúng định dạng mà Backend yêu cầu và lưu giữ an toàn.

**Lưu ý bảo mật:** Không chia sẻ `.env` chứa thông tin thật. Không đưa private key của MetaMask vào Backend. Các giao dịch ghi blockchain được ký trực tiếp bởi ví người dùng.

### 12.4. Khởi động Backend API

Mở **Terminal 1** bằng CMD:

```cmd
cd /d D:\ProjectBlockChain\IS355-Project\backend
```

Chạy FastAPI bằng Uvicorn:

```cmd
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Giữ terminal này hoạt động trong quá trình sử dụng hệ thống.

Kiểm tra Backend:

- Health API: http://127.0.0.1:8000/api/v1/health
- Swagger API: http://127.0.0.1:8000/docs

Nếu Backend hoạt động bình thường, Health API trả về HTTP 200.

Swagger được sử dụng để xem và kiểm tra tài liệu API. Những endpoint yêu cầu xác thực ví và kiểm tra Origin cần được gọi từ Frontend có Origin hợp lệ, không mặc định có thể thực hiện trực tiếp từ trang Swagger.

### 12.5. Khởi động Event Indexer

Event Indexer là tiến trình độc lập với FastAPI, có nhiệm vụ đọc các sự kiện Smart Contract trên Sepolia, lưu vào SQLite và cung cấp dữ liệu để Frontend hiển thị.

**Đây là bước bắt buộc khi muốn sử dụng Registry, Dashboard và Timeline dựa trên dữ liệu đã được index.**

Mở **Terminal 2**:

```cmd
cd /d D:\ProjectBlockChain\IS355-Project\backend
```

Chạy:

```cmd
.venv\Scripts\python.exe -m app.services.indexer --follow
```

Indexer sẽ đọc sự kiện blockchain từ deployment block, kiểm tra confirmations, lưu checkpoint và tiếp tục theo dõi các block mới.

Khi mới chạy, Indexer có thể cần thời gian đồng bộ dữ liệu lịch sử. Quá trình này có thể không liên tục in log ra terminal.

Kiểm tra dữ liệu Registry bằng:

http://127.0.0.1:8000/api/v1/batches?page=1

Các tình huống có thể gặp:

- **HTTP 200:** API Registry đã trả dữ liệu thành công.
- **HTTP 503 – INDEX_NOT_READY:** Indexer chưa đồng bộ đủ hoặc checkpoint chưa đạt yêu cầu.
- **HTTP 429 từ RPC:** Nhà cung cấp RPC đang giới hạn số lượng request.

Khi Indexer đã đồng bộ nhưng không có lô thuốc được đăng ký trên contract, API có thể trả về `data: []`. Đây là trạng thái dữ liệu trống, không phải lỗi ứng dụng.

### 12.6. Cài đặt và khởi động Frontend

Mở **Terminal 3**:

```cmd
cd /d D:\ProjectBlockChain\IS355-Project\frontend
```

Cài đặt thư viện:

```cmd
pnpm install --frozen-lockfile
```

Sao chép cấu hình mẫu:

```cmd
copy .env.example .env.local
```

Mở file:

```cmd
notepad .env.local
```

Điền các biến được khai báo trong `.env.example`, bảo đảm Frontend sử dụng:

- Đúng địa chỉ Smart Contract.
- Đúng mạng Sepolia và RPC.
- Deployment block `12153539`.
- Đúng địa chỉ Backend API theo cấu hình Frontend hiện tại.

Trong đó các giá trị Blockchain thường dùng là:

```env
VITE_CONTRACT_ADDRESS=0x6711403562C5688bc8cc6CFA5227Cdee41c17ec7
VITE_DEPLOYMENT_BLOCK=12153539
```

`VITE_SEPOLIA_RPC_URL` cần được điền bằng RPC hợp lệ. Nếu Frontend có biến cấu hình API Backend, đặt đúng URL theo `.env.example` và mã nguồn hiện tại.

Không đặt Pinata JWT, private key hoặc khóa mã hóa vào biến `VITE_`, vì những biến này có thể xuất hiện trong bundle trình duyệt.

Khởi động Frontend:

```cmd
pnpm dev
```

Truy cập:

http://localhost:5173

Để tránh lỗi Origin khi xác thực, sử dụng nhất quán `http://localhost:5173` với cấu hình `FRONTEND_ORIGIN` ở Backend.

### 12.7. Thứ tự chạy toàn bộ hệ thống

Khi các dependencies và file cấu hình đã được chuẩn bị, cần mở **ba terminal độc lập**:

**Terminal 1 – Backend API**

```cmd
cd /d D:\ProjectBlockChain\IS355-Project\backend
.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Terminal 2 – Event Indexer**

```cmd
cd /d D:\ProjectBlockChain\IS355-Project\backend
.venv\Scripts\python.exe -m app.services.indexer --follow
```

**Terminal 3 – Frontend**

```cmd
cd /d D:\ProjectBlockChain\IS355-Project\frontend
pnpm dev
```

Mô hình hoạt động:

```text
MetaMask / Trình duyệt
         |
         v
Frontend React :5173
         |
         v
Backend FastAPI :8000
         |
         +---- SQLite Database
         |
         +---- Pinata / IPFS
         |
         +---- Web3.py / Sepolia RPC
                        |
                        v
                Smart Contract
                        |
                        v
                  Event Indexer
                        |
                        v
                     SQLite
                        |
                        v
             Registry / Timeline
```

Frontend và Backend có thể khởi động ngay, nhưng các dữ liệu tổng hợp sẽ phụ thuộc trạng thái đồng bộ của Indexer.

Không cần mở thêm Hardhat local node khi chạy Frontend với Smart Contract đã triển khai trên Sepolia.

### 12.8. Kiểm tra hệ thống sau khi khởi động

Thực hiện lần lượt:

1. Mở `/api/v1/health` và xác nhận Backend trả HTTP 200.
2. Mở `/docs` để kiểm tra các API của hệ thống đã được đăng ký.
3. Kiểm tra tiến trình Indexer vẫn đang chạy.
4. Gọi `/api/v1/batches?page=1` và xác nhận Registry trả HTTP 200 khi Indexer sẵn sàng.
5. Mở Frontend tại `http://localhost:5173`.
6. Kiểm tra trạng thái kết nối Sepolia và địa chỉ Smart Contract.
7. Kết nối MetaMask nếu cần thử các chức năng có xác thực ví.
8. Vào Track & Trace và xác nhận dữ liệu phù hợp với Registry API.

Người dùng có thể xem các thông tin công khai mà không cần giữ quyền Admin hoặc Manufacturer.

Các thao tác Register, Transfer, Burn và cấp/thu hồi role yêu cầu ví có quyền nghiệp vụ tương ứng trên Smart Contract, đồng thời có SepoliaETH để trả phí giao dịch.

### 12.9. Chạy các bộ kiểm thử

**Backend tests**

Trong thư mục `backend/`:

```cmd
.venv\Scripts\python.exe -m pytest -q
```

Kết quả đã ghi nhận: **87 passed, 1 warning**.

Bộ kiểm thử bao gồm API, database, authentication, Pinata service, mã hóa tài liệu, giá, Oracle, Indexer và kiểm thử tích hợp với Hardhat cục bộ.

**Smart Contract tests**

Trong thư mục `contracts/`:

```cmd
pnpm typecheck
pnpm test
```

Kết quả đã ghi nhận: **18 passing**.

**Frontend production build**

Trong thư mục `frontend/`:

```cmd
pnpm build
```

Kết quả đã ghi nhận: Build thành công, **415 modules transformed**.

**Frontend browser workflow tests**

Trong thư mục `frontend/`:

```cmd
node tests/workflows.mjs
```

Kết quả đã ghi nhận: **7 nhóm kiểm thử PASS**, sử dụng Chrome headless với API, RPC và ví mô phỏng.

Các kết quả này phản ánh các lần kiểm thử đã thực hiện, không phải cam kết mọi lần chạy trên môi trường mới sẽ cho kết quả giống hệt.

### 12.10. Kiểm thử các chức năng nghiệp vụ trên Sepolia

Để kiểm thử luồng hoàn chỉnh với giao dịch blockchain thật, cần chuẩn bị các ví được cấp quyền:

| Vai trò | Chức năng |
| --- | --- |
| Admin | Cấp hoặc thu hồi quyền participant |
| Manufacturer | Đăng ký/mint lô thuốc và chuyển giao |
| Distributor | Nhận và chuyển lô thuốc |
| Pharmacy/Hospital | Nhận và kết thúc vòng đời lô |

Kịch bản nghiệm thu đề xuất:

1. Manufacturer đăng nhập và tạo NFT Metadata.
2. Manufacturer đăng ký lô thuốc, mint NFT trên Sepolia.
3. Upload ba loại chứng từ và thực hiện giao dịch gắn CID.
4. Xác nhận dữ liệu tài liệu được lưu và có thể truy xuất đúng quyền.
5. Chuyển lô Manufacturer → Distributor → Pharmacy/Hospital.
6. Kiểm tra quyền truy cập và giải mã giá chuyển giao.
7. Xem lịch sử lô thuốc trên Dashboard, Track & Trace và kiểm tra QR.
8. Gửi dữ liệu từ Oracle Sensor Simulator để kiểm tra cảnh báo nhiệt độ.
9. Burn NFT theo role và trạng thái hợp lệ.
10. Xác minh trạng thái cuối và lịch sử vẫn được lưu.

Cần lưu transaction hash, token ID, CID, receipt và ảnh minh chứng của từng bước để phục vụ nghiệm thu.

Tại thời điểm báo cáo, kịch bản này **đã được kiểm thử với EVM Hardhat cục bộ ở các phần tương ứng nhưng chưa nghiệm thu đầy đủ bằng giao dịch thật trên Sepolia**.

### 12.11. Các lỗi thường gặp

| Hiện tượng | Nguyên nhân hoặc hướng xử lý |
| --- | --- |
| Backend không khởi động | Kiểm tra Python environment, dependencies và `.env` |
| Frontend không gọi được API | Kiểm tra Backend port 8000 và cấu hình API |
| Xác thực ví trả `INVALID_ORIGIN` | Kiểm tra `FRONTEND_ORIGIN` và địa chỉ truy cập Frontend |
| Dashboard báo `INDEX_NOT_READY` | Kiểm tra tiến trình Event Indexer và trạng thái đồng bộ |
| RPC báo 429 | Giảm tần suất truy vấn, kiểm tra quota RPC và trạng thái Indexer |
| Registry không có dữ liệu | Kiểm tra contract, deployment block và có event đăng ký lô hay chưa |
| MetaMask hiển thị `NONE` | Ví chưa được cấp participant role hoặc không có role nghiệp vụ |
| Không thể Register | Kiểm tra Manufacturer, GTIN, batch, metadata CID, hạn dùng và gas |
| Không upload được Pinata | Kiểm tra JWT, quyền truy cập và kết nối dịch vụ |
| Không thấy tài liệu sau upload | Có thể chưa thực hiện giao dịch gắn CID lên Smart Contract |
| Không giải mã được tài liệu | Kiểm tra quyền truy cập, CID hiện hành và khóa mã hóa |
| Không thấy lịch sử sau giao dịch | Kiểm tra receipt, confirmations và Indexer đã bắt kịp chain chưa |

### 12.12. Lưu ý khi bàn giao và triển khai

- Giữ thống nhất chain ID, contract address và deployment block giữa Backend, Frontend và Indexer.
- Không chia sẻ private key, Pinata JWT hoặc khóa mã hóa trong tài liệu công khai.
- Không xóa SQLite vận hành hoặc thay khóa mã hóa nếu chưa có phương án sao lưu và khôi phục.
- Không coi dữ liệu mô phỏng hoặc kết quả Hardhat cục bộ là bằng chứng đã có giao dịch Sepolia thật.
- Khi chuyển sang máy khác, cần cấu hình lại RPC, Pinata, các khóa cần thiết và kiểm tra hoạt động từng thành phần.
- Không cần deploy lại Smart Contract nếu vẫn sử dụng deployment Sepolia đã được nhóm thống nhất.

**Kết luận:** Để chạy toàn bộ ứng dụng trên Sepolia, cần khởi động đồng thời **Backend API, Event Indexer và Frontend**. Hardhat phục vụ biên dịch, kiểm thử Smart Contract và các kịch bản EVM cục bộ, không phải một dịch vụ bắt buộc chạy liên tục trong chế độ Sepolia.

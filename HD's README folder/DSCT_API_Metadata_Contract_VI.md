# DSCT – Đặc tả giao tiếp API giữa Frontend và Backend cho NFT Metadata

**Phiên bản:** 1.0 – Đề xuất thống nhất giữa nhóm Frontend và Backend  
**Phạm vi:** Frontend xác thực ví với FastAPI, gửi thông tin lô thuốc để Backend tạo NFT Metadata JSON, upload lên IPFS thông qua Pinata và trả CID về cho Frontend.  
**Ngoài phạm vi:** Tích hợp API vào form `ManagePage.tsx`, upload ba loại tài liệu của lô thuốc, đăng ký/mint NFT trên Blockchain và triển khai Backend.

> **Trạng thái tài liệu:** Đây là API Contract đề xuất. Thành viên Backend cần xác nhận và triển khai đúng endpoint, tên trường, kiểu dữ liệu, cấu trúc response và mã lỗi trong tài liệu này. Nếu Backend đã có API khác, hai bên cần thống nhất cập nhật tài liệu trước khi tích hợp.

---

## 1. Phân chia trách nhiệm

| Thành phần               | Trách nhiệm                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React – `ManagePage.tsx` | Thu thập dữ liệu form, kiểm tra dữ liệu phía giao diện, gọi Metadata Service, nhận CID và sau đó gọi hàm đăng ký Contract. Việc tích hợp vào form do người phụ trách màn hình thực hiện riêng. |
| `services/api.ts`        | Tạo HTTP client dùng chung, cấu hình Base URL, gửi JSON, gửi cookie session, đọc response và chuẩn hóa lỗi API.                                                                                |
| `services/wallet.ts`     | Kết nối MetaMask để ký thông điệp đăng nhập do Backend cấp; gửi chữ ký để Backend xác minh và tạo session; gọi API logout.                                                                     |
| `services/metadata.ts`   | Định nghĩa kiểu request/response Metadata, tạo Idempotency-Key và gọi endpoint yêu cầu Backend tạo Metadata.                                                                                   |
| FastAPI Backend          | Xác thực session, kiểm tra quyền Manufacturer on-chain, xác thực dữ liệu, tạo JSON, upload JSON lên Pinata và trả CID.                                                                         |
| Pinata / IPFS            | Lưu trữ và pin Metadata JSON; thông tin xác thực Pinata chỉ nằm ở Backend.                                                                                                                     |
| Smart Contract           | Nhận CID do Frontend cung cấp trong giao dịch `registerMedicine(...)`; Contract không gọi FastAPI hoặc Pinata.                                                                                 |
| MetaMask                 | Người dùng ký thông điệp xác thực Backend và ký giao dịch đăng ký thuốc trên Sepolia.                                                                                                          |

**Trong phạm vi công việc hiện tại:** chỉ xây dựng ba service `api.ts`, `wallet.ts`, `metadata.ts` cùng tài liệu giao tiếp. Không sửa `ManagePage.tsx`, không gọi API từ form và không thay đổi `chain.ts` hoặc Smart Contract.

## 2. Phân biệt NFT Metadata và tài liệu CHEMICAL_METADATA

Endpoint trong tài liệu này tạo **NFT/medicine-batch metadata** được tham chiếu bởi trường `metadataCID` của `registerMedicine(...)`.

Nó không phải tài liệu `CHEMICAL_METADATA` (`chemical-metadata.json`) trong chức năng Document Management. Tài liệu Chemical Metadata mô tả các thông tin như dạng bào chế, thành phần, điều kiện bảo quản, đơn vị phát hành và cảnh báo. Tài liệu đó thuộc quy trình upload tài liệu riêng và sẽ được xử lý ở giai đoạn Document Management.

Không dùng CID của Chemical Metadata thay cho NFT Metadata CID, trừ khi nhóm thống nhất thay đổi thiết kế dữ liệu.

## 3. Quy ước chung

### 3.1. Base URL

Frontend cấu hình trong `frontend/.env.local`:

```env
VITE_API_BASE_URL=http://localhost:8000
```

- `VITE_API_BASE_URL` là địa chỉ gốc của FastAPI, không bao gồm `/api/v1`.
- Các service tự nối phần đường dẫn `/api/v1/...`.
- Khi triển khai thật phải dùng HTTPS.
- Biến `VITE_` được đưa vào bundle trình duyệt; không lưu secret trong biến này.

### 3.2. Định dạng dữ liệu

- Request và response dùng JSON UTF-8.
- Ngày dùng chuỗi `YYYY-MM-DD`.
- `chainId` dùng số nguyên `11155111` (Sepolia).
- Địa chỉ ví, CID, hash và token ID là chuỗi. Không chuyển `tokenId` thành JavaScript `number`.
- Response thành công dùng cấu trúc chung:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_example"
  }
}
```

- Response lỗi dùng cấu trúc chung:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Thông tin gửi lên không hợp lệ.",
    "requestId": "req_example",
    "details": {}
  }
}
```

`meta` và `details` có thể vắng mặt nếu không có dữ liệu tương ứng.

### 3.3. Cookie session

Frontend gửi request với `credentials: "include"`. Backend tạo cookie session sau khi xác minh chữ ký ví. Cookie nên có `HttpOnly`, `Secure` trên môi trường HTTPS, thời hạn phù hợp và `SameSite` được cấu hình theo cách triển khai FE/BE.

Frontend không đọc cookie HttpOnly, không ghi session secret vào `localStorage` và không tự gửi một trường `role` để chứng minh quyền.

## 4. Xác thực ví với Backend

Tài liệu thiết kế hệ thống đề xuất SIWE/EIP-4361 hoặc challenge tương đương. API dưới đây dùng message nguyên văn do Backend tạo và trả về; Frontend chỉ ký message đó, không tự dựng lại nội dung.

### 4.1. Lấy nonce và message

**Endpoint**

```http
POST /api/v1/auth/nonce
Content-Type: application/json
```

**Request**

```json
{
  "address": "0x7F727c2d6182628cF5cBc49353b7e2f5B52cde66",
  "chainId": 11155111
}
```

**Response thành công – HTTP 200**

```json
{
  "data": {
    "nonce": "one-time-random-nonce",
    "message": "Nội dung đăng nhập SIWE/challenge do Backend tạo",
    "expiresAt": "2026-11-17T16:00:00Z"
  },
  "meta": {
    "requestId": "req_example"
  }
}
```

**Yêu cầu phía Backend**

- Chỉ chấp nhận Sepolia, `chainId = 11155111`.
- Nonce phải được tạo bằng bộ sinh ngẫu nhiên an toàn, chỉ dùng một lần và có thời hạn ngắn.
- Nonce phải gắn với địa chỉ ví, domain/origin và chain ID.
- Message phải tuân theo SIWE/EIP-4361 hoặc challenge format mà hai bên đã thống nhất.
- Có rate limit cho endpoint này.

### 4.2. Xác minh chữ ký và tạo session

**Endpoint**

```http
POST /api/v1/auth/verify
Content-Type: application/json
```

**Request**

```json
{
  "message": "Nguyên văn message Backend đã trả ở bước nonce",
  "signature": "0x..."
}
```

**Response thành công – HTTP 200**

```json
{
  "data": {
    "address": "0x7F727c2d6182628cF5cBc49353b7e2f5B52cde66",
    "chainId": 11155111,
    "expiresAt": "2026-11-17T17:00:00Z"
  },
  "meta": {
    "requestId": "req_example"
  }
}
```

Ngoài response JSON, Backend phải thiết lập cookie session HttpOnly. Backend phải xác minh chữ ký, domain, chain, nonce chưa sử dụng, thời hạn và chống replay. Backend lấy địa chỉ từ chữ ký đã xác minh, không tin một địa chỉ hoặc Role do client tự khai báo.

### 4.3. Đăng xuất

**Endpoint**

```http
POST /api/v1/auth/logout
```

Backend thu hồi/xóa session cookie.

**Response thành công – HTTP 200**

```json
{
  "data": {
    "loggedOut": true
  },
  "meta": {
    "requestId": "req_example"
  }
}
```

## 5. API tạo và upload NFT Metadata

### 5.1. Endpoint

```http
POST /api/v1/metadata/medicine-batches
```

**Xác thực:** yêu cầu session hợp lệ được tạo từ `/api/v1/auth/verify`.

**Phân quyền:** Backend phải kiểm tra địa chỉ trong session là Participant đang hoạt động với Role `MANUFACTURER` trên DSCT Contract tại Sepolia.

Frontend không gửi Role làm bằng chứng phân quyền. Backend không ký giao dịch `registerMedicine()` thay cho người dùng.

**Headers**

```http
Content-Type: application/json
Accept: application/json
Idempotency-Key: <UUID>
```

`Idempotency-Key` do Frontend tạo cho mỗi lần tạo Metadata mới. Nếu request bị timeout hoặc response bị mất, Frontend phải gửi lại cùng payload với cùng key. Backend trả lại kết quả đã xử lý thay vì pin một JSON trùng lặp. Nếu cùng key nhưng payload khác, Backend trả `409 IDEMPOTENCY_KEY_REUSED`.

### 5.2. Request body

```json
{
  "gtin": "03459876012345",
  "batchNumber": "BT-2026-001",
  "medicineName": "Amoxicillin 500mg",
  "manufactureDate": "2026-11-17",
  "expiryDate": "2028-11-17"
}
```

| Trường            | Kiểu   | Quy tắc kiểm tra                                                                                  |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `gtin`            | string | Chính xác 14 chữ số; giữ số 0 ở đầu. Kiểm tra GS1 check digit chỉ bổ sung khi hai bên thống nhất. |
| `batchNumber`     | string | Bắt buộc, trim khoảng trắng, tối đa 64 ký tự.                                                     |
| `medicineName`    | string | Bắt buộc, trim khoảng trắng, tối đa 120 ký tự.                                                    |
| `manufactureDate` | string | `YYYY-MM-DD`, là ngày hợp lệ và không ở tương lai.                                                |
| `expiryDate`      | string | `YYYY-MM-DD`, là ngày hợp lệ, ở tương lai và sau ngày sản xuất.                                   |

Không gửi các trường `metadataCID`, `role`, `walletAddress`, `PINATA_JWT` hoặc private key trong body. Backend lấy danh tính ví từ session và đọc thông tin Participant/organization on-chain nếu cần.

### 5.3. Metadata JSON do Backend tạo

Backend tạo JSON và upload. Frontend không tự tạo CID, không gọi Pinata trực tiếp và không giữ Pinata JWT.

Ví dụ cấu trúc đề xuất:

```json
{
  "schemaVersion": "1.0",
  "name": "Amoxicillin 500mg - BT-2026-001",
  "description": "Medicine batch metadata for supply-chain traceability.",
  "attributes": [
    { "trait_type": "GTIN", "value": "03459876012345" },
    { "trait_type": "Batch Number", "value": "BT-2026-001" },
    { "trait_type": "Manufacture Date", "value": "2026-11-17" },
    { "trait_type": "Expiry Date", "value": "2028-11-17" },
    { "trait_type": "Manufacturer", "value": "DSCT Manufacturer" }
  ]
}
```

`Manufacturer` phải được lấy từ Participant on-chain gắn với session đã xác minh, không lấy từ trường do Frontend gửi lên. Không đưa dữ liệu giá bí mật, thông tin cá nhân nhạy cảm hoặc tài liệu giới hạn truy cập vào JSON công khai. Chỉ thêm `image` khi dự án có CID ảnh thực tế.

### 5.4. Response thành công

Chỉ trả thành công sau khi Pinata xác nhận JSON đã được pin và có CID.

**HTTP 201** cho lần tạo mới; có thể trả **HTTP 200** khi trả lại kết quả idempotent đã có.

```json
{
  "data": {
    "metadataCID": "bafy...",
    "uri": "ipfs://bafy...",
    "contentType": "application/json",
    "sha256": "<64 ký tự hexadecimal>",
    "sizeBytes": 512,
    "pinnedAt": "2026-11-17T16:05:00Z"
  },
  "meta": {
    "requestId": "req_example"
  }
}
```

Frontend lấy `data.metadataCID` làm đối số `metadataCID` cho hàm Contract `registerMedicine(...)`. `uri` chỉ dùng để hiển thị/liên kết. Contract hiện tại nhận CID thuần; không truyền tiền tố `ipfs://` trừ khi nhóm Contract chủ động đổi quy ước.

### 5.5. Mã lỗi thống nhất

|    HTTP | `error.code`                                      | Ý nghĩa và cách FE xử lý                                                      |
| ------: | ------------------------------------------------- | ----------------------------------------------------------------------------- |
|     400 | `VALIDATION_ERROR`                                | Dữ liệu không hợp lệ; hiển thị lỗi tương ứng.                                 |
|     401 | `AUTH_REQUIRED` hoặc `SESSION_EXPIRED`            | Yêu cầu xác thực lại ví.                                                      |
|     403 | `MANUFACTURER_ROLE_REQUIRED`                      | Ví không phải Manufacturer đang hoạt động; không retry như lỗi mạng.          |
|     409 | `IDEMPOTENCY_KEY_REUSED`                          | Cùng key nhưng payload khác; chỉ tạo key mới cho một yêu cầu tạo mới thực sự. |
|     429 | `RATE_LIMITED`                                    | Tạm dừng và thử lại sau; tôn trọng header `Retry-After` nếu có.               |
| 502/503 | `PINATA_UPLOAD_FAILED` hoặc `STORAGE_UNAVAILABLE` | Upload thất bại; không gọi giao dịch Blockchain.                              |
|     500 | `INTERNAL_SERVER_ERROR`                           | Hiển thị thông báo chung, giữ `requestId` để debug.                           |

Tất cả lỗi sử dụng envelope ở mục 3.2.

## 6. Quy trình phối hợp sau khi Backend triển khai API

Quy trình tích hợp dự kiến (không thuộc phạm vi ba file service được bàn giao ở lần này):

1. Frontend kết nối MetaMask; phần `chain.ts` hiện tại kiểm tra Sepolia và đọc Role on-chain.
2. Frontend gọi `authenticateWallet()` trong `wallet.ts` để xác thực cùng địa chỉ ví với Backend.
3. Manufacturer nhập thông tin lô thuốc.
4. Frontend kiểm tra form và gọi `createMedicineMetadata()` trong `metadata.ts`.
5. Backend tạo JSON và pin lên Pinata; Frontend nhận `metadataCID`.
6. Frontend giữ CID trong state/form. CID này được tái sử dụng nếu người dùng từ chối MetaMask hoặc giao dịch Blockchain thất bại.
7. Khi người dùng xác nhận đăng ký, Frontend gọi hàm `registerMedicine()` hiện tại qua MetaMask, truyền CID thuần.
8. Chỉ thông báo đăng ký thành công sau khi transaction receipt xác nhận thành công.

## 7. Quy tắc lỗi và retry

- Metadata upload thất bại: không gọi `registerMedicine()`.
- Metadata upload thành công nhưng người dùng từ chối MetaMask hoặc transaction revert: giữ CID để thử đăng ký lại, không upload lại JSON.
- Request upload timeout/mất response: retry cùng payload và cùng `Idempotency-Key`.
- Tạo Metadata mới cho một lần tạo khác: sinh key mới.
- Không đánh dấu đăng ký on-chain thành công chỉ vì upload Metadata thành công. Điều kiện thành công là transaction receipt có trạng thái thành công.

## 8. Yêu cầu bảo mật và cấu hình triển khai

- `PINATA_JWT`, Pinata API secret, private key, RPC secret và khóa mã hóa chỉ tồn tại trong cấu hình bí mật của Backend nếu chúng là bí mật server-side.
- Frontend chỉ cần `VITE_API_BASE_URL`; giá trị này không phải secret.
- Backend dùng HTTPS khi triển khai, CORS allow-list chính xác, rate limit, session expiry, nonce một lần và kiểm tra replay.
- Nếu FE và BE khác origin, Backend phải cấu hình `Access-Control-Allow-Origin` đúng origin FE, `Access-Control-Allow-Credentials: true` và cookie `SameSite`/`Secure` phù hợp. Không dùng wildcard origin với credentials.
- Backend kiểm tra Role on-chain từ session address. Không tin `role` hoặc `walletAddress` do client tự gửi làm bằng chứng quyền.
- Backend chỉ trả Metadata CID sau khi Pinata xác nhận pin thành công.

## 9. Tiêu chí nghiệm thu FE/BE

- Manufacturer có thể xác thực ví trên Sepolia và tạo Metadata thành công.
- Distributor, Pharmacy, Hospital và ví `NONE` không thể tạo Metadata dành cho Manufacturer.
- GTIN sai định dạng, thiếu Batch Number/Drug Name hoặc ngày không hợp lệ bị từ chối với mã lỗi ổn định.
- Backend chỉ trả `metadataCID` khi upload Pinata thành công.
- `metadataCID` là CID thuần, không có `ipfs://`, và có thể truy xuất qua IPFS gateway.
- Gửi lại cùng payload và cùng `Idempotency-Key` không tạo bản pin trùng.
- Frontend không chứa Pinata JWT hoặc private key.

## 10. Những điểm Backend cần xác nhận trước khi tích hợp

1. Có đồng ý giữ nguyên ba endpoint xác thực `/auth/nonce`, `/auth/verify`, `/auth/logout` không?
2. Có đồng ý endpoint tạo Metadata là `POST /api/v1/metadata/medicine-batches` không?
3. Backend có dùng đúng JSON envelope `{data, meta}` và `{error}` không?
4. Backend có thiết lập cookie session HttpOnly và hỗ trợ CORS credentials không?
5. Backend có kiểm tra Role Manufacturer trực tiếp từ Sepolia Contract không?
6. Backend có hỗ trợ `Idempotency-Key` để tránh pin Metadata trùng khi retry không?
7. Tên các trường và ràng buộc trong request/response có khớp tài liệu này không?

Chỉ sau khi các điểm trên được thống nhất, hai bên mới nên coi đây là API Contract dùng chung đã chốt.

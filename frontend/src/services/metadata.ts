/**
 * API nghiệp vụ tạo NFT/medicine-batch metadata và pin JSON lên IPFS/Pinata.
 *
 * File này CHỈ gọi Backend. Nó không tự tạo file JSON, không gọi Pinata trực
 * tiếp và không gửi giao dịch Smart Contract.
 */

import { apiRequest, type ApiEnvelope } from "./api";

const CREATE_MEDICINE_METADATA_ENDPOINT = "/api/v1/metadata/medicine-batches";

/** Dữ liệu lấy từ form Register Medicine gửi đến Backend. */
export interface CreateMedicineMetadataRequest {
  gtin: string;
  batchNumber: string;
  medicineName: string;
  manufactureDate: string;
  expiryDate: string;
}

/** Kết quả Backend trả về sau khi Pinata xác nhận đã pin JSON. */
export interface CreateMedicineMetadataResult {
  /** CID thuần, ví dụ bafy..., dùng làm đối số metadataCID của Contract. */
  metadataCID: string;
  /** URI dạng ipfs://..., chỉ dùng để hiển thị/liên kết. */
  uri: string;
  contentType: "application/json";
  /** SHA-256 dạng hexadecimal, 64 ký tự. */
  sha256: string;
  sizeBytes: number;
  pinnedAt: string;
}

/** Sinh UUID v4 bằng Web Crypto; không dùng Math.random cho idempotency key. */
export function createMetadataIdempotencyKey(): string {
  if (typeof crypto === "undefined") {
    throw new Error(
      "Trình duyệt không hỗ trợ Web Crypto để tạo Idempotency-Key an toàn.",
    );
  }

  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  // Định dạng UUID v4.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));

  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}

/**
 * Gửi yêu cầu tạo Metadata.
 *
 * BẮT BUỘC truyền idempotencyKey do bên gọi tạo và giữ lại. Khi request bị
 * timeout/mất response, hãy retry đúng payload với CÙNG key để Backend không
 * pin thêm một bản JSON khác. Với một lần tạo Metadata mới, hãy tạo key mới.
 *
 * Hàm trả về phần data; CID thuần nằm tại result.metadataCID.
 */
export async function createMedicineMetadata(
  payload: CreateMedicineMetadataRequest,
  idempotencyKey: string,
): Promise<CreateMedicineMetadataResult> {
  const key = idempotencyKey.trim();
  if (!key) {
    throw new Error(
      "Thiếu Idempotency-Key. Hãy tạo một key cho lần tạo Metadata này.",
    );
  }

  const response = await apiRequest<ApiEnvelope<CreateMedicineMetadataResult>>(
    CREATE_MEDICINE_METADATA_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Idempotency-Key": key,
      },
      body: payload,
    },
  );

  const result = response?.data;
  if (
    !result ||
    typeof result.metadataCID !== "string" ||
    !result.metadataCID.trim() ||
    typeof result.uri !== "string" ||
    !result.uri.startsWith("ipfs://")
  ) {
    throw new Error(
      "Backend trả về Metadata response không hợp lệ hoặc thiếu CID.",
    );
  }

  // Contract hiện tại nhận CID thuần, không nhận tiền tố ipfs://.
  if (/^ipfs:\/\//i.test(result.metadataCID)) {
    throw new Error(
      "Backend phải trả metadataCID dạng CID thuần, không có tiền tố ipfs://.",
    );
  }

  return result;
}

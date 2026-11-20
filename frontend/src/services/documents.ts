
import { apiRequest, type ApiEnvelope } from "./api";

export type DocumentType =
  | "CERTIFICATE_OF_ORIGIN"
  | "QUALITY_CERTIFICATE"
  | "CHEMICAL_METADATA";

export interface UploadedDocument {
  tokenId: string;
  documentType: DocumentType;
  visibility: "PUBLIC" | "RESTRICTED";
  cid: string;
  sha256: string;
  sizeBytes: number;
  contentType: string;
  pinnedAt: string;
  encrypted: boolean;
  status: "UPLOADED_NOT_LINKED";
}

export async function uploadDocument(
  tokenId: string,
  documentType: DocumentType,
  file: File,
  visibility: UploadedDocument["visibility"] = "PUBLIC"
): Promise<UploadedDocument> {
  const form = new FormData();

  form.append("file", file);
  form.append("documentType", documentType);
  form.append("visibility", visibility);

  const response = await apiRequest<ApiEnvelope<UploadedDocument>>(
    `/api/v1/batches/${tokenId}/documents`,
    {
      method: "POST",
      body: form
    }
  );

  if (!response.data?.cid) {
    throw new Error("Backend không trả về CID hợp lệ.");
  }

  return response.data;
}

export async function recoverPendingDocument(tokenId: string, documentType: DocumentType, visibility: UploadedDocument["visibility"]) {
  const result = await apiRequest<ApiEnvelope<{cid: string} | null>>(
    `/api/v1/batches/${tokenId}/documents/pending?documentType=${documentType}&visibility=${visibility}`
  );
  if (!result.data) throw new Error("No pending CID for this batch and document type.");
  return result.data;
}

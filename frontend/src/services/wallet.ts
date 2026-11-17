/**
 * Xác thực ví MetaMask với DSCT FastAPI Backend bằng challenge/SIWE.
 *
 * Luồng:
 *   1. Lấy địa chỉ ví và kiểm tra Sepolia.
 *   2. POST /api/v1/auth/nonce để lấy message chính xác từ Backend.
 *   3. Dùng MetaMask ký message đó.
 *   4. POST /api/v1/auth/verify để Backend xác minh chữ ký và tạo session.
 *
 * Session cookie do Backend thiết lập phải là HttpOnly. Frontend không đọc,
 * không lưu cookie vào localStorage và không nhận PINATA_JWT.
 */

import { BrowserProvider, getAddress, type Eip1193Provider } from "ethers";
import { apiRequest, type ApiEnvelope } from "./api";

export const DSCT_SEPOLIA_CHAIN_ID = 11155111;

const AUTH_NONCE_ENDPOINT = "/api/v1/auth/nonce";
const AUTH_VERIFY_ENDPOINT = "/api/v1/auth/verify";
const AUTH_LOGOUT_ENDPOINT = "/api/v1/auth/logout";

export interface WalletNonceRequest {
  address: string;
  chainId: number;
}

export interface WalletNonceResponse {
  nonce: string;
  /** FE phải ký nguyên văn message Backend trả về, không tự dựng lại. */
  message: string;
  expiresAt: string;
}

export interface WalletVerifyRequest {
  message: string;
  signature: string;
}

export interface WalletSession {
  address: string;
  chainId: number;
  expiresAt: string;
}

export interface WalletLogoutResponse {
  loggedOut: boolean;
}

function getInjectedProvider(): Eip1193Provider {
  const injected = (window as Window & { ethereum?: Eip1193Provider }).ethereum;

  if (!injected) {
    throw new Error(
      "Không tìm thấy ví Ethereum trong trình duyệt. Hãy cài đặt hoặc mở MetaMask.",
    );
  }

  return injected;
}

/**
 * Xác thực ví đang được chọn trong MetaMask với Backend.
 * Backend phải tự xác minh chữ ký, nonce, domain, chainId và Role on-chain.
 */
export async function authenticateWallet(): Promise<WalletSession> {
  const provider = new BrowserProvider(getInjectedProvider());

  // Yêu cầu quyền truy cập tài khoản MetaMask.
  const accounts = (await provider.send("eth_requestAccounts", [])) as string[];

  if (!Array.isArray(accounts) || accounts.length === 0 || !accounts[0]) {
    throw new Error("Không có tài khoản ví nào được chọn trong MetaMask.");
  }

  const signer = await provider.getSigner(accounts[0]);
  const address = getAddress(await signer.getAddress());
  const network = await provider.getNetwork();

  if (network.chainId !== BigInt(DSCT_SEPOLIA_CHAIN_ID)) {
    throw new Error(
      `Vui lòng chuyển MetaMask sang Sepolia (Chain ID ${DSCT_SEPOLIA_CHAIN_ID}).`,
    );
  }

  // Bước 1: Backend cấp nonce và message đăng nhập.
  const nonceEnvelope = await apiRequest<ApiEnvelope<WalletNonceResponse>>(
    AUTH_NONCE_ENDPOINT,
    {
      method: "POST",
      body: {
        address,
        chainId: DSCT_SEPOLIA_CHAIN_ID,
      } satisfies WalletNonceRequest,
    },
  );

  const nonceData = nonceEnvelope?.data;
  if (
    !nonceData ||
    typeof nonceData.message !== "string" ||
    !nonceData.message.trim() ||
    typeof nonceData.nonce !== "string" ||
    !nonceData.nonce.trim()
  ) {
    throw new Error("Backend trả về nonce/message đăng nhập không hợp lệ.");
  }

  // Bước 2: Ký đúng message nguyên văn do Backend cung cấp.
  const signature = await signer.signMessage(nonceData.message);

  // Kiểm tra lại mạng trước khi xác minh để tránh đăng nhập sai chain.
  const networkAfterSigning = await provider.getNetwork();
  if (networkAfterSigning.chainId !== BigInt(DSCT_SEPOLIA_CHAIN_ID)) {
    throw new Error(
      "Mạng MetaMask đã thay đổi trong lúc ký. Vui lòng kết nối và xác thực lại.",
    );
  }

  // Bước 3: Backend xác minh chữ ký và thiết lập HttpOnly session cookie.
  const verifyEnvelope = await apiRequest<ApiEnvelope<WalletSession>>(
    AUTH_VERIFY_ENDPOINT,
    {
      method: "POST",
      body: {
        message: nonceData.message,
        signature,
      } satisfies WalletVerifyRequest,
    },
  );

  const session = verifyEnvelope?.data;
  if (!session?.address || !session.expiresAt) {
    throw new Error("Backend không trả về thông tin phiên đăng nhập hợp lệ.");
  }

  if (getAddress(session.address) !== address) {
    throw new Error(
      "Địa chỉ ví trong phiên Backend không khớp với ví MetaMask đang kết nối.",
    );
  }

  if (Number(session.chainId) !== DSCT_SEPOLIA_CHAIN_ID) {
    throw new Error(
      "Backend xác nhận phiên đăng nhập không thuộc mạng Sepolia.",
    );
  }

  return {
    address: getAddress(session.address),
    chainId: Number(session.chainId),
    expiresAt: session.expiresAt,
  };
}

/** Hủy session Backend. Cookie HttpOnly được trình duyệt gửi tự động. */
export async function logoutWalletSession(): Promise<boolean> {
  const response = await apiRequest<ApiEnvelope<WalletLogoutResponse>>(
    AUTH_LOGOUT_ENDPOINT,
    { method: "POST" },
  );

  return response?.data?.loggedOut === true;
}

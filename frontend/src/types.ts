export type Role =
  | "NONE"
  | "MANUFACTURER"
  | "DISTRIBUTOR"
  | "PHARMACY"
  | "HOSPITAL";
export type Status =
  | "registered"
  | "in-transit"
  | "at-dispenser"
  | "expired"
  | "consumed"
  | "destroyed"
  | "invalid-owner";
export interface Batch {
  tokenId: string;
  gtin: string;
  batchNumber: string;
  medicineName: string;
  manufacturer: string;
  manufactureDate: number;
  expiryDate: number;
  registeredAt: number;
  lifecycle: number;
  stage: number;
  metadataCID: string;
  owner: string;
  ownerRole?: Role;
  verification: number;
  status: Status;
}
export interface HistoryItem {
  kind: "registered" | "transferred" | "document" | "burned";
  label: string;
  actor: string;
  to?: string;
  timestamp: number;
  txHash: string;
  detail?: string;
}
export interface WalletState {
  address: string;
  role: Role;
  organization: string;
  balance: string;
  preview: boolean;
  isAdmin?: boolean;
}
export interface TxState {
  phase: "signing" | "pending" | "success" | "failed";
  title: string;
  hash?: string;
  error?: string;
  preview?: boolean;
}

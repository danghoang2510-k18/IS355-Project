import { authenticateWallet } from "./wallet";
import { apiRequest, getApiBaseUrl, type ApiEnvelope } from "./api";
import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  formatEther,
  getAddress,
  getBytes,
  isAddress,
  toUtf8Bytes,
  toUtf8String,
  type Eip1193Provider,
  type TransactionResponse,
} from "ethers";
import abi from "../../../shared/abi/DrugSupplyChain.json";
import type { Batch, HistoryItem, Role, WalletState } from "../types";

const ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS?.trim() || "";
const RPC = import.meta.env.VITE_SEPOLIA_RPC_URL?.trim() || "";
const START = Number(import.meta.env.VITE_DEPLOYMENT_BLOCK || 0);
const CHAIN_ID = 11155111n;
export const configured = isAddress(ADDRESS);
export const publicReadReady = configured && Boolean(RPC);
export const explorer = (hashOrAddress: string) =>
  `https://sepolia.etherscan.io/${hashOrAddress.startsWith("0x") && hashOrAddress.length === 42 ? "address" : "tx"}/${hashOrAddress}`;
export const short = (s: string) =>
  s.length > 15 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;

export function parseScannedCode(raw: string): string {
  const value = raw.trim();
  if (!/^https?:\/\//i.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("The QR URL is invalid.");
  }
  if (url.origin !== window.location.origin)
    throw new Error("QR URL must point to this application origin.");
  const chainId = url.searchParams.get("chainId");
  const contract = url.searchParams.get("contract");
  const tokenId = url.searchParams.get("tokenId");
  if (
    chainId !== CHAIN_ID.toString() ||
    !contract ||
    !configured ||
    !isAddress(contract) ||
    getAddress(contract) !== getAddress(ADDRESS)
  )
    throw new Error(
      "QR code does not match the configured Sepolia chain and contract.",
    );
  if (!tokenId || !/^[0-9]{1,78}$/.test(tokenId) || BigInt(tokenId) >= 2n ** 256n)
    throw new Error("QR code has no valid token ID.");
  return tokenId;
}
declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      on?: (event: string, handler: (...args: unknown[]) => void) => void;
      removeListener?: (
        event: string,
        handler: (...args: unknown[]) => void,
      ) => void;
      request: (args: {
        method: string;
        params?: unknown[];
      }) => Promise<unknown>;
    };
  }
}

let publicProvider: JsonRpcProvider | undefined;
function readProvider() {
  if (RPC) return publicProvider ??= new JsonRpcProvider(RPC, Number(CHAIN_ID));
  if (window.ethereum) return new BrowserProvider(window.ethereum, Number(CHAIN_ID));
  throw new Error(
    "Set VITE_SEPOLIA_RPC_URL or install a wallet to read Sepolia.",
  );
}

/**
 * Query blockchain events in small block ranges.
 *
 * Alchemy Free tier currently limits eth_getLogs
 * to a maximum of 10 blocks per request.
 */
async function queryLogsInChunks<T>(
  query: (fromBlock: number, toBlock: number) => Promise<T[]>,
): Promise<T[]> {
  const CHUNK_SIZE = 10;

  if (!Number.isSafeInteger(START) || START <= 0) {
    throw new Error("Invalid VITE_DEPLOYMENT_BLOCK configuration.");
  }

  const latestBlock = await readProvider().getBlockNumber();

  const allLogs: T[] = [];

  for (
    let fromBlock = START;
    fromBlock <= latestBlock;
    fromBlock += CHUNK_SIZE
  ) {
    // Each request contains at most 10 blocks (inclusive).
    const toBlock = Math.min(fromBlock + CHUNK_SIZE - 1, latestBlock);

    const logs = await query(fromBlock, toBlock);

    allLogs.push(...logs);
  }

  return allLogs;
}

export function readContract() {
  if (!configured)
    throw new Error(
      "Set VITE_CONTRACT_ADDRESS to the deployed Sepolia contract.",
    );
  return new Contract(ADDRESS, abi, readProvider());
}
async function writeContract() {
  if (!configured)
    throw new Error("Deploy the contract and set VITE_CONTRACT_ADDRESS first.");
  if (!window.ethereum)
    throw new Error("MetaMask or another injected wallet is required.");
  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID)
    throw new Error("Switch your wallet to Sepolia (chain ID 11155111).");
  return new Contract(ADDRESS, abi, await provider.getSigner());
}
const roleNames: Role[] = [
  "NONE",
  "MANUFACTURER",
  "DISTRIBUTOR",
  "PHARMACY",
  "HOSPITAL",
];
export async function connectWallet(): Promise<WalletState> {
  if (!configured)
    throw new Error(
      "Deploy DrugSupplyChain and set VITE_CONTRACT_ADDRESS before connecting a live wallet.",
    );
  if (!window.ethereum)
    throw new Error("Install MetaMask or another Ethereum wallet.");
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const provider = new BrowserProvider(window.ethereum);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID)
    throw new Error("Select Sepolia in your wallet.");
  let role: Role = "NONE",
    organization = "Unregistered wallet";
  const contract = new Contract(ADDRESS, abi, provider);
  const [p, isAdmin] = await Promise.all([
    contract.getParticipant(address), contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), address),
  ]);
  if (p.active) {
    role = roleNames[Number(p.role)] || "NONE";
    organization = p.organizationName;
  }
  return {
    address,
    role,
    organization,
    balance: Number(formatEther(await provider.getBalance(address))).toFixed(3),
    preview: false,
    isAdmin,
  };
}
export function statusOf(verification: number, stage: number): Batch["status"] {
  return verification === 2
    ? "expired"
    : verification === 3
      ? "consumed"
      : verification === 4
        ? "destroyed"
        : verification === 5
          ? "invalid-owner"
          : stage === 0
            ? "registered"
            : stage === 1
              ? "in-transit"
              : "at-dispenser";
}
export async function getBatch(tokenId: string): Promise<Batch> {
  const c = readContract();
  const [verification, owner] = await c.verifyProduct(BigInt(tokenId));
  if (Number(verification) === 0) throw new Error("UnknownBatch");
  const raw = await c.getMedicine(BigInt(tokenId));
  const v = Number(verification),
    stage = Number(raw.stage);
  return {
    tokenId: raw.tokenId.toString(),
    gtin: raw.gtin,
    batchNumber: raw.batchNumber,
    medicineName: raw.medicineName,
    manufacturer: raw.manufacturer,
    manufactureDate: Number(raw.manufactureDate),
    expiryDate: Number(raw.expiryDate),
    registeredAt: Number(raw.registeredAt),
    lifecycle: Number(raw.lifecycle),
    stage,
    metadataCID: raw.metadataCID,
    owner,
    ownerRole: Number(raw.lifecycle) !== 0 || v === 5 ? "NONE" : stage === 0 ? "MANUFACTURER" :
      stage === 1 ? "DISTRIBUTOR" : roleNames[Number((await c.getParticipant(owner)).role)],
    verification: v,
    status: statusOf(v, stage),
  };
}
interface IndexedEvent {
  tokenId: string; event: string; timestamp: number; txHash: string;
  args: Record<string, string | number>;
}

async function indexedEvents(path: string): Promise<IndexedEvent[] | null> {
  if (!getApiBaseUrl()) return null;
  const events: IndexedEvent[] = [];
  let snapshot = "";
  try {
    for (let page = 1; ; page++) {
      const result = await apiRequest<ApiEnvelope<IndexedEvent[]>>(`${path}?page=${page}`);
      const meta = result.meta;
      if (meta?.chainId !== Number(CHAIN_ID) || String(meta.contract).toLowerCase() !== ADDRESS.toLowerCase()
          || typeof meta.blockHash !== "string" || (snapshot && snapshot !== meta.blockHash)) return null;
      snapshot = meta.blockHash;
      events.push(...result.data);
      if (!meta.hasMore) return events;
    }
  } catch {
    return null;
  }
}

export async function listBatches(): Promise<Batch[]> {
  const indexed = await indexedEvents("/api/v1/batches");
  if (indexed) return (await Promise.all(indexed.map(e => getBatch(e.tokenId)))).reverse();
  const c = readContract();
  const events = await queryLogsInChunks((fromBlock, toBlock) =>
    c.queryFilter(c.filters.MedicineRegistered(), fromBlock, toBlock),
  );
  const ids = [
    ...new Set(
      events
        .map((e) => (e.topics[1] ? BigInt(e.topics[1]).toString() : ""))
        .filter(Boolean),
    ),
  ];
  const batches = await Promise.all(ids.map((id) => getBatch(id)));
  return batches.reverse();
}
export async function resolveBatch(
  input: string,
  registry: Batch[],
): Promise<Batch> {
  const v = input.trim();
  const exactToken = registry.find(b => b.tokenId === v);
  if (exactToken) return configured ? getBatch(exactToken.tokenId) : exactToken;
  const matches = registry.filter(b => b.batchNumber.toLowerCase() === v.toLowerCase() || b.gtin === v);
  if (matches.length > 1) throw new Error("Multiple batches match this identifier. Use a token ID.");
  const found = matches[0];
  if (found) return configured ? getBatch(found.tokenId) : found;
  if (/^\d+$/.test(v) && configured) return getBatch(v);
  throw new Error(
    "No matching batch found. Use a token ID or a registered batch ID/GTIN.",
  );
}
function historyItem(event: string, args: Record<string, unknown>, timestamp: number, txHash: string): HistoryItem {
  const base = {timestamp, txHash};
  switch (event) {
    case "MedicineRegistered":
      return {...base, kind: "registered", label: "Manufacturer", actor: String(args.manufacturer),
        detail: `Batch registered · ${args.batchNumber}`};
    case "CustodyTransferred":
      return {...base, kind: "transferred", label: "Custody transferred", actor: String(args.from),
        to: String(args.to), detail: "Encrypted price recorded in transaction event."};
    case "DocumentCIDUpdated":
      return {...base, kind: "document", label: "Document updated", actor: String(args.updatedBy),
        detail: `CID: ${args.cid}`};
    case "TokenBurned":
      return {...base, kind: "burned", label: Number(args.finalStatus) === 1 ? "Dispensed" : "Destroyed",
        actor: String(args.lastOwner), detail: "NFT burned; history remains on-chain."};
    default:
      throw new Error("Unrecognized custody event.");
  }
}
export async function getHistory(tokenId: string): Promise<HistoryItem[]> {
  const c = readContract();
  const indexed = await indexedEvents(`/api/v1/batches/${tokenId}/timeline`);
  if (indexed) return indexed.map(e => historyItem(e.event, e.args, e.timestamp, e.txHash));
  const id = BigInt(tokenId);
  const provider = readProvider();
  const topics = ["MedicineRegistered", "CustodyTransferred", "DocumentCIDUpdated", "TokenBurned"]
    .map(name => c.interface.getEvent(name)!.topicHash);
  const logs = await queryLogsInChunks((fromBlock, toBlock) => provider.getLogs({
    address: ADDRESS, topics: [topics, "0x" + id.toString(16).padStart(64, "0")], fromBlock, toBlock,
  }));
  const blocks = new Map<string, number>();
  const items: HistoryItem[] = [];
  for (const log of logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index)) {
    if (!blocks.has(log.blockHash)) {
      const block = await provider.getBlock(log.blockHash);
      if (!block) throw new Error("History block unavailable. Retry after the chain settles.");
      blocks.set(log.blockHash, block.timestamp);
    }
    const parsed = c.interface.parseLog(log);
    if (parsed) items.push(historyItem(parsed.name, parsed.args, blocks.get(log.blockHash)!, log.transactionHash));
  }
  return items;
}
export async function registerMedicine(data: {
  gtin: string;
  batchNumber: string;
  medicineName: string;
  manufactureDate: string;
  expiryDate: string;
  metadataCID: string;
}): Promise<TransactionResponse> {
  const c = await writeContract();
  const manufacture = Math.floor(
    new Date(data.manufactureDate).getTime() / 1000,
  );
  const expiry = Math.floor(new Date(data.expiryDate).getTime() / 1000);
  if (
    !data.gtin.trim() ||
    !data.batchNumber.trim() ||
    !data.medicineName.trim() ||
    !data.metadataCID.trim()
  )
    throw new Error("Complete all required fields.");
  if (
    !Number.isFinite(manufacture) ||
    !Number.isFinite(expiry) ||
    manufacture > Date.now() / 1000 ||
    expiry <= Date.now() / 1000 ||
    expiry <= manufacture
  )
    throw new Error("Manufacture and expiry dates are invalid.");
  await c.registerMedicine.staticCall(
    data.gtin.trim(),
    data.batchNumber.trim(),
    data.medicineName.trim(),
    manufacture,
    expiry,
    data.metadataCID.trim(),
  );
  return c.registerMedicine(
    data.gtin.trim(),
    data.batchNumber.trim(),
    data.medicineName.trim(),
    manufacture,
    expiry,
    data.metadataCID.trim(),
  );
}
export async function transferBatch(
  tokenId: string,
  recipient: string,
  price: string,
): Promise<TransactionResponse> {
  if (!isAddress(recipient))
    throw new Error("Recipient wallet address is invalid.");
  const c = await writeContract();
  const signer = await new BrowserProvider(window.ethereum!).getSigner();
  if (getAddress(await signer.getAddress()) === getAddress(recipient))
    throw new Error("Recipient must be another wallet.");
  const session = await authenticateWallet();
  if (getAddress(session.address) !== getAddress(await signer.getAddress()))
    throw new Error("Wallet changed before encryption.");
  const {data} = await apiRequest<ApiEnvelope<{encryptedPrice: string}>>(
    "/api/v1/encryption/prices", {method: "POST", body: {tokenId, recipient, amount: price, currency: "USD"}}
  );
  const bytes = data.encryptedPrice;
  await c.transferOwnership.staticCall(BigInt(tokenId), recipient, bytes);
  return c.transferOwnership(BigInt(tokenId), recipient, bytes);
}
export async function updateParticipant(address: string, role: number, organization: string, active: boolean) {
  if (!isAddress(address) || (active && !organization.trim())) throw new Error("Enter a valid wallet and organization.");
  const c = await writeContract();
  await c.setParticipant.staticCall(address, role, organization.trim(), active);
  return c.setParticipant(address, role, organization.trim(), active) as Promise<TransactionResponse>;
}

export async function burnBatch(
  tokenId: string,
  finalStatus: 1 | 2,
): Promise<TransactionResponse> {
  const c = await writeContract();
  await c.burnToken.staticCall(BigInt(tokenId), finalStatus);
  return c.burnToken(BigInt(tokenId), finalStatus);
}
export async function setDocument(
  tokenId: string,
  kind: 0 | 1 | 2,
  cid: string,
): Promise<TransactionResponse> {
  if (!cid.trim()) throw new Error("Enter a document CID.");
  const c = await writeContract();
  await c.setDocumentCID.staticCall(BigInt(tokenId), kind, cid.trim());
  return c.setDocumentCID(BigInt(tokenId), kind, cid.trim());
}
export async function getDocuments(tokenId: string) {
  const c = readContract();
  return Promise.all(
    [0, 1, 2].map(async (kind) => {
      const d = await c.getDocument(BigInt(tokenId), kind);
      return { kind, cid: String(d.cid), updatedBy: String(d.updatedBy) };
    }),
  );
}
export async function decryptTransferPrice(tokenId: string, txHash: string, wallet: string, secret?: string) {
  if (!secret) {
    const session = await authenticateWallet();
    if (getAddress(session.address) !== getAddress(wallet)) throw new Error("Wallet changed.");
    const result = await apiRequest<ApiEnvelope<{amount: string}>>("/api/v1/encryption/prices/decrypt",
      {method: "POST", body: {tokenId, txHash}});
    return result.data.amount;
  }
  const receipt = await readProvider().getTransactionReceipt(txHash);
  const c = readContract();
  const events = receipt?.logs.filter(log => log.address.toLowerCase() === ADDRESS.toLowerCase())
    .map(log => c.interface.parseLog(log))
    .filter(event => event?.name === "CustodyTransferred" && event.args.tokenId.toString() === tokenId);
  const parsed = events?.length === 1 && events[0];
  if (!parsed || ![parsed.args.from, parsed.args.to].some(party => getAddress(party) === getAddress(wallet)))
    throw new Error("Transfer is unavailable for this wallet.");
  const envelope = JSON.parse(
    toUtf8String(getBytes(parsed.args.encryptedPrice)),
  ) as {
    v: number;
    alg: string;
    kdf: string;
    iterations: number;
    salt: string;
    nonce: string;
    ciphertext: string;
  };
  if (
    envelope.v !== 1 ||
    envelope.alg !== "AES-256-GCM" ||
    envelope.kdf !== "PBKDF2-SHA256" ||
    envelope.iterations !== 250000
  )
    throw new Error("Unsupported encryption envelope.");
  const binary = (v: string) =>
    Uint8Array.from(atob(v), (c) => c.charCodeAt(0));
  const salt = binary(envelope.salt),
    nonce = binary(envelope.nonce),
    ciphertext = binary(envelope.ciphertext);
  const base = await crypto.subtle.importKey(
    "raw",
    new Uint8Array(toUtf8Bytes(secret)).buffer,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt.buffer as ArrayBuffer,
      iterations: 250000,
      hash: "SHA-256",
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  try {
    return new TextDecoder().decode(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce.buffer as ArrayBuffer },
        key,
        ciphertext.buffer as ArrayBuffer,
      ),
    );
  } catch {
    throw new Error("Decryption failed. Check the passphrase or ciphertext.");
  }
}
export const isLiveReady = () =>
  configured && (Boolean(RPC) || Boolean(window.ethereum));

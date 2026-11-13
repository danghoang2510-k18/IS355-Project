import { BrowserProvider, Contract, JsonRpcProvider, formatEther, getAddress, getBytes, isAddress, toUtf8Bytes, toUtf8String, type Eip1193Provider, type TransactionResponse } from 'ethers';
import abi from '../../../shared/abi/DrugSupplyChain.json';
import type { Batch, HistoryItem, Role, WalletState } from '../types';

const ADDRESS=import.meta.env.VITE_CONTRACT_ADDRESS?.trim()||'';
const RPC=import.meta.env.VITE_SEPOLIA_RPC_URL?.trim()||'';
const START=Number(import.meta.env.VITE_DEPLOYMENT_BLOCK||0);
const CHAIN_ID=11155111n;
export const configured=isAddress(ADDRESS);
export const publicReadReady=configured&&Boolean(RPC);
export const explorer=(hashOrAddress:string)=>`https://sepolia.etherscan.io/${hashOrAddress.startsWith('0x')&&hashOrAddress.length===42?'address':'tx'}/${hashOrAddress}`;
export const short=(s:string)=>s.length>15?`${s.slice(0,6)}...${s.slice(-4)}`:s;

export function parseScannedCode(raw:string,preview:boolean):string{
 const value=raw.trim();
 if(!/^https?:\/\//i.test(value))return value;
 let url:URL;
 try{url=new URL(value)}catch{throw new Error('The QR URL is invalid.');}
 if(preview)throw new Error('QR URL verification requires a deployed Sepolia contract. Use a sample batch ID in preview.');
 if(url.origin!==window.location.origin)throw new Error('QR URL must point to this application origin.');
 const chainId=url.searchParams.get('chainId');
 const contract=url.searchParams.get('contract');
 const tokenId=url.searchParams.get('tokenId');
 if(chainId!==CHAIN_ID.toString()||!contract||!configured||!isAddress(contract)||getAddress(contract)!==getAddress(ADDRESS))throw new Error('QR code does not match the configured Sepolia chain and contract.');
 if(!tokenId||!/^\d+$/.test(tokenId))throw new Error('QR code has no valid token ID.');
 return tokenId;
}

declare global { interface Window { ethereum?: Eip1193Provider & { on?: (event:string,handler:(...args:unknown[])=>void)=>void; removeListener?: (event:string,handler:(...args:unknown[])=>void)=>void; request:(args:{method:string;params?:unknown[]})=>Promise<unknown> } } }

function readProvider(){
  if(RPC)return new JsonRpcProvider(RPC,Number(CHAIN_ID));
  if(window.ethereum)return new BrowserProvider(window.ethereum);
  throw new Error('Set VITE_SEPOLIA_RPC_URL or install a wallet to read Sepolia.');
}
export function readContract(){if(!configured)throw new Error('Set VITE_CONTRACT_ADDRESS to the deployed Sepolia contract.');return new Contract(ADDRESS,abi,readProvider());}
async function writeContract(){
 if(!configured)throw new Error('Deploy the contract and set VITE_CONTRACT_ADDRESS first.');
 if(!window.ethereum)throw new Error('MetaMask or another injected wallet is required.');
 const provider=new BrowserProvider(window.ethereum);const network=await provider.getNetwork();
 if(network.chainId!==CHAIN_ID)throw new Error('Switch your wallet to Sepolia (chain ID 11155111).');
 return new Contract(ADDRESS,abi,await provider.getSigner());
}
const roleNames:Role[]=['NONE','MANUFACTURER','DISTRIBUTOR','PHARMACY','HOSPITAL'];
export async function connectWallet():Promise<WalletState>{
 if(!configured)throw new Error('Deploy DrugSupplyChain and set VITE_CONTRACT_ADDRESS before connecting a live wallet.');
 if(!window.ethereum)throw new Error('Install MetaMask or another Ethereum wallet.');
 await window.ethereum.request({method:'eth_requestAccounts'});
 const provider=new BrowserProvider(window.ethereum);const signer=await provider.getSigner();const address=await signer.getAddress();
 const network=await provider.getNetwork();if(network.chainId!==CHAIN_ID)throw new Error('Select Sepolia in your wallet.');
 let role:Role='NONE',organization='Unregistered wallet';
 const p=await new Contract(ADDRESS,abi,provider).getParticipant(address);if(p.active){role=roleNames[Number(p.role)]||'NONE';organization=p.organizationName;}
 return {address,role,organization,balance:Number(formatEther(await provider.getBalance(address))).toFixed(3),preview:false};
}
export function statusOf(verification:number,stage:number):Batch['status']{return verification===2?'expired':verification===3?'consumed':verification===4?'destroyed':verification===5?'invalid-owner':stage===0?'registered':stage===1?'in-transit':'at-dispenser';}
export async function getBatch(tokenId:string):Promise<Batch>{
 const c=readContract();const [verification,owner]=await c.verifyProduct(BigInt(tokenId));
 if(Number(verification)===0)throw new Error('UnknownBatch');
 const raw=await c.getMedicine(BigInt(tokenId));
 const v=Number(verification),stage=Number(raw.stage);return {tokenId:raw.tokenId.toString(),gtin:raw.gtin,batchNumber:raw.batchNumber,medicineName:raw.medicineName,manufacturer:raw.manufacturer,manufactureDate:Number(raw.manufactureDate),expiryDate:Number(raw.expiryDate),registeredAt:Number(raw.registeredAt),lifecycle:Number(raw.lifecycle),stage,metadataCID:raw.metadataCID,owner,verification:v,status:statusOf(v,stage)};
}
export async function listBatches():Promise<Batch[]>{
 const c=readContract();const events=await c.queryFilter(c.filters.MedicineRegistered(),START,'latest');
 const ids=[...new Set(events.map(e=>e.topics[1]?BigInt(e.topics[1]).toString():'').filter(Boolean))];
 const batches=await Promise.all(ids.map(id=>getBatch(id)));
 return batches.reverse();
}
export async function resolveBatch(input:string,registry:Batch[]):Promise<Batch>{
 const v=input.trim();const found=registry.find(b=>[b.tokenId,b.batchNumber.toLowerCase(),b.gtin].includes(v.toLowerCase()));
 if(found)return configured?getBatch(found.tokenId):found;
 if(/^\d+$/.test(v)&&configured)return getBatch(v);
 throw new Error('No matching batch found. Use a token ID or a registered batch ID/GTIN.');
}
export async function getHistory(tokenId:string):Promise<HistoryItem[]>{
 const c=readContract();const id=BigInt(tokenId);const filters=[c.filters.MedicineRegistered(id),c.filters.CustodyTransferred(id),c.filters.DocumentCIDUpdated(id),c.filters.TokenBurned(id)];
 const groups=await Promise.all(filters.map(f=>c.queryFilter(f,START,'latest')));const provider=readProvider();const blocks=new Map<number,number>();
 const items:HistoryItem[]=[];for(let i=0;i<groups.length;i++)for(const e of groups[i]){
   if(!blocks.has(e.blockNumber)){const block=await provider.getBlock(e.blockNumber);blocks.set(e.blockNumber,block?.timestamp||0);}
   const parsed=c.interface.parseLog({topics:[...e.topics],data:e.data});if(!parsed)continue;
   const a=parsed.args;items.push(i===0?{kind:'registered',label:'Manufacturer',actor:a.manufacturer,timestamp:blocks.get(e.blockNumber)!,txHash:e.transactionHash,detail:`Batch registered · ${a.batchNumber}`}:i===1?{kind:'transferred',label:'Custody transferred',actor:a.from,to:a.to,timestamp:blocks.get(e.blockNumber)!,txHash:e.transactionHash,detail:'Encrypted price recorded in transaction event.'}:i===2?{kind:'document',label:'Document updated',actor:a.updatedBy,timestamp:blocks.get(e.blockNumber)!,txHash:e.transactionHash,detail:`CID: ${a.cid}`}: {kind:'burned',label:Number(a.finalStatus)===1?'Dispensed':'Destroyed',actor:a.lastOwner,timestamp:blocks.get(e.blockNumber)!,txHash:e.transactionHash,detail:'NFT burned; history remains on-chain.'});
 }
 return items.sort((a,b)=>a.timestamp-b.timestamp);
}
export async function registerMedicine(data:{gtin:string;batchNumber:string;medicineName:string;manufactureDate:string;expiryDate:string;metadataCID:string}):Promise<TransactionResponse>{
 const c=await writeContract();const manufacture=Math.floor(new Date(data.manufactureDate).getTime()/1000);const expiry=Math.floor(new Date(data.expiryDate).getTime()/1000);
 if(!data.gtin.trim()||!data.batchNumber.trim()||!data.medicineName.trim()||!data.metadataCID.trim())throw new Error('Complete all required fields.');
 if(!Number.isFinite(manufacture)||!Number.isFinite(expiry)||manufacture>Date.now()/1000||expiry<=Date.now()/1000||expiry<=manufacture)throw new Error('Manufacture and expiry dates are invalid.');
 await c.registerMedicine.staticCall(data.gtin.trim(),data.batchNumber.trim(),data.medicineName.trim(),manufacture,expiry,data.metadataCID.trim());
 return c.registerMedicine(data.gtin.trim(),data.batchNumber.trim(),data.medicineName.trim(),manufacture,expiry,data.metadataCID.trim());
}
const b64=(a:Uint8Array)=>btoa(String.fromCharCode(...a));
export async function encryptPrice(price:string,secret:string):Promise<string>{
 if(!price.trim()||!secret)throw new Error('Enter a price and encryption passphrase.');
 const salt=crypto.getRandomValues(new Uint8Array(16)),nonce=crypto.getRandomValues(new Uint8Array(12));
 const base=await crypto.subtle.importKey('raw',new Uint8Array(toUtf8Bytes(secret)).buffer,'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:salt.buffer as ArrayBuffer,iterations:250000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['encrypt']);
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce.buffer as ArrayBuffer},key,new Uint8Array(toUtf8Bytes(price)).buffer));
 const envelope=JSON.stringify({v:1,alg:'AES-256-GCM',kdf:'PBKDF2-SHA256',iterations:250000,salt:b64(salt),nonce:b64(nonce),ciphertext:b64(ciphertext)});
 const bytes=toUtf8Bytes(envelope);if(bytes.length>1024)throw new Error('Encrypted price is too large for the contract.');
 return '0x'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function transferBatch(tokenId:string,recipient:string,price:string,secret:string):Promise<TransactionResponse>{
 if(!isAddress(recipient))throw new Error('Recipient wallet address is invalid.');
 const c=await writeContract();const signer=await new BrowserProvider(window.ethereum!).getSigner();if(getAddress(await signer.getAddress())===getAddress(recipient))throw new Error('Recipient must be another wallet.');
 const bytes=await encryptPrice(price,secret);await c.transferOwnership.staticCall(BigInt(tokenId),recipient,bytes);
 return c.transferOwnership(BigInt(tokenId),recipient,bytes);
}
export async function burnBatch(tokenId:string,finalStatus:1|2):Promise<TransactionResponse>{const c=await writeContract();await c.burnToken.staticCall(BigInt(tokenId),finalStatus);return c.burnToken(BigInt(tokenId),finalStatus);}
export async function setDocument(tokenId:string,kind:0|1|2,cid:string):Promise<TransactionResponse>{if(!cid.trim())throw new Error('Enter a document CID.');const c=await writeContract();await c.setDocumentCID.staticCall(BigInt(tokenId),kind,cid.trim());return c.setDocumentCID(BigInt(tokenId),kind,cid.trim());}
export async function getDocuments(tokenId:string){const c=readContract();return Promise.all([0,1,2].map(async kind=>{const d=await c.getDocument(BigInt(tokenId),kind);return {kind,cid:String(d.cid),updatedBy:String(d.updatedBy)};}));}
export async function decryptLatestPrice(tokenId:string,wallet:string,secret:string):Promise<string>{
 if(!secret)throw new Error('Enter the passphrase shared for this transfer.');
 const c=readContract();const events=await c.queryFilter(c.filters.CustodyTransferred(BigInt(tokenId)),START,'latest');const latest=events.at(-1);
 if(!latest)throw new Error('No transfer price is recorded for this batch.');
 const parsed=c.interface.parseLog({topics:[...latest.topics],data:latest.data});if(!parsed)throw new Error('Could not decode the transfer event.');
 if(getAddress(wallet)!==getAddress(parsed.args.from)&&getAddress(wallet)!==getAddress(parsed.args.to))throw new Error('This wallet did not participate in the latest transfer.');
 const envelope=JSON.parse(toUtf8String(getBytes(parsed.args.encryptedPrice))) as {v:number;alg:string;kdf:string;iterations:number;salt:string;nonce:string;ciphertext:string};
 if(envelope.v!==1||envelope.alg!=='AES-256-GCM'||envelope.kdf!=='PBKDF2-SHA256'||envelope.iterations!==250000)throw new Error('Unsupported encryption envelope.');
 const binary=(v:string)=>Uint8Array.from(atob(v),c=>c.charCodeAt(0));const salt=binary(envelope.salt),nonce=binary(envelope.nonce),ciphertext=binary(envelope.ciphertext);
 const base=await crypto.subtle.importKey('raw',new Uint8Array(toUtf8Bytes(secret)).buffer,'PBKDF2',false,['deriveKey']);
 const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt:salt.buffer as ArrayBuffer,iterations:250000,hash:'SHA-256'},base,{name:'AES-GCM',length:256},false,['decrypt']);
 try{return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:nonce.buffer as ArrayBuffer},key,ciphertext.buffer as ArrayBuffer));}
 catch{throw new Error('Decryption failed. Check the passphrase or ciphertext.');}
}
export const isLiveReady=()=>configured&&(Boolean(RPC)||Boolean(window.ethereum));

import type { Batch, HistoryItem, Role } from '../types';
const maker='0x3F4a8D2e1B9C0f7A6E5d4C3b2A1f0E9d8C7b9C2b';
const distributor='0x7D2eF4A1b9C8d5E0f3A2b1C9d8E7f6A5b4A5F1';
const pharmacy='0x9C2bA1f0E9d8C7b9C2b3F4a8D2e1B9C0f7A6E5d';
const base=(tokenId:string,batchNumber:string,medicineName:string,gtin:string,expiryDate:number,stage:number,lifecycle:number,verification:number,owner:string):Batch=>({tokenId,batchNumber,medicineName,gtin,expiryDate,stage,lifecycle,verification,owner,manufacturer:maker,manufactureDate:1720000000,registeredAt:1720000000,metadataCID:'bafybeigdyrzt5sfp7udm7hu76uh7y26nfzyhk7vjml7nt6xk6cu7sg4zmi',status:lifecycle===1?'consumed':lifecycle===2?'destroyed':verification===2?'expired':stage===0?'registered':stage===1?'in-transit':'at-dispenser'});
export const previewBatches:Batch[]=[
  base('142','MED-2024-00142','Amoxicillin 500mg','03459876012345',1802908800,1,0,1,distributor),
  base('139','MED-2024-00139','Paracetamol 650mg','03459876012339',1793145600,2,1,3,pharmacy),
  base('135','MED-2024-00135','Metformin 850mg','03459876012335',1792800000,0,0,1,maker),
  base('128','MED-2024-00128','Atorvastatin 20mg','03459876012328',1791331200,1,0,2,distributor),
  base('121','MED-2024-00121','Lisinopril 10mg','03459876012321',1801267200,2,0,1,pharmacy),
  base('117','MED-2024-00117','Bisoprolol 2.5mg','03459876012317',1800748800,0,0,1,maker)
];
export const previewHistory=(b:Batch):HistoryItem[]=>{
 const steps:HistoryItem[]=[{kind:'registered',label:'Manufacturer',actor:maker,timestamp:1720000000,txHash:'0xa1b2c3d4',detail:`Batch registered · Lot ${b.batchNumber}, expires ${new Date(b.expiryDate*1000).toLocaleDateString()}`}];
 if(b.stage>=1)steps.push({kind:'transferred',label:'Distributor',actor:maker,to:distributor,timestamp:1730540000,txHash:'0x3cd5f456',detail:'Ownership transferred to distributor. Encrypted transaction data recorded on-chain.'});
 if(b.stage>=2)steps.push({kind:'transferred',label:'Pharmacy',actor:distributor,to:pharmacy,timestamp:1731000000,txHash:'0x4dd9a321',detail:'Received by dispensing organization.'});
 if(b.lifecycle)steps.push({kind:'burned',label:b.lifecycle===1?'Dispensed':'Destroyed',actor:pharmacy,timestamp:1731100000,txHash:'0x55ac903e',detail:'Batch lifecycle finalized and NFT burned.'});
 return steps;
};
export const previewWallet=(role:Role):{address:string;organization:string}=>({address:role==='MANUFACTURER'?maker:role==='DISTRIBUTOR'?distributor:role==='PHARMACY'?pharmacy:'0x2A6f4cD1E6b7A8f0C9d2E3f4A5b6C7d8E9f08E6d',organization:role==='MANUFACTURER'?'Hà Nội Pharma Co.':role==='DISTRIBUTOR'?'Northern Health Distribution':role==='PHARMACY'?'Central Care Pharmacy':'Read-only inspector'});

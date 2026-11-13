import { useState } from 'react';
import { decryptLatestPrice } from '../services/chain';
export default function PriceAccess({tokenId,wallet}:{tokenId:string;wallet:string}){
 const [secret,setSecret]=useState(''),[price,setPrice]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function decrypt(){setBusy(true);setError('');setPrice('');try{setPrice(await decryptLatestPrice(tokenId,wallet,secret))}catch(e){setError(String((e as Error).message||e))}finally{setBusy(false)}}
 return <details className="price-access"><summary>Decrypt latest transfer price</summary><p>Available to the sending or receiving wallet with the shared passphrase.</p><input type="password" autoComplete="off" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="Shared AES passphrase" aria-label="Shared AES passphrase"/><button className="button secondary full" onClick={()=>void decrypt()} disabled={busy||!secret}>{busy?'Decrypting…':'Decrypt price'}</button>{price&&<div className="price-value">Unit price: {price} USD</div>}{error&&<div className="price-error">{error}</div>}</details>;
}

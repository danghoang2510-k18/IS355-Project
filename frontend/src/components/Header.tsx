import type { Role } from '../types';
import { Brand, WalletBadge } from './Ui';
export type Page='trace'|'scan'|'manage';
export default function Header({page,setPage,address,role,preview,disconnect}:{page:Page;setPage:(p:Page)=>void;address:string;role:Role;preview:boolean;disconnect:()=>void}){return <header className="topbar"><Brand/><nav aria-label="Main navigation"><button className={page==='trace'?'selected':''} onClick={()=>setPage('trace')}>Track &amp; Trace</button><button className={page==='scan'?'selected':''} onClick={()=>setPage('scan')}>Scan QR</button><button className={page==='manage'?'selected':''} onClick={()=>setPage('manage')}>Manage</button></nav><WalletBadge address={address} role={role} preview={preview} onClick={disconnect}/></header>;}

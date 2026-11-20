import { useState } from "react";
import { ApiError } from "../services/api";
import { decryptTransferPrice } from "../services/chain";

export default function PriceAccess({tokenId, wallet, txHash}: {
  tokenId: string; wallet: string; txHash: string;
}) {
  const [secret, setSecret] = useState("");
  const [legacy, setLegacy] = useState(false);
  const [price, setPrice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function decrypt() {
    setBusy(true);
    setError("");
    setPrice("");
    try {
      setPrice(await decryptTransferPrice(tokenId, txHash, wallet, legacy ? secret : undefined));
      setSecret("");
    } catch (e) {
      if (e instanceof ApiError && e.code === "UNSUPPORTED_PRICE_FORMAT") {
        setLegacy(true);
        setError("This older transfer requires its original shared passphrase.");
      } else setError(String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }
  return <details className="price-access"><summary>Transfer price</summary>
    {legacy && <input type="password" autoComplete="off" value={secret}
      onChange={e => setSecret(e.target.value)} aria-label="Original transfer passphrase" />}
    <button className="button secondary full" onClick={() => void decrypt()} disabled={busy || (legacy && !secret)}>
      {busy ? "Decrypting…" : "Decrypt price"}
    </button>
    {price && <div className="price-value">Unit price: {price} USD</div>}
    {error && <div className="price-error">{error}</div>}
  </details>;
}

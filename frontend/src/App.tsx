import { useCallback, useEffect, useState } from "react";
import type { TransactionResponse } from "ethers";
import Header, { type Page } from "./components/Header";
import { TransactionModal } from "./components/Ui";
import ConnectPage from "./pages/ConnectPage";
import TracePage from "./pages/TracePage";
import ScanPage from "./pages/ScanPage";
import ManagePage from "./pages/ManagePage";
import {
  connectWallet,
  isLiveReady,
  listBatches,
  publicReadReady,
  resolveBatch,
} from "./services/chain";
import type { Batch, TxState, WalletState } from "./types";

export default function App() {
  const [wallet, setWallet] = useState<WalletState | null>(null),
    [pendingWallet, setPendingWallet] = useState<WalletState | null>(null),
    [page, setPage] = useState<Page>("trace"),
    [batches, setBatches] = useState<Batch[]>([]),
    [selected, setSelected] = useState(""),
    [scanInitial, setScanInitial] = useState(""),
    [tx, setTx] = useState<TxState | null>(null),
    [recent, setRecent] = useState<
      { title: string; hash: string; status: string }[]
    >([]),
    [connectError, setConnectError] = useState(""),
    [connecting, setConnecting] = useState(false),
    [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    if (!isLiveReady()) return;
    setLoading(true);
    try {
      const data = await listBatches();
      setBatches(data);
      setSelected((old) =>
        data.some((b) => b.tokenId === old) ? old : data[0]?.tokenId || "",
      );
    } catch (e) {
      setConnectError(
        `Could not read Sepolia: ${String((e as Error).message || e)}`,
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (wallet) {
      void refresh();
    }
  }, [wallet?.address, refresh]);

  useEffect(() => {
    if (!wallet?.address || !window.ethereum?.on) return;

    const resetForWalletChange = () => {
      setWallet(null);
      setPendingWallet(null);
      setBatches([]);
      setSelected("");
      setRecent([]);
      setPage("trace");

      setConnectError(
        "Your MetaMask account or network changed. Reconnect your wallet to refresh the on-chain role.",
      );
    };

    window.ethereum.on("accountsChanged", resetForWalletChange);
    window.ethereum.on("chainChanged", resetForWalletChange);

    return () => {
      window.ethereum?.removeListener?.(
        "accountsChanged",
        resetForWalletChange,
      );

      window.ethereum?.removeListener?.("chainChanged", resetForWalletChange);
    };
  }, [wallet?.address]);
  async function connect() {
    setConnectError("");
    setConnecting(true);
    try {
      setPendingWallet(await connectWallet());
    } catch (e) {
      setConnectError(String((e as Error).message || e));
    } finally {
      setConnecting(false);
    }
  }
  function continueWithWallet() {
    if (!pendingWallet) return;

    setBatches([]);
    setSelected("");
    setWallet({ ...pendingWallet, preview: false });
    setPendingWallet(null);
    setConnectError("");
    setPage("trace");
  }
  function browsePublic() {
    if (!publicReadReady) return;

    setConnectError("");
    setBatches([]);
    setSelected("");
    setRecent([]);

    setWallet({
      address: "",
      role: "NONE",
      organization: "Public viewer",
      balance: "—",
      preview: false,
    });

    setPage("trace");
  }

  async function runTx(
    title: string,
    send: () => Promise<TransactionResponse>,
  ) {
    setTx({ phase: "signing", title });
    try {
      const response = await send();
      setTx({ phase: "pending", title, hash: response.hash });
      const receipt = await response.wait();
      if (!receipt || receipt.status !== 1)
        throw new Error("Transaction reverted or was not confirmed.");
      setTx({ phase: "success", title, hash: response.hash });
      setRecent((old) =>
        [{ title, hash: response.hash, status: "Confirmed" }, ...old].slice(
          0,
          10,
        ),
      );
      await refresh();
    } catch (e) {
      const err = e as Error & { shortMessage?: string };
      const message = String(err.shortMessage || err.message || e);
      setTx({ phase: "failed", title, error: message });
      throw e;
    }
  }
  async function verify(value: string): Promise<Batch | null> {
    try {
      return await resolveBatch(value, batches);
    } catch (e) {
      const message = String((e as Error).message || e);

      if (
        message.includes("No matching batch") ||
        message.includes("UnknownBatch")
      ) {
        return null;
      }

      throw e;
    }
  }
  function openVerify(value: string) {
    setScanInitial(value);
    setPage("scan");
  }
  if (!wallet)
    return (
      <ConnectPage
        connect={connect}
        browsePublic={publicReadReady ? browsePublic : undefined}
        selected={pendingWallet}
        onContinue={continueWithWallet}
        error={connectError}
        busy={connecting}
      />
    );
  return (
    <div className="app-shell">
      <Header
        page={page}
        setPage={setPage}
        address={wallet.address}
        role={wallet.role}
        preview={false}
        disconnect={() => {
          setWallet(null);
          setPendingWallet(null);
        }}
      />

      {connectError && (
        <div className="global-error" role="alert">
          {connectError}
          <button onClick={() => setConnectError("")}>×</button>
        </div>
      )}
      {loading && (
        <div className="loading-strip">
          Refreshing confirmed Sepolia records…
        </div>
      )}
      {page === "trace" ? (
        <TracePage
          batches={batches}
          selected={selected}
          setSelected={setSelected}
          wallet={wallet}
          onVerify={openVerify}
          onScan={() => setPage("scan")}
          onManage={() => setPage("manage")}
        />
      ) : page === "scan" ? (
        <ScanPage
          registry={batches}
          initial={scanInitial}
          onVerify={verify}
          onTrace={(id) => {
            setSelected(id);
            setPage("trace");
          }}
        />
      ) : (
        <ManagePage
          wallet={wallet}
          batches={batches}
          runTx={runTx}
          recent={recent}
        />
      )}
      <TransactionModal tx={tx} onClose={() => setTx(null)} />
    </div>
  );
}

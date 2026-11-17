import { useEffect, useState } from "react";
import type { Batch, HistoryItem, WalletState } from "../types";
import {
  configured,
  explorer,
  getDocuments,
  getHistory,
  short,
} from "../services/chain";
import { Icon, StatusPill } from "../components/Ui";
import PriceAccess from "../components/PriceAccess";

const date = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const label = (batch: Batch) =>
  batch.status === "in-transit"
    ? "In transit"
    : batch.status === "at-dispenser"
      ? "At dispenser"
      : batch.status === "registered"
        ? "Registered"
        : batch.status === "consumed"
          ? "Dispensed"
          : batch.status === "destroyed"
            ? "Destroyed"
            : batch.status === "expired"
              ? "Expired"
              : "Invalid owner";

type TracePageProps = {
  batches: Batch[];
  selected: string;
  setSelected: (value: string) => void;
  wallet: WalletState;
  onVerify: (value: string) => void;
  onScan: () => void;
  onManage: () => void;
};

export default function TracePage({
  batches,
  selected,
  setSelected,
  wallet,
  onVerify,
  onScan,
  onManage,
}: TracePageProps) {
  const [search, setSearch] = useState("");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [docs, setDocs] = useState<
    { kind: number; cid: string; updatedBy: string }[]
  >([]);
  const [historyError, setHistoryError] = useState("");

  const batch = batches.find((item) => item.tokenId === selected) || batches[0];
  const tokenId = batch?.tokenId;

  // Always read custody history and document references from Sepolia.
  // The cancellation flag prevents an old request from updating a newly selected batch.
  useEffect(() => {
    let canceled = false;

    if (!tokenId) {
      setHistory([]);
      setDocs([]);
      setHistoryError("");
      return () => {
        canceled = true;
      };
    }

    setHistory([]);
    setDocs([]);
    setHistoryError("");

    void getHistory(tokenId)
      .then((items) => {
        if (!canceled) setHistory(items);
      })
      .catch((error: unknown) => {
        if (!canceled) {
          setHistoryError(String((error as Error).message || error));
        }
      });

    void getDocuments(tokenId)
      .then((items) => {
        if (!canceled) setDocs(items);
      })
      .catch(() => {
        if (!canceled) setDocs([]);
      });

    return () => {
      canceled = true;
    };
  }, [tokenId]);

  const filtered = batches.filter((item) =>
    `${item.batchNumber} ${item.medicineName} ${item.tokenId}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  const progress = batch ? (batch.lifecycle ? 4 : batch.stage + 1) : 0;

  return (
    <div className="trace-layout">
      <aside className="batch-rail">
        <div className="rail-title">Batch registry</div>

        <div className="rail-search">
          <Icon name="d698b" size={15} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search batch ID..."
            aria-label="Search batches"
          />
        </div>

        <div className="batch-list">
          {filtered.map((item) => (
            <button
              className={`batch-list-item ${batch?.tokenId === item.tokenId ? "active" : ""}`}
              key={item.tokenId}
              onClick={() => setSelected(item.tokenId)}
            >
              <span className="batch-list-top">
                <strong>{item.batchNumber}</strong>
                <i className={`status-dot ${item.status}`} />
              </span>
              <span>{item.medicineName}</span>
              <span className="batch-list-bottom">
                <em className={item.status}>{label(item)}</em>
                <small>{date(item.registeredAt)}</small>
              </span>
            </button>
          ))}

          {filtered.length === 0 && (
            <p className="empty-hint">No matching batches</p>
          )}
        </div>

        <div className="rail-footer">
          <span className="dot" />
          <span>
            Live from Sepolia
            <small>Confirmed on-chain data</small>
          </span>
        </div>
      </aside>

      <main className="trace-main">
        {batch ? (
          <>
            <div className="trace-heading">
              <div>
                <span className="eyebrow accent">{batch.batchNumber}</span>
                <h1>{batch.medicineName}</h1>
                <p>
                  GTIN {batch.gtin} · Lot {batch.batchNumber}
                </p>
              </div>

              <div className="heading-actions">
                <StatusPill status={label(batch)} />
                <button
                  className="icon-button"
                  onClick={onScan}
                  title="Scan QR"
                  aria-label="Scan QR"
                >
                  <Icon name="3e55c" size={16} />
                </button>
                <a
                  className="icon-button"
                  href={explorer(batch.manufacturer)}
                  target="_blank"
                  rel="noreferrer"
                  title="View manufacturer on Etherscan"
                  aria-label="View manufacturer on Etherscan"
                >
                  <Icon name="77f65" size={16} />
                </a>
              </div>
            </div>

            <div className="trace-scroll">
              <div className={`journey-alert ${batch.status}`}>
                <span className="journey-alert-icon">
                  <Icon
                    name={
                      batch.status === "expired"
                        ? "79d57"
                        : batch.status === "consumed"
                          ? "17427"
                          : "70a42"
                    }
                    size={20}
                  />
                </span>
                <span>
                  <strong>{label(batch)}</strong>
                  <small>
                    {batch.status === "expired"
                      ? "The batch is past its expiry date. It cannot be transferred or consumed."
                      : batch.lifecycle
                        ? "The NFT has been burned. Its on-chain history remains available."
                        : batch.stage === 0
                          ? "Registered by the manufacturer and awaiting distributor handoff."
                          : batch.stage === 1
                            ? "Currently held by a distributor en route to a verified dispenser."
                            : "Held by a pharmacy or hospital."}
                  </small>
                </span>
              </div>

              <div className="timeline-caption">
                <span>CHAIN OF CUSTODY</span>
                <span>
                  {progress} of 4 steps · {label(batch)}
                </span>
              </div>

              <div className="timeline">
                {history.map((item, index) => (
                  <div
                    className={`timeline-step ${item.kind}`}
                    key={`${item.txHash}-${index}`}
                  >
                    <span className="timeline-icon">
                      <Icon
                        name={
                          item.kind === "registered"
                            ? "7c194"
                            : item.kind === "transferred"
                              ? "70a42"
                              : item.kind === "burned"
                                ? "2e43c"
                                : "e712a"
                        }
                        size={18}
                      />
                    </span>

                    <div className="timeline-card">
                      <div className="timeline-card-head">
                        <strong>{item.label}</strong>
                        <StatusPill
                          status={
                            item.kind === "registered"
                              ? "Registered"
                              : item.kind === "burned"
                                ? "Finalized"
                                : index === history.length - 1
                                  ? "Current custody"
                                  : "Transferred"
                          }
                        />
                      </div>

                      <small>
                        {date(item.timestamp)} ·{" "}
                        {new Date(item.timestamp * 1000).toLocaleTimeString(
                          "en-US",
                          { hour: "2-digit", minute: "2-digit" },
                        )}
                      </small>

                      <div className="code-row">
                        {short(item.to || item.actor)}
                        <button
                          onClick={() =>
                            void navigator.clipboard.writeText(
                              item.to || item.actor,
                            )
                          }
                          title="Copy address"
                          aria-label="Copy address"
                        >
                          <Icon name="bb2ee" size={13} />
                        </button>
                      </div>

                      <div className="code-row">
                        Tx: {short(item.txHash)}
                        <a
                          href={explorer(item.txHash)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label="View transaction on Etherscan"
                        >
                          <Icon name="5a4e7" size={13} />
                        </a>
                      </div>

                      {item.detail && <p>{item.detail}</p>}
                    </div>
                  </div>
                ))}

                {historyError && (
                  <div className="notice red">{historyError}</div>
                )}

                {!batch.lifecycle &&
                  Array.from(
                    { length: Math.max(0, 3 - batch.stage) },
                    (_, index) => (
                      <div className="timeline-step future" key={index}>
                        <span className="timeline-icon">
                          <Icon
                            name={index === 0 ? "84adb" : "b74a2"}
                            size={18}
                          />
                        </span>
                        <div>
                          <strong>
                            {batch.stage + index === 0
                              ? "Awaiting distributor"
                              : batch.stage + index === 1
                                ? "Awaiting pharmacy / hospital"
                                : "Awaiting dispense"}
                          </strong>
                          <small>
                            Next event will appear after a confirmed
                            transaction.
                          </small>
                        </div>
                      </div>
                    ),
                  )}
              </div>

              {docs.some((item) => item.cid) && (
                <div className="documents-card">
                  <h3>Document references</h3>
                  {docs
                    .filter((item) => item.cid)
                    .map((item) => (
                      <div key={item.kind}>
                        <span>
                          {[
                            "Origin certificate",
                            "Quality certificate",
                            "Chemical metadata",
                          ][item.kind] || `Document type ${item.kind}`}
                        </span>
                        <a
                          href={`https://ipfs.io/ipfs/${encodeURIComponent(item.cid)}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {short(item.cid)} ↗
                        </a>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="center-empty">
            No batches to display.
            {wallet.role === "MANUFACTURER" && (
              <button className="button primary" onClick={onManage}>
                Register a batch
              </button>
            )}
          </div>
        )}
      </main>

      <aside className="trace-details">
        {batch && (
          <>
            <div className="detail-section">
              <h3>Batch info</h3>
              {[
                ["Drug name", batch.medicineName],
                ["GTIN", batch.gtin],
                ["Lot number", batch.batchNumber],
                ["Expires", date(batch.expiryDate)],
                ["Manufacturer", short(batch.manufacturer)],
              ].map(([key, value]) => (
                <div className="detail-row" key={key}>
                  <span>{key}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>

            <div className="detail-section">
              <h3>Journey progress</h3>
              <div className="progress-track">
                {[0, 1, 2, 3].map((index) => (
                  <span
                    className={index < progress ? "done" : ""}
                    key={index}
                  />
                ))}
              </div>
              <div className="progress-labels">
                <span>Registered</span>
                <span>Distributor</span>
                <span>Pharmacy</span>
                <span>Dispensed</span>
              </div>
            </div>

            <div className="detail-section">
              <h3>On-chain data</h3>
              {[
                [
                  "Contract",
                  configured
                    ? short(import.meta.env.VITE_CONTRACT_ADDRESS)
                    : "Not configured",
                ],
                ["Network", "Sepolia (11155111)"],
                ["Token ID (NFT)", `#${batch.tokenId}`],
                [
                  "Owner / Outcome",
                  batch.lifecycle ? label(batch) : short(batch.owner),
                ],
                ["Batch status", label(batch)],
                ["Price data", "AES-256 encrypted"],
              ].map(([key, value]) => (
                <div className="detail-row" key={key}>
                  <span>{key}</span>
                  <strong>{value}</strong>
                </div>
              ))}

              <button
                className="button outline full verify-button"
                onClick={() => onVerify(batch.tokenId)}
              >
                <Icon name="e712a" size={17} /> Verify authenticity
              </button>

              {Boolean(wallet.address) && (
                <PriceAccess tokenId={batch.tokenId} wallet={wallet.address} />
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

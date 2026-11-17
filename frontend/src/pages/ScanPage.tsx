import { useEffect, useRef, useState } from "react";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import type { Batch } from "../types";
import { explorer, parseScannedCode, short } from "../services/chain";
import { Icon } from "../components/Ui";

const date = (seconds: number) =>
  new Date(seconds * 1000).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

type ScanPageProps = {
  registry: Batch[];
  initial: string;
  onVerify: (value: string) => Promise<Batch | null>;
  onTrace: (tokenId: string) => void;
};

export default function ScanPage({
  registry,
  initial,
  onVerify,
  onTrace,
}: ScanPageProps) {
  const [mode, setMode] = useState<"manual" | "camera">("manual");
  const [input, setInput] = useState(initial);
  const [result, setResult] = useState<Batch | null>(null);
  const [queried, setQueried] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const video = useRef<HTMLVideoElement>(null);
  const verifyRef = useRef<(value: string) => Promise<void>>(async () => {});

  useEffect(() => {
    setInput(initial);
  }, [initial]);

  async function verify(value: string) {
    const rawValue = value.trim();
    if (!rawValue) return;

    setBusy(true);
    setError("");
    setResult(null);
    setQueried("");

    try {
      // Extract the token ID / batch identifier from the QR payload.
      // URL payloads are checked against the configured Sepolia contract.
      const identifier = parseScannedCode(rawValue);
      setInput(identifier);

      const batch = await onVerify(identifier);
      setQueried(identifier);
      setResult(batch);
    } catch (verificationError) {
      setError(
        String((verificationError as Error).message || verificationError),
      );
    } finally {
      setBusy(false);
    }
  }

  // Keep the scanner callback pointed at the latest verification handler
  // without restarting the camera whenever parent state changes.
  verifyRef.current = verify;

  useEffect(() => {
    if (mode !== "camera" || !video.current) return;

    let active = true;
    let scanHandled = false;
    let controls: IScannerControls | undefined;
    const reader = new BrowserQRCodeReader();

    reader
      .decodeFromVideoDevice(undefined, video.current, (scan) => {
        if (scan && active && !scanHandled) {
          scanHandled = true;
          setMode("manual");
          void verifyRef.current(scan.getText());
        }
      })
      .then((scannerControls) => {
        if (active) {
          controls = scannerControls;
        } else {
          scannerControls.stop();
        }
      })
      .catch((cameraError: unknown) => {
        if (active) {
          setError(
            `Camera unavailable: ${String((cameraError as Error).message || cameraError)}`,
          );
        }
      });

    return () => {
      active = false;
      controls?.stop();
    };
  }, [mode]);

  const status = result?.verification ?? 0;
  const title =
    status === 1
      ? "Authentic product"
      : status === 2
        ? "Batch expired"
        : status === 3
          ? "Batch consumed"
          : status === 4
            ? "Batch destroyed"
            : status === 5
              ? "Invalid owner"
              : "Not found / counterfeit";

  const availableBatches = registry.slice(0, 4);

  return (
    <div className="scan-layout">
      <main className="scan-main">
        <div className="scan-content">
          <div className="scan-title-icon">
            <Icon name="8ee70" size={21} />
          </div>
          <h1>Verify drug authenticity</h1>
          <p>
            Point camera at QR code on drug packaging, or enter batch ID
            manually.
          </p>

          <div className="segmented">
            <button
              className={mode === "camera" ? "active" : ""}
              onClick={() => {
                setError("");
                setMode("camera");
              }}
            >
              <Icon name="f5a06" size={15} /> Camera scan
            </button>
            <button
              className={mode === "manual" ? "active" : ""}
              onClick={() => setMode("manual")}
            >
              <Icon name="0085a" size={15} /> Manual input
            </button>
          </div>

          {mode === "camera" ? (
            <div className="camera-box">
              <video ref={video} autoPlay muted playsInline />
              <div className="scan-corners" />
              <span>
                <span className="dot" /> Scanning…
              </span>
            </div>
          ) : (
            <form
              className="scan-form"
              onSubmit={(event) => {
                event.preventDefault();
                void verify(input);
              }}
            >
              <label>
                Batch ID, GTIN or token ID
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="e.g. MED-2024-00142"
                />
              </label>
              <button
                className="button primary full"
                type="submit"
                disabled={busy || !input.trim()}
              >
                <Icon name="79849" size={16} />
                {busy ? "Querying Sepolia…" : "Verify on-chain"}
              </button>
            </form>
          )}

          {error && <div className="notice red scan-error">{error}</div>}

          <div className="demo-scans">
            <span>Quick verify from the confirmed registry →</span>
            <div>
              {availableBatches.length > 0 ? (
                availableBatches.map((batch) => (
                  <button
                    key={batch.tokenId}
                    onClick={() => {
                      setMode("manual");
                      setInput(batch.batchNumber);
                      void verify(batch.batchNumber);
                    }}
                  >
                    {batch.batchNumber}
                  </button>
                ))
              ) : (
                <p className="empty-hint">
                  No confirmed batches are available yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </main>

      <aside className="scan-result">
        <div className="scan-result-header">
          <strong>Verification result</strong>
          <span>
            <span className="dot" /> Sepolia live
          </span>
        </div>

        {busy ? (
          <div className="result-empty">
            <div className="result-empty-icon loading">◌</div>
            <h2>Querying on-chain record</h2>
            <p>Reading product ID, batch status, owner and custody.</p>
          </div>
        ) : queried ? (
          <div className="result-content">
            <div
              className={`result-banner ${status === 1 ? "good" : status === 2 ? "warn" : "bad"}`}
            >
              <span>{status === 1 ? "✓" : status === 2 ? "⚠" : "×"}</span>
              <div>
                <strong>{title}</strong>
                <small>
                  {status === 1
                    ? "Verified on Sepolia. This batch is registered and currently in valid custody."
                    : status === 2
                      ? "This product exists on-chain but has passed its expiry date. Do not dispense."
                      : status === 3 || status === 4
                        ? "The NFT is finalized; its on-chain history remains available."
                        : status === 5
                          ? "A registered batch has an invalid custody owner."
                          : "No matching record on-chain. This product may be counterfeit or unregistered."}
                </small>
              </div>
            </div>

            <div className="result-eyebrow">DRUG INFO</div>

            {result ? (
              <>
                {[
                  ["Drug name", result.medicineName],
                  ["Batch ID", result.batchNumber],
                  ["GTIN", result.gtin],
                  ["Lot number", result.batchNumber],
                  ["Expires", date(result.expiryDate)],
                  [
                    "Current owner",
                    result.lifecycle ? "None (burned)" : short(result.owner),
                  ],
                  ["Status", title],
                  ["Token ID (NFT)", `#${result.tokenId}`],
                ].map(([key, value]) => (
                  <div className="result-row" key={key}>
                    <span>{key}</span>
                    <strong>{value}</strong>
                  </div>
                ))}

                <button
                  className="button primary full"
                  onClick={() => onTrace(result.tokenId)}
                >
                  View full trace ›
                </button>
                <a
                  className="button secondary full"
                  href={explorer(result.manufacturer)}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Etherscan ↗
                </a>
              </>
            ) : (
              <>
                <div className="result-row">
                  <span>Queried ID</span>
                  <strong>{queried}</strong>
                </div>
                <div className="result-row">
                  <span>Network</span>
                  <strong>Sepolia</strong>
                </div>
                <div className="result-row">
                  <span>Result</span>
                  <strong>No record found</strong>
                </div>
              </>
            )}

            <button
              className="scan-again"
              onClick={() => {
                setQueried("");
                setResult(null);
                setInput("");
                setError("");
              }}
            >
              ⌗ &nbsp; Scan another batch
            </button>

            <p className="verification-caution">
              Blockchain verification confirms the digital batch record, not the
              physical medicine or packaging.
            </p>
          </div>
        ) : (
          <div className="result-empty">
            <div className="result-empty-icon">
              <Icon name="558aa" size={35} />
            </div>
            <h2>Ready to verify</h2>
            <p>
              Scan a QR code or enter a batch ID to verify drug authenticity
              on-chain.
            </p>
            <div className="result-steps">
              <span>
                1&nbsp; Read
                <br /> product ID
              </span>
              <span>
                2&nbsp; Query
                <br /> contract
              </span>
              <span>
                3&nbsp; Verify
                <br /> custody
              </span>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

import type { WalletState } from "../types";
import { Brand, Icon } from "../components/Ui";
import { short } from "../services/chain";

export default function ConnectPage({
  connect,
  browsePublic,
  selected,
  onContinue,
  error,
  busy,
}: {
  connect: () => void;
  browsePublic?: () => void;
  selected: WalletState | null;
  onContinue: () => void;
  error: string;
  busy: boolean;
}) {
  return (
    <div className="connect-layout">
      <section className="connect-hero">
        <div className="hero-glow" />
        <Brand />
        <div className="hero-content">
          <div className="hero-overline">
            <span /> SECURED BY SEPOLIA
          </div>
          <h1>
            Drug provenance,
            <br />
            <em>on-chain</em> and verifiable.
          </h1>
          <p>
            Every batch. Every handoff. Every verification — recorded immutably
            on Sepolia. From factory floor to pharmacy shelf.
          </p>
          <div className="journey-icons">
            {[
              { i: "8d833", l: "Manufacturer" },
              { i: "7a898", l: "Distributor" },
              { i: "87ffb", l: "Pharmacy" },
              { i: "b74a2", l: "Patient" },
            ].map((x, n) => (
              <div className={n === 0 ? "active" : ""} key={x.l}>
                <span>
                  <Icon name={x.i} size={21} />
                </span>
                <small>{x.l}</small>
              </div>
            ))}
          </div>
        </div>
        <div className="hero-footer">
          <div>
            <strong>3</strong>
            <small>Chain participants</small>
          </div>
          <div>
            <strong>Sepolia</strong>
            <small>Test network</small>
          </div>
          <div>
            <strong>ERC-721</strong>
            <small>Token standard</small>
          </div>
        </div>
      </section>
      <section className="connect-panel">
        <span className="network-tag">
          <span className="dot" /> Sepolia Testnet
        </span>
        {selected ? (
          <>
            <div className="connect-intro">
              <div className="intro-icon">
                <Icon name="10ca1" size={30} />
              </div>
              <h2>Wallet ready</h2>
              <p>
                Your Sepolia wallet is connected and its role was read from the
                contract.
              </p>
            </div>
            <div className="selected-wallet-card">
              <span className="dot" />
              <span>
                <small>CONNECTED AS</small>
                <strong>
                  {selected.role === "PHARMACY"
                    ? "Pharmacy / Hospital"
                    : selected.role}
                </strong>
                <small>{selected.organization}</small>
                <code>{short(selected.address)}</code>
              </span>
            </div>
            <button
              className="button primary full metamask"
              onClick={onContinue}
            >
              Continue to dashboard →
            </button>
          </>
        ) : (
          <>
            <div className="connect-intro">
              <div className="intro-icon">
                <Icon name="10ca1" size={30} />
              </div>
              <h2>
                Connect your wallet
                <br />
                to continue
              </h2>
              <p>
                Connect a Sepolia wallet. The role registered on-chain
                determines which operations are available.
              </p>
            </div>
            <button
              className="button primary full metamask"
              onClick={connect}
              disabled={busy}
            >
              {busy ? "Connecting…" : "Connect MetaMask wallet →"}
            </button>
            {browsePublic && (
              <button
                className="button secondary full public-browse"
                onClick={browsePublic}
              >
                Browse public Sepolia records →
              </button>
            )}
          </>
        )}

        {error && <div className="notice red">{error}</div>}
        <div className="connect-bottom">
          <span className="dot muted" />{" "}
          {selected ? "ROLE SELECTED" : "DISCONNECTED"}
        </div>
      </section>
    </div>
  );
}

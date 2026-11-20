import { useEffect, useRef, useState } from "react";
import { getAddress, type TransactionResponse } from "ethers";
import {
  uploadDocument,
  recoverPendingDocument,
  type DocumentType
} from "../services/documents";
import { authenticateWallet } from "../services/wallet";
import {
  createMedicineMetadata,
  createMetadataIdempotencyKey,
  type CreateMedicineMetadataRequest
} from "../services/metadata";
import type { Batch, WalletState } from "../types";
import {
  burnBatch,
  configured,
  explorer,
  registerMedicine,
  resolveBatch,
  setDocument,
  short,
  transferBatch,
  updateParticipant,
} from "../services/chain";
import { Field, Icon } from "../components/Ui";

type Operation = "register" | "transfer" | "dispense" | "documents";
const DOCUMENT_TYPES: DocumentType[] = [
  "CERTIFICATE_OF_ORIGIN",
  "QUALITY_CERTIFICATE",
  "CHEMICAL_METADATA"
];
type DocumentSelection = { id: string; kind: 0 | 1 | 2; visibility: "PUBLIC" | "RESTRICTED" };

function readDocumentSelection(key: string): DocumentSelection {
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || "null");
    if (saved && typeof saved.id === "string" && [0, 1, 2].includes(saved.kind)
        && ["PUBLIC", "RESTRICTED"].includes(saved.visibility)) return saved;
  } catch { /* Storage can be disabled by the browser. */ }
  return { id: "", kind: 0, visibility: "PUBLIC" };
}

export default function ManagePage({
  wallet,
  batches,
  runTx,
  recent,
}: {
  wallet: WalletState;
  batches: Batch[];
  runTx: (
    title: string,
    send: () => Promise<TransactionResponse>,
  ) => Promise<void>;
  recent: { title: string; hash: string; status: string }[];
}) {
  const upstream = wallet.role === "MANUFACTURER" || wallet.role === "DISTRIBUTOR";
  const allowed: Operation[] =
    wallet.role === "MANUFACTURER"
      ? ["register", "transfer", "dispense", "documents"]
      : wallet.role === "DISTRIBUTOR"
        ? ["transfer", "dispense", "documents"]
        : wallet.role === "PHARMACY" || wallet.role === "HOSPITAL"
          ? ["dispense", "documents"]
          : [];
  const [op, setOp] = useState<Operation>(allowed[0] || "register"),
    [error, setError] = useState("");
  const [reg, setReg] = useState({
    gtin: "",
    batchNumber: "",
    medicineName: "",
    manufactureDate: new Date().toISOString().slice(0, 10),
    expiryDate: "",
    metadataCID: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [metadataUploading, setMetadataUploading] = useState(false);
  const metadataRequestRef = useRef<{
    fingerprint: string;
    key: string;
  } | null>(null);
  const storageKey = ["document-selection", 11155111, import.meta.env.VITE_CONTRACT_ADDRESS, wallet.address.toLowerCase()].join(":");
  const [initialSelection] = useState(() => readDocumentSelection(storageKey));
  const [visibility, setVisibility] = useState(initialSelection.visibility);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const documentPicker = useRef<HTMLInputElement>(null);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [documentUploadStatus, setDocumentUploadStatus] = useState<
  "UPLOADED_NOT_LINKED" | "LINKED" | null
  >(null);
  const [transfer, setTransfer] = useState({
    id: "",
    recipient: "",
    price: "",
  });
  const [burn, setBurn] = useState({ id: "", outcome: (upstream ? 2 : 1) as 1 | 2 });
  const [document, setDocumentForm] = useState({
    id: initialSelection.id,
    kind: initialSelection.kind,
    cid: "",
  });
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ id: document.id, kind: document.kind, visibility }));
    } catch { /* Recovery remains available by selecting the batch manually. */ }
  }, [storageKey, document.id, document.kind, visibility]);
  const [participant, setParticipant] = useState({address: "", role: 1, organization: "", active: true});
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  useEffect(() => {
    if (!allowed.includes(op)) setOp(allowed[0] || "register");
  }, [wallet.role]);
  useEffect(() => {
    if (!burn.id) {
      setSelectedBatch(null);
      return;
    }
    const b = batches.find((x) =>
      [x.tokenId, x.batchNumber].includes(burn.id.trim()),
    );
    setSelectedBatch(b || null);
  }, [burn.id, batches]);

async function handleDocumentUpload(recover = false) {
  if (!recover && !documentFile) {
    setError("Vui lòng chọn file chứng từ.");
    return;
  }

  setError("");
  setUploadingDocument(true);

  try {
    const batch = await resolveBatch(document.id, batches);

    const session = await authenticateWallet();

    if (
      getAddress(session.address) !== getAddress(wallet.address)
    ) {
      throw new Error(
        "Ví xác thực Backend không khớp với ví đang dùng trên giao diện."
      );
    }

    const kind = DOCUMENT_TYPES[document.kind];
    const result = recover
      ? await recoverPendingDocument(batch.tokenId, kind, visibility)
      : await uploadDocument(batch.tokenId, kind, documentFile!, visibility);

    setDocumentFile(null);
    if (documentPicker.current) documentPicker.current.value = "";
    setDocumentForm((previous) => ({
      ...previous,
      id: batch.tokenId,
      cid: result.cid
    }));
    setDocumentUploadStatus("UPLOADED_NOT_LINKED");
    } catch (error) {
      setError(String((error as Error).message || error));
    } finally {
      setUploadingDocument(false);
    }
  }
  function updateRegistrationField(
    field: keyof CreateMedicineMetadataRequest,
    value: string
  ) {
    setReg((previous) => ({
      ...previous,
      [field]: value,
      metadataCID: ""
    }));

    metadataRequestRef.current = null;
  }

async function handleGenerateMetadata() {
  if (submitting || metadataUploading) return;

  if (reg.metadataCID.trim()) {
    setError("Đã có Metadata CID. Hãy xóa CID nếu muốn tạo metadata mới.");
    return;
  }

  const payload: CreateMedicineMetadataRequest = {
    gtin: reg.gtin,
    batchNumber: reg.batchNumber,
    medicineName: reg.medicineName,
    manufactureDate: reg.manufactureDate,
    expiryDate: reg.expiryDate
  };

  if (Object.values(payload).some((value) => !value.trim())) {
    setError("Vui lòng nhập đầy đủ thông tin lô thuốc trước khi tạo Metadata.");
    return;
  }

  setError("");
  setMetadataUploading(true);

  try {
    const session = await authenticateWallet();

    if (getAddress(session.address) !== getAddress(wallet.address)) {
      throw new Error("Ví xác thực Backend không khớp với ví đang kết nối.");
    }

    const fingerprint = JSON.stringify(payload);

    if (
      !metadataRequestRef.current ||
      metadataRequestRef.current.fingerprint !== fingerprint
    ) {
      metadataRequestRef.current = {
        fingerprint,
        key: createMetadataIdempotencyKey()
      };
    }

    const result = await createMedicineMetadata(
      payload,
      metadataRequestRef.current.key
    );

      setReg((previous) => ({
        ...previous,
        metadataCID: result.metadataCID
      }));
    } catch (error) {
      setError(String((error as Error).message || error));
    } finally {
      setMetadataUploading(false);
    }
  }

function validateRegistration(): string | null {
  if (!/^[0-9]{14}$/.test(reg.gtin)) {
    return "GTIN must contain exactly 14 digits.";
  }

  if (
    !reg.batchNumber.trim() ||
    reg.batchNumber.trim().length > 64
  ) {
    return "Batch Number must contain 1–64 characters.";
  }

  if (
    !reg.medicineName.trim() ||
    reg.medicineName.trim().length > 120
  ) {
    return "Drug Name must contain 1–120 characters.";
  }

  const validDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

    const parsed = new Date(`${value}T00:00:00Z`);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  };

  if (
    !validDate(reg.manufactureDate) ||
    !validDate(reg.expiryDate)
  ) {
    return "Invalid manufacture or expiry date.";
  }

  const today = new Date().toISOString().slice(0, 10);

  if (
    reg.manufactureDate > today ||
    reg.expiryDate <= today ||
    reg.expiryDate <= reg.manufactureDate
  ) {
    return "Manufacture or expiry date is not valid.";
  }

  if (!reg.metadataCID.trim()) {
    return "NFT Metadata CID is required.";
  }

  return null;
}

async function handleRegister() {
  if (submitting || metadataUploading) return;

  const validationError = validateRegistration();

  if (validationError) {
    setError(validationError);
    return;
  }

  const confirmed = await submit(
    "Register Medicine",
    () => registerMedicine(reg)
  );

  if (!confirmed) return;

  setReg({
    gtin: "",
    batchNumber: "",
    medicineName: "",
    manufactureDate: new Date().toISOString().slice(0, 10),
    expiryDate: "",
    metadataCID: ""
  });

  metadataRequestRef.current = null;
}

  async function submit(
    title: string,
    send: () => Promise<TransactionResponse>,
  ): Promise<boolean> {
    setError("");

    if (!configured) {
      setError(
        "Live mode is not ready. Please configure the deployed Sepolia contract.",
      );
      return false;
    }

    setSubmitting(true);

    try {
      await runTx(title, send);
      return true;
    } catch (e) {
      setError(String((e as Error).message || e));
      return false;
    } finally {
      setSubmitting(false);
    }
  }
  const hint =
    wallet.role === "NONE"
      ? "This wallet has no participant write role on the contract."
      : "This action sends a transaction to Sepolia. Confirm it in MetaMask.";
  return (
    <div className="manage-layout">
      <aside className="manage-rail">
        <div className="rail-heading">OPERATIONS</div>
        <div className="operation-list">
          {allowed.length ? (
            allowed.map((x) => (
              <button
                className={op === x ? "active" : ""}
                key={x}
                onClick={() => setOp(x)}
              >
                <span className="operation-icon">
                  <Icon
                    name={
                      x === "register"
                        ? "afa49"
                        : x === "transfer"
                          ? "8153d"
                          : x === "dispense"
                            ? "eadcb"
                            : "e712a"
                    }
                    size={17}
                  />
                </span>
                <span>
                  <strong>
                    {x === "register"
                      ? "Register"
                      : x === "transfer"
                        ? "Transfer"
                        : x === "dispense"
                          ? (upstream ? "Destroy" : "Dispense")
                          : "Documents"}
                  </strong>
                  <small>
                    {x === "register"
                      ? "Manufacturer only"
                      : x === "transfer"
                        ? "Manufacturer / Distributor"
                        : x === "dispense"
                          ? (upstream ? "Current owner" : "Pharmacy / Hospital")
                          : "Current owner"}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <div className="rail-message">
              {wallet.isAdmin ? "Admin access" : "Read-only access. Use Track & Trace or Scan QR."}
            </div>
          )}
        </div>
        <div className="role-card">
          <div className="rail-heading">YOUR ROLE</div>
          <strong className="role-name">
            <Icon name="1fdc1" size={17} />
            {wallet.role}
          </strong>
          {[
            ["Network", "Sepolia"],
            ["Wallet", short(wallet.address)],
            ["Balance", `${wallet.balance} ETH`],
            ["Gas (est.)", "RPC estimate"],
          ].map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <b>{v}</b>
            </div>
          ))}
        </div>
      </aside>
      <main className="manage-main">
        <div className="manage-inner">
          {wallet.isAdmin && <form onSubmit={event => {
            event.preventDefault();
            void submit(participant.active ? "Grant participant role" : "Deactivate participant",
              () => updateParticipant(participant.address, participant.role, participant.organization, participant.active));
          }}>
            <h1>Participant administration</h1>
            <Field label="Participant wallet"><input required value={participant.address}
              onChange={e => setParticipant({...participant, address: e.target.value})}/></Field>
            <Field label="Participant role"><select value={participant.role}
              onChange={e => setParticipant({...participant, role: Number(e.target.value)})}>
              {["Manufacturer", "Distributor", "Pharmacy", "Hospital"].map((role, i) =>
                <option key={role} value={i + 1}>{role}</option>)}
            </select></Field>
            <Field label="Organization"><input required={participant.active} value={participant.organization}
              onChange={e => setParticipant({...participant, organization: e.target.value})}/></Field>
            <Field label="Access"><select value={participant.active ? "active" : "inactive"}
              onChange={e => setParticipant({...participant, active: e.target.value === "active"})}>
              <option value="active">Active</option><option value="inactive">Inactive</option>
            </select></Field>
            <button className="button primary full" disabled={submitting}>Review participant update in wallet</button>
            {error && !allowed.length && <p role="alert">{error}</p>}
          </form>}
          {allowed.length === 0 ? (wallet.isAdmin ? null :
            <div className="read-only">
              <h1>Read-only account</h1>
              <p>
                This wallet is not registered for medicine operations. Use the
                verification and trace views, or ask the admin to assign an
                on-chain role.
              </p>
            </div>
          ) : (
            <>
              <div className="eyebrow-badge">ON-CHAIN WRITE</div>
              <h1>
                {op === "register"
                  ? "Register Medicine"
                  : op === "transfer"
                    ? "Transfer Ownership"
                    : op === "dispense"
                      ? (upstream ? "Destroy Medicine" : "Dispense Medicine")
                      : "Document CID"}
              </h1>
              <p className="manage-description">
                {op === "register" ? (
                  <>
                    Create a new medicine batch on Sepolia — calls{" "}
                    <code>registerMedicine()</code> on the smart contract.
                  </>
                ) : op === "transfer" ? (
                  <>
                    Move batch custody to the next verified supply-chain
                    participant — calls <code>transferOwnership()</code> on the
                    smart contract.
                  </>
                ) : op === "dispense" ? (
                  <>
                    Record the final outcome and remove the NFT from active
                    custody — calls <code>burnToken()</code> on the contract.
                  </>
                ) : (
                  <>
                    Link an IPFS document CID to a batch — calls{" "}
                    <code>setDocumentCID()</code>.
                  </>
                )}
              </p>
              {op === "register" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void handleRegister();
                  }}
                >
                  <div className="form-grid">
                    <Field
                      label="GTIN"
                      required
                      hint="14-digit Global Trade Item Number"
                    >
                      <input
                        required
                        inputMode="numeric"
                        value={reg.gtin}
                        onChange={(e) =>
                          updateRegistrationField("gtin", e.target.value)
                        }
                        disabled={metadataUploading || submitting}
                        placeholder="03459876012345"
                      />
                    </Field>
                    <Field
                      label="Batch Number"
                      required
                      hint="Unique batch identifier for this manufacturer"
                    >
                      <input
                        required
                        value={reg.batchNumber}
                        onChange={(e) =>
                          updateRegistrationField("batchNumber", e.target.value)
                        }
                        disabled={metadataUploading || submitting}
                        placeholder="BT-2024-00842"
                      />
                    </Field>
                    <Field label="Manufacture Date" required>
                      <input
                        required
                        type="date"
                        value={reg.manufactureDate}
                        onChange={(e) =>
                          updateRegistrationField("manufactureDate", e.target.value)
                        }
                        disabled={metadataUploading || submitting}
                      />
                    </Field>
                    <Field
                      label="Expiry Date"
                      required
                      hint="Must be a future date"
                    >
                      <input
                        required
                        type="date"
                        value={reg.expiryDate}
                        onChange={(e) =>
                          updateRegistrationField("expiryDate", e.target.value)
                        }
                        disabled={metadataUploading || submitting}
                      />
                    </Field>
                  </div>
                  <Field label="Drug Name" required>
                    <input
                      required
                      value={reg.medicineName}
                      onChange={(e) =>
                        updateRegistrationField("medicineName", e.target.value)
                      }
                      disabled={metadataUploading || submitting}
                      placeholder="Amoxicillin 500mg"
                    />
                  </Field>
                  <button
                    type="button"
                    className="button full"
                    disabled={
                      metadataUploading ||
                      submitting ||
                      !configured ||
                      Boolean(reg.metadataCID.trim())
                    }
                    onClick={() => void handleGenerateMetadata()}
                  >
                    {metadataUploading
                      ? "Generating NFT Metadata..."
                      : "Generate NFT Metadata on IPFS"}
                  </button>
                  <Field
                    label="Metadata CID"
                    required
                    hint="IPFS CID of the NFT metadata JSON"
                  >
                    <input
                      required
                      value={reg.metadataCID}
                      onChange={(e) => {
                        setReg({ ...reg, metadataCID: e.target.value });
                        metadataRequestRef.current = null;
                      }}
                      readOnly={metadataUploading || submitting}
                      placeholder="bafy..."
                    />
                  </Field>
                  <div className="notice blue">
                    <Icon name="fc6e7" size={18} />
                    <span>{hint}</span>
                  </div>
                  <button
                    className="button primary full submit-button"
                    type="submit"
                    disabled={submitting || metadataUploading || !configured}
                  >
                    <Icon name="c276b" size={17} />
                    {submitting ? "Submitting..." : "Register Medicine Batch"}
                  </button>
                </form>
              )}
              {op === "transfer" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void (async () => {
                      try {
                        const b = await resolveBatch(transfer.id, batches);
                        await submit("Transfer Ownership", () =>
                          transferBatch(
                            b.tokenId,
                            transfer.recipient,
                            transfer.price,
                          ),
                        );
                      } catch (err) {
                        setError(String((err as Error).message || err));
                      }
                    })();
                  }}
                >
                  <Field
                    label="Batch ID / Token ID"
                    required
                    hint="The batch must be owned by your wallet"
                  >
                    <input
                      required
                      value={transfer.id}
                      onChange={(e) =>
                        setTransfer({ ...transfer, id: e.target.value })
                      }
                      placeholder="MED-2024-00142"
                    />
                  </Field>
                  <Field
                    label="Recipient Wallet Address"
                    required
                    hint="Manufacturer → Distributor; Distributor → Pharmacy/Hospital"
                  >
                    <input
                      required
                      value={transfer.recipient}
                      onChange={(e) =>
                        setTransfer({ ...transfer, recipient: e.target.value })
                      }
                      placeholder="0x..."
                    />
                  </Field>
                  <div className="form-grid">
                    <Field
                      label="Unit Price (USD)"
                      required
                      hint="Encrypted before sending"
                    >
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={transfer.price}
                        onChange={(e) =>
                          setTransfer({ ...transfer, price: e.target.value })
                        }
                        placeholder="24.50"
                      />
                    </Field>
                  </div>
                  <div className="validation-card">
                    <strong>Pre-transfer validation</strong>
                    <div>○ Batch exists on-chain</div>
                    <div>○ You are the current owner</div>
                    <div>○ Batch is active and unexpired</div>
                    <div>○ Recipient has the next registered role</div>
                    <small>
                      Pending. The contract simulation checks these rules before
                      wallet signing.
                    </small>
                  </div>
                  <div className="notice blue">
                    <Icon name="fc6e7" size={18} />
                    <span>{hint} The backend encrypts the price with AES-256-GCM before wallet confirmation.</span>
                  </div>
                  <button
                    className="button primary full submit-button"
                    disabled={submitting || !configured}
                  >
                    <Icon name="48a0d" size={17} /> Transfer Ownership
                  </button>
                </form>
              )}
              {op === "dispense" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void (async () => {
                      try {
                        const b = await resolveBatch(burn.id, batches);
                        if (b.lifecycle !== 0 || b.owner.toLowerCase() !== wallet.address.toLowerCase()
                            || b.ownerRole !== wallet.role || (upstream && burn.outcome !== 2)) {
                          throw new Error("Only the active owner at this stage can finalize this batch.");
                        }
                        if (burn.outcome === 1 && b.expiryDate <= Date.now() / 1000) {
                          throw new Error("Expired batches cannot be dispensed.");
                        }
                        await submit(
                          burn.outcome === 1
                            ? "Dispense Medicine"
                            : "Destroy Medicine",
                          () => burnBatch(b.tokenId, burn.outcome),
                        );
                      } catch (err) {
                        setError(String((err as Error).message || err));
                      }
                    })();
                  }}
                >
                  <Field
                    label="Batch ID to Finalize"
                    required
                    hint="Must be an active batch held by your wallet"
                  >
                    <input
                      required
                      value={burn.id}
                      onChange={(e) => setBurn({ ...burn, id: e.target.value })}
                      placeholder="BT-2024-00841"
                    />
                  </Field>
                  {selectedBatch && (
                    <>
                      <div className="batch-preview">
                        <span className="preview-icon">
                          <Icon name="171ec" size={25} />
                        </span>
                        <span>
                          <small>{selectedBatch.batchNumber}</small>
                          <strong>{selectedBatch.medicineName}</strong>
                          <small>GTIN {selectedBatch.gtin}</small>
                        </span>
                        <em>{selectedBatch.lifecycle ? "FINAL" : "ACTIVE"}</em>
                      </div>
                      <div className="preview-stats">
                        <div>
                          <span>Expiry Date</span>
                          <strong>
                            {new Date(
                              selectedBatch.expiryDate * 1000,
                            ).toLocaleDateString()}
                          </strong>
                        </div>
                        <div>
                          <span>Current Owner</span>
                          <strong>{short(selectedBatch.owner)}</strong>
                        </div>
                      </div>
                    </>
                  )}
                  <Field label="Final outcome">
                    <select
                      value={burn.outcome}
                      onChange={(e) =>
                        setBurn({
                          ...burn,
                          outcome: Number(e.target.value) as 1 | 2,
                        })
                      }
                    >
                      {!upstream && <option value={1}>Consumed — entire batch dispensed</option>}
                      <option value={2}>Destroyed — batch disposed</option>
                    </select>
                  </Field>
                  <div className="notice red">
                    <Icon name="2b3aa" size={23} />
                    <span>
                      <strong>Confirm final outcome?</strong>
                      <br />
                      This action permanently burns the NFT. Batch history
                      remains available for verification.
                    </span>
                  </div>
                  <button
                    className="button danger full submit-button"
                    disabled={submitting || !configured}
                  >
                    <Icon name="cee95" size={17} />{" "}
                    {burn.outcome === 1
                      ? "Dispense & Burn Token"
                      : "Destroy & Burn Token"}
                  </button>
                </form>
              )}
              {op === "documents" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit("Update Document CID", async () => {
                      const b = await resolveBatch(document.id, batches);
                      return setDocument(b.tokenId, document.kind, document.cid);
                    }).then(confirmed => {
                      if (confirmed) setDocumentUploadStatus("LINKED");
                    });
                  }}
                >
                  <Field label="Batch ID / Token ID" required>
                    <input
                      required
                      value={document.id}
                      onChange={(e) => {
                        setDocumentForm({
                          ...document,
                          id: e.target.value,
                          cid: ""
                        });
                        setDocumentFile(null);
                        setDocumentUploadStatus(null);
                      }}
                      readOnly={submitting || uploadingDocument}
                      placeholder="MED-2024-00142"
                    />
                  </Field>
                  <Field label="Document type">
                    <select
                      value={document.kind}
                      onChange={(e) => {
                        setDocumentForm({
                          ...document,
                          kind: Number(e.target.value) as 0 | 1 | 2,
                          cid: ""
                        });
                        setDocumentFile(null);
                        setDocumentUploadStatus(null);
                      }}
                      disabled={submitting || uploadingDocument}
                    >
                      <option value={0}>Certificate of origin (PDF)</option>
                      <option value={1}>Quality certificate (image)</option>
                      <option value={2}>Chemical metadata (JSON)</option>
                    </select>
                  </Field>

                  <Field label="Visibility">
                    <select value={visibility} disabled={submitting || uploadingDocument}
                      onChange={event => {
                        setVisibility(event.target.value as typeof visibility);
                        setDocumentFile(null);
                        setDocumentForm(previous => ({...previous, cid: ""}));
                        setDocumentUploadStatus(null);
                      }}>
                      <option value="PUBLIC">Public</option>
                      <option value="RESTRICTED">Restricted (encrypted)</option>
                    </select>
                  </Field>
                  <Field label="Document file">
                    <input
                      ref={documentPicker}
                      key={document.id + ":" + document.kind + ":" + visibility}
                      disabled={submitting || uploadingDocument}
                      type="file"
                      accept={
                        document.kind === 0
                          ? ".pdf,application/pdf"
                          : document.kind === 1
                            ? ".jpg,.jpeg,.png,image/jpeg,image/png"
                            : ".json,application/json"
                      }
                      onChange={(e) => {
                        setDocumentFile(e.target.files?.[0] ?? null);
                        setDocumentForm((previous) => ({
                          ...previous,
                          cid: ""
                        }));
                        setDocumentUploadStatus(null);
                      }}
                    />
                  </Field>

                  <button
                    type="button"
                    className="button full"
                    disabled={submitting || uploadingDocument || !documentFile}
                    onClick={() => void handleDocumentUpload()}
                  >
                    {uploadingDocument ? "Uploading..." : "Upload Document to IPFS"}
                  </button>

                  <button type="button" className="button full"
                    disabled={submitting || uploadingDocument || !document.id.trim()}
                    onClick={() => void handleDocumentUpload(true)}>
                    Recover Pending CID
                  </button>
                  <Field label="IPFS CID" required>
                      <input
                        required
                        value={document.cid}
                        onChange={(e) => {
                          setDocumentForm({
                            ...document,
                            cid: e.target.value
                          });
                          setDocumentUploadStatus(null);
                        }}
                        readOnly={submitting || uploadingDocument}
                        placeholder="bafy..."
                      />
                    </Field>
                  {documentUploadStatus && (
                      <div className="notice blue">
                        <span>
                          {documentUploadStatus === "UPLOADED_NOT_LINKED"
                            ? "Uploaded to IPFS, not yet linked on Sepolia. If the transaction fails, retry Save Document CID without uploading again."
                            : "Document CID transaction confirmed on Sepolia."}
                        </span>
                      </div>
                    )}
                  <div className="notice blue">
                    <Icon name="fc6e7" size={18} />
                    <span>{hint}</span>
                  </div>
                  <button
                    className="button primary full submit-button"
                    disabled={submitting || uploadingDocument || !configured}
                  >
                    Save Document CID
                  </button>
                </form>
              )}
              {error && <div className="notice red form-error">{error}</div>}
            </>
          )}
        </div>
      </main>
      <aside className="recent-rail">
        <div className="recent-head">
          <div>
            <span className="rail-heading">RECENT TRANSACTIONS</span>
            <strong>This wallet</strong>
          </div>
          <Icon name="f99f6" size={16} />
        </div>
        {recent.length ? (
          recent.map((x) => (
            <a
              className="recent-item"
              href={explorer(x.hash)}
              target="_blank"
              rel="noreferrer"
              key={x.hash}
            >
              <span className="recent-icon">
                <Icon name="8922d" size={15} />
              </span>
              <span>
                <strong>{x.title}</strong>
                <small>{short(x.hash)}</small>
              </span>
              <em>{x.status}</em>
            </a>
          ))
        ) : (
          <p className="empty-hint">No transactions in this session.</p>
        )}

        <div className="contract-footer">
          <div className="rail-heading">CONTRACT INFO</div>
          {[
            ["Network", "Sepolia Testnet"],
            [
              "Contract",
              configured
                ? short(import.meta.env.VITE_CONTRACT_ADDRESS)
                : "Not configured",
            ],
            ["Chain ID", "11155111"],
            ["Status", configured ? "Ready" : "Not configured"],
          ].map(([k, v]) => (
            <div key={k}>
              <span>{k}</span>
              <strong>{v}</strong>
            </div>
          ))}
        </div>
      </aside>
    </div>
  );
}

# PharmaChain React frontend

This Vite/React frontend implements the supplied Figma screens: wallet entry, Track & Trace, QR/manual verification, manufacturer registration and transfer, distributor transfer, pharmacy/hospital dispense, and transaction states. Layouts are responsive. Static SVG icons are saved under `public/assets/` from the Figma design.

The 23 Figma frames and browser checks are listed in [FIGMA_AUDIT.md](./FIGMA_AUDIT.md). Preview account selection now shows its matching wallet state before entering the dashboard. Transaction states and the query loader can be opened in preview without sending on-chain transactions.

## Run

```powershell
cd "C:\Users\ACER\Documents\ChatGPT\Project Blockchain 2\frontend"
pnpm install --frozen-lockfile
pnpm dev
pnpm build
```

Open the local URL printed by Vite. Before a Sepolia deployment is configured, choose a design preview account on the wallet page. Preview data is visibly labeled and write buttons are disabled. After configuring a public Sepolia RPC and contract, visitors can browse and verify public records without a wallet.

## Connect Sepolia

Copy `.env.example` to `.env.local`, then set `VITE_CONTRACT_ADDRESS` to the deployed `DrugSupplyChain` address, `VITE_SEPOLIA_RPC_URL` to a public read RPC endpoint, and `VITE_DEPLOYMENT_BLOCK` to the contract deployment block. Restart Vite. Connect MetaMask on Sepolia with an address that the admin registered through `setParticipant`.

The frontend imports the compiler-generated ABI from `../shared/abi/DrugSupplyChain.json`; regenerate it with `pnpm build` in `contracts/` after contract changes. Users sign all writes in their wallet. Contract methods are simulated with `staticCall` before submission, and the UI waits for a confirmed receipt. Event logs build the registry and custody timeline. Large deployments should replace full log scans with a confirmed backend indexer.

QR URLs are accepted only when their origin, `chainId`, `contract`, and numeric `tokenId` match this application and the configured Sepolia deployment. Manual batch IDs, GTINs, and token IDs remain available. Verification describes the blockchain record and cannot prove the physical medicine is genuine.

Registration collects the contract's required manufacture date, expiry date and metadata CID. Transfer collects the price and a passphrase, derives a 256-bit AES-GCM key using PBKDF2, encrypts the price in the browser, and sends only an opaque envelope in the `encryptedPrice` event. The passphrase is never stored by the frontend. Authorized parties must exchange it through a secure channel. This is a frontend-only encryption workflow; it does not implement the backend key management or role-controlled decryption service proposed in the system design.

Document management links an existing IPFS CID to the contract. Upload, encrypted restricted-file retrieval, SIWE and Pinata integration require the separate backend described in the system design. The frontend does not present these as completed features.

## Verification status

`pnpm build` succeeds, and the existing Hardhat contract suite passes 16/16 tests. The preview UI has been checked in a browser for wallet entry, trace, manual verification, unknown batches, and management forms. A live Sepolia transaction or camera permission flow cannot be verified until a contract is deployed, roles are provisioned, and the browser has a wallet/camera available.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { Interface, ZeroHash } from "ethers";
import { build } from "vite";
import react from "@vitejs/plugin-react";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PHARMA_TEST_PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("../", import.meta.url));
const bundle = await mkdtemp(path.join(os.tmpdir(), "pharma-ui-"));
const abi = new Interface(JSON.parse(await readFile(path.join(root, "../shared/abi/DrugSupplyChain.json"), "utf8")));
const address = "0x" + "1".repeat(40), contract = "0x" + "2".repeat(40);
const origin = "https://app.fixture.invalid";
const chainId = 11155111;
await build({ root, envDir: false, configFile: false, plugins: [react()], logLevel: "error",
  define: Object.fromEntries(Object.entries({VITE_API_BASE_URL: origin, VITE_CONTRACT_ADDRESS: contract,
    VITE_SEPOLIA_RPC_URL: origin + "/rpc", VITE_DEPLOYMENT_BLOCK: "1"}).map(([k,v]) => ["import.meta.env."+k,JSON.stringify(v)])),
  build: {outDir: bundle} });
const browser = await chromium.launch({headless:true, executablePath:process.env.PHARMA_TEST_BROWSER});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(8000);
  const failures = [];
  page.on("pageerror", e => failures.push(String(e)));
  let admin = false, role = 1, accept = false, burned = false, uploads = 0, pending = "", rejected = 0;
  let stage = 0, holder = address;
  const now = Math.floor(Date.now()/1000);
  const sent = [];
  const hash = () => "0x" + sent.length.toString(16).padStart(64, "0");
  const blockHash = "0x" + "a".repeat(64);
  let registryGate;
  function rpc(method, params) {
    switch (method) {
      case "eth_accounts": case "eth_requestAccounts": return [address];
      case "eth_chainId": return "0xaa36a7";
      case "eth_getBalance": return "0x0";
      case "eth_blockNumber": return "0x2";
      case "personal_sign": return "0x" + "1".repeat(130);
      case "eth_estimateGas": return "0x10000";
      case "eth_sendTransaction":
        if (!accept) {rejected++; return null;}
        sent.push(params[0]); return hash();
      case "eth_getTransactionByHash":
        return {hash:hash(), blockHash, blockNumber:"0x2", transactionIndex:"0x0", nonce:"0x0",
          from:address,to:contract,gas:"0x10000",gasPrice:"0x1",value:"0x0",input:sent.at(-1).data,
          chainId:"0xaa36a7",v:"0x1b",r:"0x"+"1".repeat(64),s:"0x"+"2".repeat(64)};
      case "eth_getTransactionReceipt":
        return {transactionHash:hash(),blockHash,blockNumber:"0x2",transactionIndex:"0x0",status:"0x1",
          logs:[],logsBloom:"0x"+"00".repeat(256),from:address,to:contract,gasUsed:"0x10",
          cumulativeGasUsed:"0x10",effectiveGasPrice:"0x1",contractAddress:null};
      case "eth_call": {
        const call = abi.parseTransaction({data:params[0].data});
        const id = call.args.length ? Number(call.args[0]) || 1 : 1;
        const result = {
          getParticipant: [[address, admin ? 0 : role, "Fixture maker", !admin]],
          DEFAULT_ADMIN_ROLE: [ZeroHash], hasRole: [admin],
          verifyProduct: [id > 12 ? 0 : burned ? 3 : 1, holder],
          getMedicine: [[id,"08901234567890",id === 2 ? "77" : "LOT-"+id,"Medicine "+id,address,now-100,now+86400,now-50,burned?1:0,stage,"fixture-meta"]],
          getDocument: [[0,"",address,0]], setDocumentCID: [], setParticipant: [], registerMedicine:[1], transferOwnership:[], burnToken:[]
        }[call.name];
        if (!result) throw Error("Unexpected contract call "+call.name);
        return abi.encodeFunctionResult(call.name, result);
      }
      default: throw Error("Unexpected RPC "+method);
    }
  }
  await page.exposeFunction("fixtureRpc", rpc);
  await page.addInitScript(() => { window.ethereum = {request: async ({method,params=[]}) => {
    const value = await window.fixtureRpc(method, params);
    if (method === "eth_sendTransaction" && value === null) throw Object.assign(new Error("User rejected fixture transaction"), {code:4001});
    return value;
  }}; });
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "fonts.googleapis.com") return route.fulfill({contentType:"text/css",body:""});
    if (url.origin !== origin) { failures.push("Unexpected external request"); return route.abort(); }
    if (url.pathname === "/rpc") {
      const input = request.postDataJSON();
      const reply = q => ({jsonrpc:"2.0",id:q.id,result:rpc(q.method,q.params)});
      return route.fulfill({json:Array.isArray(input)?input.map(reply):reply(input)});
    }
    if (url.pathname.startsWith("/api/")) {
      let data;
      const meta = {chainId,contract,blockHash:"fixture-block",hasMore:false};
      if (url.pathname.endsWith("/auth/nonce")) data = {message:"fixture",nonce:"demo"};
      else if (url.pathname.endsWith("/auth/verify")) data = {address, chainId,expiresAt:"2099-01-01"};
      else if (url.pathname.endsWith("/batches")) {
        if (registryGate) await registryGate;
        data = Array.from({length:12},(_,i)=>({tokenId:String(i+1)}));
      }
      else if (url.pathname.endsWith("/encryption/prices")) data={encryptedPrice:"0x"+"bb".repeat(64)};
      else if (url.pathname.endsWith("/pending")) {
        const restricted = url.searchParams.get("visibility") === "RESTRICTED";
        assert.equal(url.searchParams.get("visibility"), restricted ? "RESTRICTED" : "PUBLIC");
        assert.equal(url.searchParams.get("documentType"), restricted ? "QUALITY_CERTIFICATE" : "CERTIFICATE_OF_ORIGIN");
        assert.equal(url.pathname, "/api/v1/batches/" + (restricted ? "2" : "1") + "/documents/pending");
        data = pending ? {cid:pending} : null;
      }
      else if (url.pathname.endsWith("/documents") && request.method()==="POST") {
        uploads++; pending = url.pathname.includes("/2/") ? "restricted-pending" : "fixture-pending-cid";
        data={cid:pending,status:"UPLOADED_NOT_LINKED"};
      } else data = [];
      return route.fulfill({json:{data,meta}});
    }
    const file = url.pathname === "/" || url.pathname === "/verify" ? "index.html" : url.pathname.slice(1);
    const type = {".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml",".html":"text/html"}[path.extname(file)];
    return route.fulfill({body:await readFile(path.join(bundle,file)),contentType:type});
  });
  async function evidence(name) {
    const dir = process.env.PHARMA_TEST_EVIDENCE;
    if (!dir) return;
    await mkdir(dir, {recursive:true});
    await page.screenshot({path:path.join(dir, name + ".png")});
  }
  async function login() {
    await page.getByRole("button",{name:/Connect MetaMask/}).click();
    const next = page.getByRole("button",{name:/Continue/});
    await next.or(page.locator(".connect-panel .notice.red")).waitFor();
    if (!await next.isVisible()) throw Error(await page.locator(".connect-panel .notice.red").innerText());
    await next.click();
  }
  async function docs(selectBatch = true) {
    await page.getByRole("button",{name:"Manage",exact:true}).click();
    await page.getByRole("button",{name:/Documents Current owner/}).click();
    if (selectBatch) await page.getByLabel("Batch ID / Token ID").fill("1");
  }
  await page.goto(origin);
  await login();
  await page.getByText("Filters and totals").click();
  await page.getByRole("button",{name:"Next",exact:true}).click();
  assert.equal(await page.locator(".batch-list-item").count(),2);
  await page.getByLabel("Owner role").selectOption("PHARMACY");
  await page.getByText("No matching batches",{exact:true}).first().waitFor();
  await page.getByLabel("Owner role").selectOption("MANUFACTURER");
  await page.getByLabel("Search batches").fill("LOT-12");
  assert.equal(await page.locator(".batch-list-item").count(),1);
  await docs();
  await page.getByLabel("Visibility").selectOption("RESTRICTED");
  await page.getByLabel("Document file").setInputFiles({name:"private.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4 fixture")});
  await page.getByLabel("Visibility").selectOption("PUBLIC");
  assert.equal(await page.getByRole("button",{name:"Upload Document to IPFS"}).isDisabled(),true);
  assert.equal(await page.getByLabel("Document file").inputValue(),"");
  await page.getByLabel("Document file").setInputFiles({name:"demo.pdf",mimeType:"application/pdf",buffer:Buffer.from("%PDF-1.4 fixture")});
  await page.getByRole("button",{name:"Upload Document to IPFS"}).click();
  const cid = page.getByLabel("IPFS CID");
  await page.waitForFunction(() => document.querySelector('input[placeholder="bafy..."]').value === "fixture-pending-cid");
  await page.getByRole("button",{name:"Save Document CID"}).click();
  await page.getByRole("heading",{name:"Transaction failed"}).waitFor();
  await page.getByRole("button",{name:"Close",exact:true}).first().click();
  assert.equal(await cid.inputValue(),pending);
  await page.reload();
  await login(); await docs(false);
  assert.equal(await page.getByLabel("Batch ID / Token ID").inputValue(), "1");
  await page.getByRole("button",{name:"Recover Pending CID"}).click();
  await page.waitForFunction(() => document.querySelector('input[placeholder="bafy..."]').value === "fixture-pending-cid");
  await evidence("pending-cid-mock");
  await page.getByLabel("Document type").selectOption("1");
  assert.equal(await cid.inputValue(),"");
  assert.equal(uploads,1);
  assert.equal(rejected,1);
  console.log("PASS dashboard filters/pagination; upload, rejection, reload recovery and CID invalidation");

  await page.getByLabel("Batch ID / Token ID").fill("2");
  await page.getByLabel("Visibility").selectOption("RESTRICTED");
  await page.getByLabel("Document file").setInputFiles({name:"demo.png",mimeType:"image/png",buffer:Buffer.from("fixture image")});
  await page.getByRole("button",{name:"Upload Document to IPFS"}).click();
  await page.waitForFunction(() => document.querySelector('input[placeholder="bafy..."]').value === "restricted-pending");
  await page.getByRole("button",{name:"Save Document CID"}).click();
  await page.getByRole("heading",{name:"Transaction failed"}).waitFor();
  await page.reload(); await login(); await docs(false);
  assert.equal(await page.getByLabel("Batch ID / Token ID").inputValue(), "2");
  assert.equal(await page.getByLabel("Document type").inputValue(), "1");
  assert.equal(await page.getByLabel("Visibility").inputValue(), "RESTRICTED");
  assert.equal(await cid.inputValue(), "");
  await page.getByRole("button",{name:"Recover Pending CID"}).click();
  await page.waitForFunction(() => document.querySelector('input[placeholder="bafy..."]').value === "restricted-pending");
  assert.equal(uploads, 2);
  assert.equal(rejected, 2);
  console.log("PASS restricted CID recovery after wallet rejection, restored selection and no duplicate upload");

  admin = true;
  await page.reload(); await login();
  await page.getByRole("button",{name:"Manage",exact:true}).click();
  await page.getByRole("heading",{name:"Participant administration"}).waitFor();
  await page.getByLabel("Participant wallet").fill("0x"+"3".repeat(40));
  await page.getByLabel("Organization").fill("Fixture distributor");
  await page.getByLabel("Participant role").selectOption("2");
  await page.getByLabel(/^Access/).selectOption("inactive");
  await page.getByRole("button",{name:"Review participant update in wallet"}).click();
  await page.getByRole("heading",{name:"Transaction failed"}).waitFor();
  assert.equal(rejected,3);
  console.log("PASS admin form, inactive role and explicit wallet rejection");

  async function confirmed(fn) {
    await page.getByRole("heading",{name:"Confirmed on Sepolia"}).waitFor();
    const args = abi.parseTransaction({data:sent.at(-1).data});
    assert.equal(args.name,fn);
    await page.getByRole("button",{name:"Close",exact:true}).first().click();
    return args.args;
  }
  await page.getByRole("button",{name:"Close",exact:true}).first().click();
  accept=true;
  await page.getByRole("button",{name:"Review participant update in wallet"}).click();
  assert.equal((await confirmed("setParticipant"))[3],false);
  admin=false; await page.reload(); await login();
  await page.getByRole("button",{name:"Manage",exact:true}).click();
  await page.getByLabel(/GTIN/).fill("123");
  await page.getByLabel(/Batch Number/).fill("UI-FIXTURE");
  await page.getByLabel(/Drug Name/).fill("Fixture drug");
  await page.getByLabel(/Expiry Date/).fill("2099-01-01");
  await page.getByLabel(/Metadata CID/).fill("fixture-metadata");
  await page.getByRole("button",{name:"Register Medicine Batch"}).click();
  await page.getByText("GTIN must contain exactly 14 digits.").waitFor();
  await page.getByLabel(/GTIN/).fill("08901234567890");
  assert.equal(await page.getByLabel(/Metadata CID/).inputValue(),"");
  await page.getByLabel(/Metadata CID/).fill("fixture-metadata");
  let releaseRegistry;
  registryGate = new Promise(resolve => { releaseRegistry = resolve; });
  await page.getByRole("button",{name:"Register Medicine Batch"}).click();
  assert.equal((await confirmed("registerMedicine"))[5],"fixture-metadata");
  assert.equal(await page.getByLabel(/GTIN/).inputValue(),"");
  releaseRegistry();
  registryGate = undefined;
  await page.getByRole("button",{name:/Transfer Manufacturer/}).click();
  await page.locator(".manage-main form").getByRole("textbox").first().fill("1");
  await page.getByLabel(/Recipient Wallet Address/).fill("0x"+"3".repeat(40));
  await page.getByLabel(/Unit Price/).fill("17.25");
  await page.getByRole("button",{name:"Transfer Ownership",exact:true}).click();
  assert.equal((await confirmed("transferOwnership"))[2],"0x"+"bb".repeat(64));
  for (const upstreamRole of [1, 2]) {
    role = upstreamRole;
    stage = role - 1;
    await page.reload(); await login();
    await page.getByRole("button",{name:"Manage",exact:true}).click();
    await page.getByRole("button",{name:/Destroy Current owner/}).click();
    await page.getByLabel(/Batch ID to Finalize/).fill("1");
    assert.equal(await page.getByLabel("Final outcome").locator("option").count(), 1);
    assert.equal(await page.getByLabel("Final outcome").inputValue(), "2");
    const previousCount = sent.length;
    holder = "0x" + "4".repeat(40);
    await page.locator("form .danger").click();
    await page.getByText("Only the active owner at this stage can finalize this batch.").waitFor();
    assert.equal(sent.length, previousCount);
    holder = address;
    await page.locator("form .danger").click();
    assert.equal((await confirmed("burnToken"))[1],2n);
  }
  console.log("PASS manufacturer/distributor destruction only, non-owner blocked before submission");
  role=3; stage=2; await page.reload(); await login();
  await page.getByRole("button",{name:"Manage",exact:true}).click();
  await page.getByLabel(/Batch ID to Finalize/).fill("1");
  await page.getByLabel(/Final outcome/).selectOption("2");
  await page.locator("form .danger").click();
  assert.equal((await confirmed("burnToken"))[1],2n);
  console.log("PASS simulated receipts for admin, register/reset, encrypted transfer and selected burn outcome");

  const qr = `${origin}/verify?chainId=${chainId}&contract=${contract}&tokenId=1`;
  await page.goto(qr);
  await page.locator(".result-banner").getByText("Authentic batch record").waitFor();
  await evidence("qr-active-mock");
  burned = true; await page.reload();
  await page.locator(".result-banner").getByText("Batch consumed").waitFor();
  await evidence("qr-consumed-mock");
  await page.getByLabel("Batch ID, GTIN or token ID").fill("08901234567890");
  await page.getByRole("button",{name:"Verify on-chain"}).click();
  await page.getByText("Multiple batches match this identifier. Use a token ID.").waitFor();
  await page.getByLabel("Batch ID, GTIN or token ID").fill(qr.replace("tokenId=1","tokenId=77"));
  await page.getByRole("button",{name:"Verify on-chain"}).click();
  await page.locator(".result-banner").getByText("Batch record not found").waitFor();
  assert.equal(await page.getByLabel("Batch ID, GTIN or token ID").inputValue(),qr.replace("tokenId=1","tokenId=77"));
  await page.getByLabel("Batch ID, GTIN or token ID").fill(qr.replace("11155111","1"));
  await page.getByRole("button",{name:"Verify on-chain"}).click();
  await page.getByText(/QR code does not match/).waitFor();
  const zxing = createRequire(require.resolve("@zxing/browser"))("@zxing/library");
  const code = new zxing.QRCodeWriter().encode(qr, zxing.BarcodeFormat.QR_CODE, 0, 0, new Map());
  const pixels = Array.from({length:code.getHeight()}, (_,y) =>
    Array.from({length:code.getWidth()}, (_,x) => code.get(x,y)));
  await page.evaluate(matrix => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {value: async () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = matrix.length * 8;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "black";
      matrix.forEach((row,y) => row.forEach((dark,x) => {
        if (dark) ctx.fillRect(x * 8, y * 8, 8, 8);
      }));
      const stream = canvas.captureStream(10);
      window.fixtureTrack = stream.getVideoTracks()[0];
      window.fixtureTrack.requestFrame();
      return stream;
    }});
  },pixels);
  await page.getByRole("button",{name:"Camera scan"}).click();
  await page.locator(".result-banner").getByText("Batch consumed").waitFor();
  await page.waitForFunction(() => window.fixtureTrack?.readyState === "ended");
  console.log("PASS ZXing decoded QR pixels from a synthetic video stream and released the camera track");
  assert.deepEqual(failures,[]);
  console.log("PASS public QR URL before and after burn, wrong chain rejected; all RPC and HTTP fixtures");
} finally {
  await browser.close();
}

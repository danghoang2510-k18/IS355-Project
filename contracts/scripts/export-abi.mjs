import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const source = resolve(root, "contracts/artifacts/contracts/DrugSupplyChain.sol/DrugSupplyChain.json");
const target = resolve(root, "shared/abi/DrugSupplyChain.json");
const artifact = JSON.parse(await readFile(source, "utf8"));
await mkdir(dirname(target), { recursive: true });
await writeFile(target, JSON.stringify(artifact.abi, null, 2) + "\n");
console.log(`ABI exported to ${target}`);

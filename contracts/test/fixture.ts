import { network } from "hardhat";
import type { DrugSupplyChain } from "../types/ethers-contracts/DrugSupplyChain.js";

export const { ethers } = await network.create();

export async function deployFixture() {
  const [admin, manufacturer, distributor, pharmacy, hospital, outsider, otherManufacturer] = await ethers.getSigners();
  const supply = await ethers.deployContract("DrugSupplyChain", [admin.address]) as unknown as DrugSupplyChain;
  await supply.waitForDeployment();
  await supply.setParticipant(manufacturer.address, 1, "Maker", true);
  await supply.setParticipant(distributor.address, 2, "Distributor", true);
  await supply.setParticipant(pharmacy.address, 3, "Pharmacy", true);
  await supply.setParticipant(hospital.address, 4, "Hospital", true);
  await supply.setParticipant(otherManufacturer.address, 1, "Other maker", true);
  return { supply, admin, manufacturer, distributor, pharmacy, hospital, outsider, otherManufacturer };
}

export async function validDates() {
  const latest = await ethers.provider.getBlock("latest");
  if (!latest) throw new Error("Missing latest block");
  return { manufactured: latest.timestamp - 60, expires: latest.timestamp + 3600 };
}

export async function register(supply: Awaited<ReturnType<typeof deployFixture>>["supply"], manufacturer: Awaited<ReturnType<typeof deployFixture>>["manufacturer"], batch = "B-001") {
  const { manufactured, expires } = await validDates();
  await supply.connect(manufacturer).registerMedicine("08901234567890", batch, "Paracetamol", manufactured, expires, "bafy-metadata");
  return 1n;
}

// Demo ciphertext envelope: version byte + 12-byte nonce + ciphertext + 16-byte GCM tag.
// Tests only verify that opaque bytes travel through events; encryption is off-chain.
export const encryptedPrice = "0x01" + "11".repeat(12) + "22".repeat(16) + "33".repeat(16);

export async function advanceTo(timestamp: number) {
  await ethers.provider.send("evm_setNextBlockTimestamp", [timestamp]);
  await ethers.provider.send("evm_mine", []);
}

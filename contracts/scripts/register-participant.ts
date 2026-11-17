import { network } from "hardhat";
import { getAddress, ZeroAddress } from "ethers";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// =============================================
// 1. PARTICIPANT CONFIGURATION
// =============================================

const PARTICIPANTS = [
  {
    name: "MANUFACTURER",
    role: 1,
    organizationName: "DSCT Manufacturer",
  },
  {
    name: "DISTRIBUTOR",
    role: 2,
    organizationName: "DSCT Distributor",
  },
  {
    name: "PHARMACY",
    role: 3,
    organizationName: "DSCT Pharmacy",
  },
  {
    name: "HOSPITAL",
    role: 4,
    organizationName: "DSCT Hospital",
  },
] as const;

// =============================================
// 2. INPUT HELPERS
// =============================================

const rl = createInterface({
  input: stdin,
  output: stdout,
});

async function ask(question: string): Promise<string> {
  return (await rl.question(question)).trim();
}

function validateAddress(label: string, value: string): string {
  try {
    const address = getAddress(value);

    if (address === ZeroAddress) {
      throw new Error("Zero address is not allowed.");
    }

    return address;
  } catch {
    throw new Error(`Invalid Ethereum address: ${label}`);
  }
}

// =============================================
// 3. MAIN FUNCTION
// =============================================

async function main() {
  try {
    console.log("\n====================================");
    console.log(" DSCT - PARTICIPANT REGISTRATION");
    console.log("====================================\n");

    // -----------------------------------------
    // STEP 1: INPUT CONTRACT AND ADMIN ADDRESS
    // -----------------------------------------

    const contractAddress = validateAddress(
      "Contract Address",
      await ask("Enter Contract Address: "),
    );

    const expectedAdmin = validateAddress(
      "Expected Admin",
      await ask("Enter Expected Admin Address: "),
    );

    // -----------------------------------------
    // STEP 2: INPUT FOUR PARTICIPANT ADDRESSES
    // -----------------------------------------

    const participants = [];

    for (const item of PARTICIPANTS) {
      console.log(`\n--- ${item.name} ---`);

      const wallet = validateAddress(
        item.name,
        await ask(`Enter ${item.name} Wallet Address: `),
      );

      participants.push({
        ...item,
        wallet,
      });
    }

    // -----------------------------------------
    // STEP 3: VALIDATE DUPLICATE ADDRESSES
    // -----------------------------------------

    const addresses = participants.map((participant) =>
      participant.wallet.toLowerCase(),
    );

    const uniqueAddresses = new Set(addresses);

    if (uniqueAddresses.size !== participants.length) {
      throw new Error("Duplicate participant addresses detected.");
    }

    if (addresses.includes(expectedAdmin.toLowerCase())) {
      throw new Error("Participant address cannot be the ADMIN address.");
    }

    // -----------------------------------------
    // STEP 4: CONNECT TO SEPOLIA
    // -----------------------------------------

    const { ethers } = await network.create();

    const chain = await ethers.provider.getNetwork();

    if (chain.chainId !== 11155111n) {
      throw new Error(`Wrong network! Expected Sepolia, got ${chain.chainId}`);
    }

    // -----------------------------------------
    // STEP 5: VERIFY DEPLOYER
    // -----------------------------------------

    const [admin] = await ethers.getSigners();

    if (!admin) {
      throw new Error("ADMIN signer is not configured.");
    }

    if (getAddress(admin.address) !== expectedAdmin) {
      throw new Error("Configured signer does not match Expected ADMIN.");
    }

    // -----------------------------------------
    // STEP 6: VERIFY CONTRACT
    // -----------------------------------------

    const code = await ethers.provider.getCode(contractAddress);

    if (code === "0x") {
      throw new Error("No Smart Contract found at the supplied address.");
    }

    const contract = await ethers.getContractAt(
      "DrugSupplyChain",
      contractAddress,
      admin,
    );

    // Check actual on-chain admin permission
    const defaultAdminRole = await contract.DEFAULT_ADMIN_ROLE();

    const isAdmin = await contract.hasRole(defaultAdminRole, admin.address);

    if (!isAdmin) {
      throw new Error("Connected wallet does not have DEFAULT_ADMIN_ROLE.");
    }

    // -----------------------------------------
    // STEP 7: DISPLAY REGISTRATION PLAN
    // -----------------------------------------

    console.log("\n====================================");
    console.log(" REGISTRATION SUMMARY");
    console.log("====================================");

    console.log("Network: Ethereum Sepolia");
    console.log("Chain ID:", chain.chainId.toString());
    console.log("Contract:", contractAddress);
    console.log("ADMIN:", admin.address);

    for (const participant of participants) {
      console.log(`\nRole: ${participant.name}`);
      console.log("Wallet:", participant.wallet);
      console.log("Organization:", participant.organizationName);
    }

    // -----------------------------------------
    // STEP 8: PRE-CHECK EXISTING PARTICIPANTS
    // -----------------------------------------

    const pendingParticipants = [];

    for (const participant of participants) {
      const existing = await contract.getParticipant(participant.wallet);

      const isActive = Boolean(existing[3]);
      const currentRole = Number(existing[1]);
      const currentOrganization = String(existing[2]);

      if (isActive) {
        if (
          currentRole === participant.role &&
          currentOrganization === participant.organizationName
        ) {
          console.log(
            `\n[SKIP] ${participant.name} is already registered correctly.`,
          );
          continue;
        }

        throw new Error(
          `${participant.name} is already active with different information.`,
        );
      }

      pendingParticipants.push(participant);
    }

    if (pendingParticipants.length === 0) {
      console.log("\nAll participants are already registered.");
      return;
    }

    // -----------------------------------------
    // STEP 9: CONFIRM BEFORE SENDING TRANSACTIONS
    // -----------------------------------------

    console.log(`\nParticipants to register: ${pendingParticipants.length}`);

    const confirmation = await ask('\nType "REGISTER" to confirm: ');

    if (confirmation !== "REGISTER") {
      console.log("\nRegistration cancelled.");
      return;
    }

    // -----------------------------------------
    // STEP 10: REGISTER PARTICIPANTS
    // -----------------------------------------

    for (const participant of pendingParticipants) {
      console.log("\n------------------------------------");
      console.log(`Registering ${participant.name}...`);

      const tx = await contract.setParticipant(
        participant.wallet,
        participant.role,
        participant.organizationName,
        true,
      );

      console.log("Transaction submitted:", tx.hash);

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new Error(`Transaction failed for ${participant.name}`);
      }

      console.log("Transaction confirmed!");
      console.log("Block:", receipt.blockNumber);

      // Verify actual blockchain state
      const result = await contract.getParticipant(participant.wallet);

      const verified =
        getAddress(result[0]) === participant.wallet &&
        Number(result[1]) === participant.role &&
        String(result[2]) === participant.organizationName &&
        Boolean(result[3]) === true;

      if (!verified) {
        throw new Error(`On-chain verification failed for ${participant.name}`);
      }

      console.log(`[SUCCESS] ${participant.name}`);
      console.log("Wallet:", result[0]);
      console.log("Role:", Number(result[1]));
      console.log("Organization:", result[2]);
      console.log("Active:", result[3]);
      console.log("Tx Hash:", tx.hash);
    }

    // -----------------------------------------
    // STEP 11: FINAL SUMMARY
    // -----------------------------------------

    console.log("\n====================================");
    console.log(" REGISTRATION COMPLETED");
    console.log("====================================");

    for (const participant of participants) {
      const result = await contract.getParticipant(participant.wallet);

      console.log(`${participant.name}: ${result[3] ? "ACTIVE" : "INACTIVE"}`);
    }

    console.log("\nAll results have been verified on Sepolia.");
  } finally {
    rl.close();
  }
}

// =============================================
// 4. EXECUTE
// =============================================

main().catch((error) => {
  console.error("\nREGISTRATION ERROR:");
  console.error(error.message || error);
  process.exitCode = 1;
});

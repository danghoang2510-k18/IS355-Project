import { network } from "hardhat";

const { ethers } = await network.create();
const chain = await ethers.provider.getNetwork();
if (chain.chainId !== 11155111n) {
  throw new Error(`Expected Sepolia (11155111), got ${chain.chainId}`);
}
const [deployer] = await ethers.getSigners();
if (!deployer) throw new Error("No deployer configured");

const contract = await ethers.deployContract("DrugSupplyChain", [
  deployer.address,
]);
await contract.waitForDeployment();
const tx = contract.deploymentTransaction();
console.log(
  JSON.stringify(
    {
      chainId: chain.chainId.toString(),
      contract: await contract.getAddress(),
      admin: deployer.address,
      deployTransaction: tx?.hash,
    },
    null,
    2,
  ),
);

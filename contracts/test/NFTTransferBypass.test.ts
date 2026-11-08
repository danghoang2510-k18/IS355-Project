import { expect } from "chai";
import { deployFixture, encryptedPrice, ethers, register } from "./fixture.js";

describe("ERC-721 business-route enforcement", function () {
  it("rejects direct transferFrom, both safeTransferFrom signatures, and approvals", async function () {
    const { supply, manufacturer, distributor } = await deployFixture();
    await register(supply, manufacturer);
    const token = supply.connect(manufacturer);
    await expect(token.transferFrom(manufacturer.address, distributor.address, 1n))
      .to.be.revertedWithCustomError(supply, "DirectTokenOperationDisabled");
    await expect(token["safeTransferFrom(address,address,uint256)"](manufacturer.address, distributor.address, 1n))
      .to.be.revertedWithCustomError(supply, "DirectTokenOperationDisabled");
    await expect(token["safeTransferFrom(address,address,uint256,bytes)"](manufacturer.address, distributor.address, 1n, "0x"))
      .to.be.revertedWithCustomError(supply, "DirectTokenOperationDisabled");
    await expect(token.approve(distributor.address, 1n))
      .to.be.revertedWithCustomError(supply, "DirectTokenOperationDisabled");
    await expect(token.setApprovalForAll(distributor.address, true))
      .to.be.revertedWithCustomError(supply, "DirectTokenOperationDisabled");
    expect(await supply.ownerOf(1n)).to.equal(manufacturer.address);
  });

  it("rejects transfer from a dispenser and malformed price bytes", async function () {
    const { supply, manufacturer, distributor, pharmacy, hospital } = await deployFixture();
    await register(supply, manufacturer);
    await expect(supply.connect(manufacturer).transferOwnership(1n, distributor.address, "0x313233"))
      .to.be.revertedWithCustomError(supply, "InvalidEncryptedPrice");
    await supply.connect(manufacturer).transferOwnership(1n, distributor.address, encryptedPrice);
    await supply.connect(distributor).transferOwnership(1n, pharmacy.address, encryptedPrice);
    await expect(supply.connect(pharmacy).transferOwnership(1n, hospital.address, encryptedPrice))
      .to.be.revertedWithCustomError(supply, "InvalidRoute");
  });

  it("blocks a receiver callback from transferring the token again", async function () {
    const { supply, manufacturer, pharmacy } = await deployFixture();
    await register(supply, manufacturer);
    const receiver = await ethers.deployContract("ReenteringReceiver", [await supply.getAddress(), pharmacy.address]);
    await receiver.waitForDeployment();
    const receiverAddress = await receiver.getAddress();
    await supply.setParticipant(receiverAddress, 2, "Receiver distributor", true);
    await supply.connect(manufacturer).transferOwnership(1n, receiverAddress, encryptedPrice);
    expect(await receiver.attempted()).to.equal(true);
    expect(await receiver.blocked()).to.equal(true);
    expect(await supply.ownerOf(1n)).to.equal(receiverAddress);
    expect((await supply.getMedicine(1n)).stage).to.equal(1n);
  });
});

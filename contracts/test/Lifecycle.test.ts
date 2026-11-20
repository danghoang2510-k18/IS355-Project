import { expect } from "chai";
import { advanceTo, deployFixture, encryptedPrice, register, validDates } from "./fixture.js";

describe("Medicine lifecycle", function () {
  it("mints one NFT, resolves the composite key, and retains registration data", async function () {
    const { supply, manufacturer } = await deployFixture();
    const dates = await validDates();
    await expect(supply.connect(manufacturer).registerMedicine("000123", "LOT-1", "Drug", dates.manufactured, dates.expires, "bafy-meta"))
      .to.emit(supply, "MedicineRegistered").withArgs(1n, manufacturer.address, "000123", "LOT-1");
    expect(await supply.ownerOf(1n)).to.equal(manufacturer.address);
    expect(await supply.tokenURI(1n)).to.equal("ipfs://bafy-meta");
    expect(await supply.getTokenId(manufacturer.address, "000123", "LOT-1")).to.deep.equal([1n, true]);
    expect((await supply.getMedicine(1n)).gtin).to.equal("000123");
    expect((await supply.verifyProduct(1n))[0]).to.equal(1n);
  });

  it("rejects duplicate keys and invalid manufacture or expiry dates", async function () {
    const { supply, manufacturer } = await deployFixture();
    const dates = await validDates();
    await register(supply, manufacturer);
    await expect(supply.connect(manufacturer).registerMedicine("08901234567890", "B-001", "Drug", dates.manufactured, dates.expires, "cid"))
      .to.be.revertedWithCustomError(supply, "DuplicateBatch");
    await expect(supply.connect(manufacturer).registerMedicine("001", "future", "Drug", dates.expires, dates.expires + 60, "cid"))
      .to.be.revertedWithCustomError(supply, "InvalidDates");
    await expect(supply.connect(manufacturer).registerMedicine("001", "expired", "Drug", dates.manufactured, dates.manufactured + 1, "cid"))
      .to.be.revertedWithCustomError(supply, "InvalidDates");
  });

  it("follows manufacturer -> distributor -> pharmacy with ciphertext event", async function () {
    const { supply, manufacturer, distributor, pharmacy } = await deployFixture();
    await register(supply, manufacturer);
    await expect(supply.connect(manufacturer).transferOwnership(1n, distributor.address, encryptedPrice))
      .to.emit(supply, "CustodyTransferred").withArgs(1n, manufacturer.address, distributor.address, encryptedPrice);
    expect(await supply.ownerOf(1n)).to.equal(distributor.address);
    expect((await supply.getMedicine(1n)).stage).to.equal(1n);
    await supply.connect(distributor).transferOwnership(1n, pharmacy.address, encryptedPrice);
    expect(await supply.ownerOf(1n)).to.equal(pharmacy.address);
    expect((await supply.getMedicine(1n)).stage).to.equal(2n);
    expect(await supply.verifyAuthenticity(1n, pharmacy.address)).to.equal(true);
    expect(await supply.verifyAuthenticity(1n, manufacturer.address)).to.equal(false);
  });

  it("rejects inactive recipients, wrong routes, non-owner, and transfers after expiry", async function () {
    const { supply, manufacturer, distributor, pharmacy, outsider } = await deployFixture();
    await register(supply, manufacturer);
    await expect(supply.connect(manufacturer).transferOwnership(1n, pharmacy.address, encryptedPrice))
      .to.be.revertedWithCustomError(supply, "InvalidRoute");
    await expect(supply.connect(outsider).transferOwnership(1n, distributor.address, encryptedPrice))
      .to.be.revertedWithCustomError(supply, "NotOwner");
    const expiry = Number((await supply.getMedicine(1n)).expiryDate);
    await advanceTo(expiry);
    expect((await supply.verifyProduct(1n))[0]).to.equal(2n);
    await expect(supply.connect(manufacturer).transferOwnership(1n, distributor.address, encryptedPrice))
      .to.be.revertedWithCustomError(supply, "ExpiredBatch");
  });

  it("rejects transfer to a deactivated distributor", async function () {
    const { supply, admin, manufacturer, distributor } = await deployFixture();
    await register(supply, manufacturer);
    await supply.connect(admin).setParticipant(distributor.address, 2, "Distributor", false);
    await expect(supply.connect(manufacturer).transferOwnership(1n, distributor.address, encryptedPrice))
      .to.be.revertedWithCustomError(supply, "InactiveParticipant");
    expect(await supply.ownerOf(1n)).to.equal(manufacturer.address);
  });

  it("rejects destruction by a participant who does not own the batch", async function () {
    const { supply, manufacturer, distributor } = await deployFixture();
    await register(supply, manufacturer);
    await expect(supply.connect(distributor).burnToken(1n, 2))
      .to.be.revertedWithCustomError(supply, "NotOwner");
    expect(await supply.ownerOf(1n)).to.equal(manufacturer.address);
  });

  it("returns NOT_FOUND for an unknown token without reverting", async function () {
    const { supply, outsider } = await deployFixture();
    expect(await supply.verifyProduct(999n)).to.deep.equal([0n, "0x0000000000000000000000000000000000000000"]);
    expect(await supply.verifyAuthenticity(999n, outsider.address)).to.equal(false);
  });

  it("allows a dispenser to consume an entire batch and preserves the archive", async function () {
    const { supply, manufacturer, distributor, hospital } = await deployFixture();
    await register(supply, manufacturer);
    await supply.connect(manufacturer).transferOwnership(1n, distributor.address, encryptedPrice);
    await supply.connect(distributor).transferOwnership(1n, hospital.address, encryptedPrice);
    await expect(supply.connect(hospital).burnToken(1n, 1))
      .to.emit(supply, "TokenBurned").withArgs(1n, hospital.address, 1n);
    await expect(supply.ownerOf(1n)).to.be.revertedWithCustomError(supply, "ERC721NonexistentToken");
    expect((await supply.getMedicine(1n)).lifecycle).to.equal(1n);
    expect((await supply.verifyProduct(1n))[0]).to.equal(3n);
    expect(await supply.verifyAuthenticity(1n, hospital.address)).to.equal(false);
    expect(await supply.lastOwnerOf(1n)).to.equal(hospital.address);
    const dates = await validDates();
    await expect(supply.connect(manufacturer).registerMedicine("08901234567890", "B-001", "Drug", dates.manufactured, dates.expires, "cid"))
      .to.be.revertedWithCustomError(supply, "DuplicateBatch");
  });

  it("permits destruction after expiry but never consumption by an upstream role", async function () {
    const { supply, manufacturer } = await deployFixture();
    await register(supply, manufacturer);
    await expect(supply.connect(manufacturer).burnToken(1n, 1))
      .to.be.revertedWithCustomError(supply, "UnauthorizedBurn");
    const expiry = Number((await supply.getMedicine(1n)).expiryDate);
    await advanceTo(expiry);
    await supply.connect(manufacturer).burnToken(1n, 2);
    expect((await supply.verifyProduct(1n))[0]).to.equal(4n);
    await expect(supply.connect(manufacturer).burnToken(1n, 2))
      .to.be.revertedWithCustomError(supply, "FinalizedBatch");
  });
});

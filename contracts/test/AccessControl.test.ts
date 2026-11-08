import { expect } from "chai";
import { deployFixture, register, validDates } from "./fixture.js";

describe("AccessControl", function () {
  it("allows admin to provision a manufacturer and rejects unauthorized mint", async function () {
    const { supply, manufacturer, outsider } = await deployFixture();
    const role = await supply.MANUFACTURER_ROLE();
    expect(await supply.hasRole(role, manufacturer.address)).to.equal(true);
    const { manufactured, expires } = await validDates();
    await expect(supply.connect(outsider).registerMedicine("001", "B", "Drug", manufactured, expires, "cid"))
      .to.be.revertedWithCustomError(supply, "InactiveParticipant");
  });

  it("revokes access atomically and cannot bypass participant state via inherited role methods", async function () {
    const { supply, admin, manufacturer } = await deployFixture();
    await supply.connect(admin).setParticipant(manufacturer.address, 1, "Maker", false);
    expect((await supply.getParticipant(manufacturer.address)).active).to.equal(false);
    expect(await supply.hasRole(await supply.MANUFACTURER_ROLE(), manufacturer.address)).to.equal(false);
    const { manufactured, expires } = await validDates();
    await expect(supply.connect(manufacturer).registerMedicine("001", "B", "Drug", manufactured, expires, "cid"))
      .to.be.revertedWithCustomError(supply, "InactiveParticipant");
    await expect(supply.connect(admin).grantRole(await supply.MANUFACTURER_ROLE(), manufacturer.address))
      .to.be.revertedWithCustomError(supply, "DirectTokenOperationDisabled");
  });

  it("cannot assign a role by an outsider or give an empty active organization", async function () {
    const { supply, outsider, manufacturer } = await deployFixture();
    await expect(supply.connect(outsider).setParticipant(outsider.address, 2, "Fake", true))
      .to.be.revertedWithCustomError(supply, "AccessControlUnauthorizedAccount");
    await expect(supply.setParticipant(manufacturer.address, 1, "", true))
      .to.be.revertedWithCustomError(supply, "InvalidParticipant");
  });

  it("invalidates verification when the owner is deactivated", async function () {
    const { supply, manufacturer } = await deployFixture();
    await register(supply, manufacturer);
    await supply.setParticipant(manufacturer.address, 1, "Maker", false);
    expect((await supply.verifyProduct(1n))[0]).to.equal(5n);
    expect(await supply.verifyAuthenticity(1n, manufacturer.address)).to.equal(false);
  });
});

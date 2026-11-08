import { expect } from "chai";
import { deployFixture, encryptedPrice, register } from "./fixture.js";

describe("Document CID references", function () {
  it("lets the active owner update a CID and preserves it through transfer and burn", async function () {
    const { supply, manufacturer, distributor, pharmacy } = await deployFixture();
    await register(supply, manufacturer);
    await expect(supply.connect(manufacturer).setDocumentCID(1n, 0, "bafy-pdf"))
      .to.emit(supply, "DocumentCIDUpdated").withArgs(1n, 0n, "bafy-pdf", manufacturer.address);
    await supply.connect(manufacturer).transferOwnership(1n, distributor.address, encryptedPrice);
    await supply.connect(distributor).setDocumentCID(1n, 1, "bafy-photo");
    await supply.connect(distributor).transferOwnership(1n, pharmacy.address, encryptedPrice);
    await supply.connect(pharmacy).setDocumentCID(1n, 2, "bafy-json");
    expect((await supply.getDocument(1n, 0)).cid).to.equal("bafy-pdf");
    expect((await supply.getDocument(1n, 1)).cid).to.equal("bafy-photo");
    expect((await supply.getDocument(1n, 2)).cid).to.equal("bafy-json");
    await supply.connect(pharmacy).burnToken(1n, 1);
    expect((await supply.getDocument(1n, 0)).cid).to.equal("bafy-pdf");
  });

  it("rejects non-owner, empty CID, and finalized updates", async function () {
    const { supply, manufacturer, outsider } = await deployFixture();
    await register(supply, manufacturer);
    await expect(supply.connect(outsider).setDocumentCID(1n, 0, "bafy"))
      .to.be.revertedWithCustomError(supply, "NotOwner");
    await expect(supply.connect(manufacturer).setDocumentCID(1n, 0, ""))
      .to.be.revertedWithCustomError(supply, "InvalidCID");
    await supply.connect(manufacturer).burnToken(1n, 2);
    await expect(supply.connect(manufacturer).setDocumentCID(1n, 0, "bafy"))
      .to.be.revertedWithCustomError(supply, "FinalizedBatch");
  });
});

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IDrugSupplyChain {
    enum Role { NONE, MANUFACTURER, DISTRIBUTOR, PHARMACY, HOSPITAL }
    enum LifecycleStatus { ACTIVE, CONSUMED, DESTROYED }
    enum CustodyStage { AT_MANUFACTURER, AT_DISTRIBUTOR, AT_DISPENSER }
    enum DocumentType { CERTIFICATE_OF_ORIGIN, QUALITY_CERTIFICATE, CHEMICAL_METADATA }
    enum VerificationStatus { NOT_FOUND, AUTHENTIC, EXPIRED, CONSUMED, DESTROYED, INVALID_OWNER }

    struct MedicineBatch {
        uint256 tokenId;
        string gtin;
        string batchNumber;
        string medicineName;
        address manufacturer;
        uint64 manufactureDate;
        uint64 expiryDate;
        uint64 registeredAt;
        LifecycleStatus lifecycle;
        CustodyStage stage;
        string metadataCID;
    }

    struct DocumentRef {
        DocumentType documentType;
        string cid;
        address updatedBy;
        uint64 updatedAt;
    }

    struct Participant {
        address wallet;
        Role role;
        string organizationName;
        bool active;
    }

    event ParticipantUpdated(address indexed wallet, Role role, bool active);
    event MedicineRegistered(uint256 indexed tokenId, address indexed manufacturer, string gtin, string batchNumber);
    event CustodyTransferred(uint256 indexed tokenId, address indexed from, address indexed to, bytes encryptedPrice);
    event DocumentCIDUpdated(uint256 indexed tokenId, DocumentType indexed documentType, string cid, address indexed updatedBy);
    event TokenBurned(uint256 indexed tokenId, address indexed lastOwner, LifecycleStatus finalStatus);

    function setParticipant(address wallet, Role role, string calldata organizationName, bool active) external;
    function getParticipant(address wallet) external view returns (Participant memory);
    function registerMedicine(
        string calldata gtin,
        string calldata batchNumber,
        string calldata medicineName,
        uint64 manufactureDate,
        uint64 expiryDate,
        string calldata metadataCID
    ) external returns (uint256 tokenId);
    function transferOwnership(uint256 tokenId, address newOwner, bytes calldata encryptedPrice) external;
    function verifyProduct(uint256 tokenId) external view returns (VerificationStatus status, address currentOwner);
    function verifyAuthenticity(uint256 tokenId, address claimedOwner) external view returns (bool);
    function getMedicine(uint256 tokenId) external view returns (MedicineBatch memory);
    function getTokenId(address manufacturer, string calldata gtin, string calldata batchNumber)
        external view returns (uint256 tokenId, bool exists);
    function setDocumentCID(uint256 tokenId, DocumentType documentType, string calldata cid) external;
    function getDocument(uint256 tokenId, DocumentType documentType) external view returns (DocumentRef memory);
    function burnToken(uint256 tokenId, LifecycleStatus finalStatus) external;
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDrugSupplyChain} from "./interfaces/IDrugSupplyChain.sol";

/// @notice One ERC-721 token represents one entire, indivisible medicine batch.
contract DrugSupplyChain is ERC721, AccessControl, ReentrancyGuard, IDrugSupplyChain {
    bytes32 public constant MANUFACTURER_ROLE = keccak256("MANUFACTURER_ROLE");
    bytes32 public constant DISTRIBUTOR_ROLE = keccak256("DISTRIBUTOR_ROLE");
    bytes32 public constant PHARMACY_ROLE = keccak256("PHARMACY_ROLE");
    bytes32 public constant HOSPITAL_ROLE = keccak256("HOSPITAL_ROLE");

    error Unauthorized();
    error InvalidParticipant();
    error InvalidDates();
    error InvalidBatchData();
    error DuplicateBatch();
    error UnknownBatch();
    error NotOwner();
    error InactiveParticipant();
    error ExpiredBatch();
    error InvalidRoute();
    error FinalizedBatch();
    error InvalidCID();
    error InvalidDocumentType();
    error InvalidEncryptedPrice();
    error InvalidFinalStatus();
    error UnauthorizedBurn();
    error DirectTokenOperationDisabled();

    uint256 private _nextTokenId = 1;
    bool private _businessTokenOperation;

    mapping(address => Participant) private _participants;
    mapping(uint256 => MedicineBatch) private _batches;
    mapping(bytes32 => uint256) private _tokenIdsByBatchKey;
    mapping(uint256 => mapping(DocumentType => DocumentRef)) private _documents;
    mapping(uint256 => address) public lastOwnerOf;

    constructor(address admin) ERC721("Drug Supply Chain Batch", "DSCT") {
        if (admin == address(0)) revert InvalidParticipant();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /// @dev Use this sole entry point for business roles, keeping AccessControl in sync.
    function setParticipant(address wallet, Role role, string calldata organizationName, bool active)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (wallet == address(0) || wallet == address(this) || wallet == msg.sender || uint8(role) > uint8(Role.HOSPITAL)) {
            revert InvalidParticipant();
        }
        if (active && (role == Role.NONE || bytes(organizationName).length == 0)) revert InvalidParticipant();

        Participant storage previous = _participants[wallet];
        if (previous.active) _revokeRole(_roleId(previous.role), wallet);
        if (active) _grantRole(_roleId(role), wallet);
        _participants[wallet] = Participant(wallet, role, organizationName, active);
        emit ParticipantUpdated(wallet, role, active);
    }

    function getParticipant(address wallet) external view returns (Participant memory) {
        return _participants[wallet];
    }

    /// @dev Disallow inherited AccessControl entry points that would desync Participant.active.
    function grantRole(bytes32, address) public pure override { revert DirectTokenOperationDisabled(); }
    function revokeRole(bytes32, address) public pure override { revert DirectTokenOperationDisabled(); }
    function renounceRole(bytes32, address) public pure override { revert DirectTokenOperationDisabled(); }

    function registerMedicine(
        string calldata gtin,
        string calldata batchNumber,
        string calldata medicineName,
        uint64 manufactureDate,
        uint64 expiryDate,
        string calldata metadataCID
    ) external nonReentrant returns (uint256 tokenId) {
        _requireActiveRole(msg.sender, Role.MANUFACTURER);
        if (bytes(gtin).length == 0 || bytes(batchNumber).length == 0 || bytes(medicineName).length == 0) {
            revert InvalidBatchData();
        }
        if (bytes(metadataCID).length == 0) revert InvalidCID();
        if (manufactureDate > block.timestamp || expiryDate <= block.timestamp || expiryDate <= manufactureDate) {
            revert InvalidDates();
        }
        bytes32 key = _batchKey(msg.sender, gtin, batchNumber);
        if (_tokenIdsByBatchKey[key] != 0) revert DuplicateBatch();

        tokenId = _nextTokenId++;
        _tokenIdsByBatchKey[key] = tokenId; // Never cleared, including after burn.
        _batches[tokenId] = MedicineBatch({
            tokenId: tokenId,
            gtin: gtin,
            batchNumber: batchNumber,
            medicineName: medicineName,
            manufacturer: msg.sender,
            manufactureDate: manufactureDate,
            expiryDate: expiryDate,
            registeredAt: uint64(block.timestamp),
            lifecycle: LifecycleStatus.ACTIVE,
            stage: CustodyStage.AT_MANUFACTURER,
            metadataCID: metadataCID
        });
        _businessTokenOperation = true;
        _safeMint(msg.sender, tokenId);
        _businessTokenOperation = false;
        emit MedicineRegistered(tokenId, msg.sender, gtin, batchNumber);
    }

    function transferOwnership(uint256 tokenId, address newOwner, bytes calldata encryptedPrice)
        external
        nonReentrant
    {
        MedicineBatch storage batch = _requireActiveBatch(tokenId);
        address currentOwner = _requireOwner(tokenId);
        if (newOwner == address(0) || newOwner == currentOwner) revert InvalidRoute();
        if (block.timestamp >= batch.expiryDate) revert ExpiredBatch();
        if (encryptedPrice.length < 29 || encryptedPrice.length > 1024) revert InvalidEncryptedPrice();

        if (batch.stage == CustodyStage.AT_MANUFACTURER) {
            _requireActiveRole(currentOwner, Role.MANUFACTURER);
            _requireActiveRole(newOwner, Role.DISTRIBUTOR);
            batch.stage = CustodyStage.AT_DISTRIBUTOR;
        } else if (batch.stage == CustodyStage.AT_DISTRIBUTOR) {
            _requireActiveRole(currentOwner, Role.DISTRIBUTOR);
            Role recipientRole = _participants[newOwner].role;
            if (recipientRole != Role.PHARMACY && recipientRole != Role.HOSPITAL) revert InvalidRoute();
            _requireActiveRole(newOwner, recipientRole);
            batch.stage = CustodyStage.AT_DISPENSER;
        } else {
            revert InvalidRoute();
        }

        _businessTokenOperation = true;
        _safeTransfer(currentOwner, newOwner, tokenId);
        _businessTokenOperation = false;
        emit CustodyTransferred(tokenId, currentOwner, newOwner, encryptedPrice);
    }

    function verifyProduct(uint256 tokenId) public view returns (VerificationStatus status, address currentOwner) {
        MedicineBatch storage batch = _batches[tokenId];
        if (batch.tokenId == 0) return (VerificationStatus.NOT_FOUND, address(0));
        if (batch.lifecycle == LifecycleStatus.CONSUMED) return (VerificationStatus.CONSUMED, address(0));
        if (batch.lifecycle == LifecycleStatus.DESTROYED) return (VerificationStatus.DESTROYED, address(0));

        currentOwner = _ownerOf(tokenId);
        if (currentOwner == address(0) || !_ownerMatchesStage(currentOwner, batch.stage)) {
            return (VerificationStatus.INVALID_OWNER, currentOwner);
        }
        if (block.timestamp >= batch.expiryDate) return (VerificationStatus.EXPIRED, currentOwner);
        return (VerificationStatus.AUTHENTIC, currentOwner);
    }

    function verifyAuthenticity(uint256 tokenId, address claimedOwner) external view returns (bool) {
        (VerificationStatus status, address currentOwner) = verifyProduct(tokenId);
        return status == VerificationStatus.AUTHENTIC && currentOwner == claimedOwner;
    }

    function getMedicine(uint256 tokenId) external view returns (MedicineBatch memory) {
        if (_batches[tokenId].tokenId == 0) revert UnknownBatch();
        return _batches[tokenId];
    }

    function getTokenId(address manufacturer, string calldata gtin, string calldata batchNumber)
        external view returns (uint256 tokenId, bool exists)
    {
        tokenId = _tokenIdsByBatchKey[_batchKey(manufacturer, gtin, batchNumber)];
        exists = tokenId != 0;
    }

    function setDocumentCID(uint256 tokenId, DocumentType documentType, string calldata cid) external nonReentrant {
        _requireActiveBatch(tokenId);
        _requireOwner(tokenId);
        if (uint8(documentType) > uint8(DocumentType.CHEMICAL_METADATA)) revert InvalidDocumentType();
        if (bytes(cid).length == 0) revert InvalidCID();
        if (!_ownerMatchesStage(msg.sender, _batches[tokenId].stage)) revert InactiveParticipant();
        _documents[tokenId][documentType] = DocumentRef(documentType, cid, msg.sender, uint64(block.timestamp));
        emit DocumentCIDUpdated(tokenId, documentType, cid, msg.sender);
    }

    function getDocument(uint256 tokenId, DocumentType documentType) external view returns (DocumentRef memory) {
        if (_batches[tokenId].tokenId == 0) revert UnknownBatch();
        if (uint8(documentType) > uint8(DocumentType.CHEMICAL_METADATA)) revert InvalidDocumentType();
        return _documents[tokenId][documentType];
    }

    function burnToken(uint256 tokenId, LifecycleStatus finalStatus) external nonReentrant {
        MedicineBatch storage batch = _requireActiveBatch(tokenId);
        address currentOwner = _requireOwner(tokenId);
        if (finalStatus != LifecycleStatus.CONSUMED && finalStatus != LifecycleStatus.DESTROYED) {
            revert InvalidFinalStatus();
        }
        Participant storage participant = _participants[currentOwner];
        if (!participant.active) revert InactiveParticipant();
        if (!_ownerMatchesStage(currentOwner, batch.stage)) revert UnauthorizedBurn();
        if (finalStatus == LifecycleStatus.CONSUMED && batch.stage != CustodyStage.AT_DISPENSER) {
            revert UnauthorizedBurn();
        }
        if (finalStatus == LifecycleStatus.CONSUMED && block.timestamp >= batch.expiryDate) {
            revert ExpiredBatch();
        }

        batch.lifecycle = finalStatus;
        lastOwnerOf[tokenId] = currentOwner;
        _businessTokenOperation = true;
        _burn(tokenId);
        _businessTokenOperation = false;
        emit TokenBurned(tokenId, currentOwner, finalStatus);
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return string.concat("ipfs://", _batches[tokenId].metadataCID);
    }

    /// @dev Guard even internal ERC-721 movement; public ERC-721 methods also revert below.
    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        if (!_businessTokenOperation) revert DirectTokenOperationDisabled();
        return super._update(to, tokenId, auth);
    }

    function transferFrom(address, address, uint256) public pure override {
        revert DirectTokenOperationDisabled();
    }
    function approve(address, uint256) public pure override {
        revert DirectTokenOperationDisabled();
    }
    function setApprovalForAll(address, bool) public pure override {
        revert DirectTokenOperationDisabled();
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }

    function _requireActiveBatch(uint256 tokenId) private view returns (MedicineBatch storage batch) {
        batch = _batches[tokenId];
        if (batch.tokenId == 0) revert UnknownBatch();
        if (batch.lifecycle != LifecycleStatus.ACTIVE) revert FinalizedBatch();
    }

    function _requireOwner(uint256 tokenId) private view returns (address currentOwner) {
        currentOwner = _ownerOf(tokenId);
        if (currentOwner != msg.sender) revert NotOwner();
    }

    function _requireActiveRole(address wallet, Role role) private view {
        Participant storage participant = _participants[wallet];
        if (!participant.active) revert InactiveParticipant();
        if (participant.role != role) revert InvalidRoute();
        if (!hasRole(_roleId(role), wallet)) revert InactiveParticipant();
    }

    function _ownerMatchesStage(address wallet, CustodyStage stage) private view returns (bool) {
        Participant storage participant = _participants[wallet];
        if (!participant.active) return false;
        Role role = participant.role;
        if (!hasRole(_roleId(role), wallet)) return false;
        if (stage == CustodyStage.AT_MANUFACTURER) return role == Role.MANUFACTURER;
        if (stage == CustodyStage.AT_DISTRIBUTOR) return role == Role.DISTRIBUTOR;
        return role == Role.PHARMACY || role == Role.HOSPITAL;
    }

    function _roleId(Role role) private pure returns (bytes32) {
        if (role == Role.MANUFACTURER) return MANUFACTURER_ROLE;
        if (role == Role.DISTRIBUTOR) return DISTRIBUTOR_ROLE;
        if (role == Role.PHARMACY) return PHARMACY_ROLE;
        if (role == Role.HOSPITAL) return HOSPITAL_ROLE;
        revert InvalidParticipant();
    }

    function _batchKey(address manufacturer, string memory gtin, string memory batchNumber)
        private pure returns (bytes32)
    {
        return keccak256(abi.encode(manufacturer, gtin, batchNumber));
    }
}

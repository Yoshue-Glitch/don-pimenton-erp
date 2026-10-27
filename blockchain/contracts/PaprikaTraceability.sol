// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title PaprikaTraceability — Don Pimentón
/// @notice Registro verificable de lotes de páprika. Solo se almacenan
///         identificadores y hashes SHA-256: los documentos completos, los
///         datos comerciales y los datos personales permanecen fuera de la cadena.
contract PaprikaTraceability is AccessControl {
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant QUALITY_ROLE = keccak256("QUALITY_ROLE");

    enum QualityStatus {
        Pending,
        Approved,
        Rejected,
        Quarantine
    }

    struct Lot {
        string lotId;
        bytes32 lotDataHash;
        bytes32 qualityCertHash;
        QualityStatus quality;
        address registeredBy;
        address qualityBy;
        uint64 registeredAt;
        uint64 updatedAt;
        uint32 version;
        bool exists;
    }

    mapping(bytes32 => Lot) private _lots;
    uint256 public totalLots;

    event LotRegistered(bytes32 indexed lotKey, string lotId, bytes32 lotDataHash, address indexed actor, uint256 timestamp);
    event LotDataUpdated(bytes32 indexed lotKey, string lotId, bytes32 previousHash, bytes32 newHash, uint32 version, address indexed actor);
    event QualityRecorded(bytes32 indexed lotKey, string lotId, QualityStatus status, bytes32 qualityCertHash, address indexed actor);

    error LotAlreadyRegistered(string lotId);
    error LotNotFound(string lotId);
    error InvalidHash();
    error InvalidLotId();
    error InvalidQualityStatus();

    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function lotKey(string memory lotId) public pure returns (bytes32) {
        return keccak256(bytes(lotId));
    }

    function registerLot(string calldata lotId, bytes32 lotDataHash) external onlyRole(REGISTRAR_ROLE) {
        if (bytes(lotId).length == 0 || bytes(lotId).length > 64) revert InvalidLotId();
        if (lotDataHash == bytes32(0)) revert InvalidHash();
        bytes32 key = lotKey(lotId);
        if (_lots[key].exists) revert LotAlreadyRegistered(lotId);

        _lots[key] = Lot({
            lotId: lotId,
            lotDataHash: lotDataHash,
            qualityCertHash: bytes32(0),
            quality: QualityStatus.Pending,
            registeredBy: msg.sender,
            qualityBy: address(0),
            registeredAt: uint64(block.timestamp),
            updatedAt: uint64(block.timestamp),
            version: 1,
            exists: true
        });
        totalLots += 1;
        emit LotRegistered(key, lotId, lotDataHash, msg.sender, block.timestamp);
    }

    function updateLotData(string calldata lotId, bytes32 newHash) external onlyRole(REGISTRAR_ROLE) {
        if (newHash == bytes32(0)) revert InvalidHash();
        Lot storage lot = _requireLot(lotId);
        bytes32 previous = lot.lotDataHash;
        lot.lotDataHash = newHash;
        lot.version += 1;
        lot.updatedAt = uint64(block.timestamp);
        emit LotDataUpdated(lotKey(lotId), lotId, previous, newHash, lot.version, msg.sender);
    }

    function recordQuality(string calldata lotId, QualityStatus status, bytes32 certHash) external onlyRole(QUALITY_ROLE) {
        if (status == QualityStatus.Pending) revert InvalidQualityStatus();
        if (status == QualityStatus.Approved && certHash == bytes32(0)) revert InvalidHash();
        Lot storage lot = _requireLot(lotId);
        lot.quality = status;
        lot.qualityCertHash = certHash;
        lot.qualityBy = msg.sender;
        lot.updatedAt = uint64(block.timestamp);
        emit QualityRecorded(lotKey(lotId), lotId, status, certHash, msg.sender);
    }

    function getLot(string calldata lotId) external view returns (Lot memory) {
        Lot storage lot = _lots[lotKey(lotId)];
        if (!lot.exists) revert LotNotFound(lotId);
        return lot;
    }

    function exists(string calldata lotId) external view returns (bool) {
        return _lots[lotKey(lotId)].exists;
    }

    function isApproved(string calldata lotId) external view returns (bool) {
        Lot storage lot = _lots[lotKey(lotId)];
        return lot.exists && lot.quality == QualityStatus.Approved;
    }

    /// @notice Compara los hashes calculados fuera de la cadena con los registrados.
    function verifyLot(string calldata lotId, bytes32 lotDataHash, bytes32 certHash)
        external
        view
        returns (bool dataMatches, bool certMatches, QualityStatus quality)
    {
        Lot storage lot = _lots[lotKey(lotId)];
        if (!lot.exists) revert LotNotFound(lotId);
        return (lot.lotDataHash == lotDataHash, lot.qualityCertHash == certHash, lot.quality);
    }

    function _requireLot(string calldata lotId) private view returns (Lot storage lot) {
        lot = _lots[lotKey(lotId)];
        if (!lot.exists) revert LotNotFound(lotId);
    }
}

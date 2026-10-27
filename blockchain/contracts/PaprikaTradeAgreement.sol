// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IPaprikaTraceability {
    function isApproved(string calldata lotId) external view returns (bool);
}

/// @title PaprikaTradeAgreement — Don Pimentón
/// @notice Acuerdo comercial con pago condicionado (escrow) usando la moneda
///         nativa FICTICIA de una red local. El importe en soles es solo una
///         referencia empresarial; no representa una transferencia bancaria.
contract PaprikaTradeAgreement is AccessControl, ReentrancyGuard {
    bytes32 public constant SELLER_ROLE = keccak256("SELLER_ROLE");
    bytes32 public constant QUALITY_ROLE = keccak256("QUALITY_ROLE");
    bytes32 public constant LOGISTICS_ROLE = keccak256("LOGISTICS_ROLE");
    bytes32 public constant ARBITER_ROLE = keccak256("ARBITER_ROLE");

    enum State {
        None,
        Proposed,
        Accepted,
        Funded,
        Completed,
        Cancelled,
        Refunded,
        Disputed
    }
    enum QualityState {
        Pending,
        Approved,
        Rejected
    }
    enum DeliveryState {
        Pending,
        Delivered,
        Confirmed
    }

    struct Agreement {
        string agreementId;
        string lotId;
        address seller;
        address buyer;
        uint256 quantityKg;
        uint256 amountWei;
        uint256 referencePenCents;
        uint64 deadline;
        uint64 createdAt;
        State state;
        QualityState quality;
        DeliveryState delivery;
        bytes32 qualityCertHash;
        bytes32 deliveryEvidenceHash;
        uint256 deposited;
    }

    IPaprikaTraceability public immutable traceability;

    mapping(bytes32 => Agreement) private _agreements;
    /// lote => acuerdo que lo compromete (impide vender el mismo lote dos veces)
    mapping(bytes32 => bytes32) public lotCommitment;
    uint256 public totalAgreements;

    event AgreementCreated(bytes32 indexed key, string agreementId, string lotId, address indexed seller, address indexed buyer, uint256 amountWei, uint256 referencePenCents, uint64 deadline);
    event AgreementAccepted(bytes32 indexed key, string agreementId, address indexed buyer);
    event FundsDeposited(bytes32 indexed key, string agreementId, address indexed buyer, uint256 amountWei);
    event QualityRecorded(bytes32 indexed key, string agreementId, bool approved, bytes32 certHash, address indexed actor);
    event DeliveryRecorded(bytes32 indexed key, string agreementId, bytes32 evidenceHash, address indexed actor);
    event ReceiptConfirmed(bytes32 indexed key, string agreementId, address indexed buyer);
    event PaymentReleased(bytes32 indexed key, string agreementId, address indexed seller, uint256 amountWei);
    event AgreementCancelled(bytes32 indexed key, string agreementId, address indexed actor, string reason);
    event FundsRefunded(bytes32 indexed key, string agreementId, address indexed buyer, uint256 amountWei);
    event DisputeOpened(bytes32 indexed key, string agreementId, address indexed actor, bytes32 reasonHash);
    event DisputeResolved(bytes32 indexed key, string agreementId, bool releasedToSeller, address indexed arbiter);

    error AgreementExists(string agreementId);
    error AgreementNotFound(string agreementId);
    error LotAlreadyCommitted(string lotId);
    error InvalidParameters();
    error InvalidState(State current);
    error NotBuyer();
    error NotParty();
    error WrongAmount(uint256 expected, uint256 received);
    error QualityAlreadyRecorded();
    error LotNotApprovedOnChain(string lotId);
    error QualityNotApproved();
    error DeliveryNotRecorded();
    error DeliveryNotConfirmed();
    error CancellationNotAllowed();
    error TransferFailed();

    constructor(address admin, address traceabilityAddress) {
        if (traceabilityAddress == address(0)) revert InvalidParameters();
        traceability = IPaprikaTraceability(traceabilityAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function keyOf(string memory id) public pure returns (bytes32) {
        return keccak256(bytes(id));
    }

    // ---------------------------------------------------------------- flujo

    function createAgreement(
        string calldata agreementId,
        string calldata lotId,
        address buyer,
        uint256 quantityKg,
        uint256 amountWei,
        uint256 referencePenCents,
        uint64 deadline
    ) external onlyRole(SELLER_ROLE) {
        if (
            bytes(agreementId).length == 0 || bytes(lotId).length == 0 || buyer == address(0) || buyer == msg.sender
                || quantityKg == 0 || amountWei == 0 || deadline <= block.timestamp
        ) revert InvalidParameters();
        bytes32 key = keyOf(agreementId);
        if (_agreements[key].state != State.None) revert AgreementExists(agreementId);
        bytes32 lk = keyOf(lotId);
        if (lotCommitment[lk] != bytes32(0)) revert LotAlreadyCommitted(lotId);

        Agreement storage a = _agreements[key];
        a.agreementId = agreementId;
        a.lotId = lotId;
        a.seller = msg.sender;
        a.buyer = buyer;
        a.quantityKg = quantityKg;
        a.amountWei = amountWei;
        a.referencePenCents = referencePenCents;
        a.deadline = deadline;
        a.createdAt = uint64(block.timestamp);
        a.state = State.Proposed;
        lotCommitment[lk] = key;
        totalAgreements += 1;

        emit AgreementCreated(key, agreementId, lotId, msg.sender, buyer, amountWei, referencePenCents, deadline);
    }

    function acceptAgreement(string calldata agreementId) external {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        if (msg.sender != a.buyer) revert NotBuyer();
        if (a.state != State.Proposed) revert InvalidState(a.state);
        a.state = State.Accepted;
        emit AgreementAccepted(key, agreementId, msg.sender);
    }

    function depositFunds(string calldata agreementId) external payable {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        if (msg.sender != a.buyer) revert NotBuyer();
        if (a.state != State.Accepted) revert InvalidState(a.state);
        if (msg.value != a.amountWei) revert WrongAmount(a.amountWei, msg.value);
        a.deposited = msg.value;
        a.state = State.Funded;
        emit FundsDeposited(key, agreementId, msg.sender, msg.value);
    }

    function recordQuality(string calldata agreementId, bool approved, bytes32 certHash) external onlyRole(QUALITY_ROLE) {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        if (a.state != State.Funded) revert InvalidState(a.state);
        if (a.quality != QualityState.Pending) revert QualityAlreadyRecorded();
        if (approved) {
            if (certHash == bytes32(0)) revert InvalidParameters();
            if (!traceability.isApproved(a.lotId)) revert LotNotApprovedOnChain(a.lotId);
            a.quality = QualityState.Approved;
        } else {
            a.quality = QualityState.Rejected;
        }
        a.qualityCertHash = certHash;
        emit QualityRecorded(key, agreementId, approved, certHash, msg.sender);
    }

    function recordDelivery(string calldata agreementId, bytes32 evidenceHash) external onlyRole(LOGISTICS_ROLE) {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        if (a.state != State.Funded) revert InvalidState(a.state);
        if (a.quality != QualityState.Approved) revert QualityNotApproved();
        if (a.delivery != DeliveryState.Pending) revert InvalidParameters();
        if (evidenceHash == bytes32(0)) revert InvalidParameters();
        a.delivery = DeliveryState.Delivered;
        a.deliveryEvidenceHash = evidenceHash;
        emit DeliveryRecorded(key, agreementId, evidenceHash, msg.sender);
    }

    function confirmReceipt(string calldata agreementId) external {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        if (msg.sender != a.buyer) revert NotBuyer();
        if (a.state != State.Funded) revert InvalidState(a.state);
        if (a.delivery != DeliveryState.Delivered) revert DeliveryNotRecorded();
        a.delivery = DeliveryState.Confirmed;
        emit ReceiptConfirmed(key, agreementId, msg.sender);
    }

    /// @notice Libera los fondos de prueba al vendedor si se cumplen TODAS las condiciones.
    function releasePayment(string calldata agreementId) external nonReentrant {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        if (msg.sender != a.buyer && msg.sender != a.seller) revert NotParty();
        if (a.state != State.Funded) revert InvalidState(a.state);
        if (a.quality != QualityState.Approved) revert QualityNotApproved();
        if (a.delivery != DeliveryState.Confirmed) revert DeliveryNotConfirmed();

        uint256 amount = a.deposited;
        a.deposited = 0;
        a.state = State.Completed;
        emit PaymentReleased(key, agreementId, a.seller, amount);
        _send(a.seller, amount);
    }

    /// @notice Reglas de cancelación:
    ///  - Propuesto/Aceptado (sin fondos): comprador o vendedor.
    ///  - Con fondos: el vendedor puede desistir y devolver; el comprador puede
    ///    cancelar si la calidad fue rechazada o si venció el plazo sin
    ///    confirmación de entrega. En ambos casos se reembolsa al comprador.
    function cancelAgreement(string calldata agreementId, string calldata reason) external nonReentrant {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        bool isBuyer = msg.sender == a.buyer;
        bool isSeller = msg.sender == a.seller;
        if (!isBuyer && !isSeller) revert NotParty();

        if (a.state == State.Proposed || a.state == State.Accepted) {
            a.state = State.Cancelled;
            delete lotCommitment[keyOf(a.lotId)];
            emit AgreementCancelled(key, agreementId, msg.sender, reason);
            return;
        }
        if (a.state != State.Funded) revert InvalidState(a.state);

        bool allowed = isSeller || a.quality == QualityState.Rejected
            || (block.timestamp > a.deadline && a.delivery != DeliveryState.Confirmed);
        if (!allowed) revert CancellationNotAllowed();

        uint256 amount = a.deposited;
        a.deposited = 0;
        a.state = State.Refunded;
        delete lotCommitment[keyOf(a.lotId)];
        emit AgreementCancelled(key, agreementId, msg.sender, reason);
        emit FundsRefunded(key, agreementId, a.buyer, amount);
        _send(a.buyer, amount);
    }

    function openDispute(string calldata agreementId, bytes32 reasonHash) external {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        if (msg.sender != a.buyer && msg.sender != a.seller) revert NotParty();
        if (a.state != State.Funded) revert InvalidState(a.state);
        a.state = State.Disputed;
        emit DisputeOpened(key, agreementId, msg.sender, reasonHash);
    }

    /// @notice El árbitro (Gerencia) resuelve. Nunca libera al vendedor si la calidad no fue aprobada.
    function resolveDispute(string calldata agreementId, bool releaseToSeller) external onlyRole(ARBITER_ROLE) nonReentrant {
        (bytes32 key, Agreement storage a) = _get(agreementId);
        if (a.state != State.Disputed) revert InvalidState(a.state);
        uint256 amount = a.deposited;
        a.deposited = 0;
        if (releaseToSeller) {
            if (a.quality != QualityState.Approved) revert QualityNotApproved();
            a.state = State.Completed;
            emit DisputeResolved(key, agreementId, true, msg.sender);
            emit PaymentReleased(key, agreementId, a.seller, amount);
            _send(a.seller, amount);
        } else {
            a.state = State.Refunded;
            delete lotCommitment[keyOf(a.lotId)];
            emit DisputeResolved(key, agreementId, false, msg.sender);
            emit FundsRefunded(key, agreementId, a.buyer, amount);
            _send(a.buyer, amount);
        }
    }

    // ---------------------------------------------------------------- lectura

    function getAgreement(string calldata agreementId) external view returns (Agreement memory) {
        Agreement storage a = _agreements[keyOf(agreementId)];
        if (a.state == State.None) revert AgreementNotFound(agreementId);
        return a;
    }

    function canRelease(string calldata agreementId) external view returns (bool ok, string memory reason) {
        Agreement storage a = _agreements[keyOf(agreementId)];
        if (a.state == State.None) return (false, "Acuerdo inexistente");
        if (a.state != State.Funded) return (false, "El acuerdo no esta fondeado");
        if (a.quality != QualityState.Approved) return (false, "Calidad no aprobada");
        if (a.delivery != DeliveryState.Confirmed) return (false, "Entrega no confirmada por el comprador");
        return (true, "Condiciones cumplidas");
    }

    // ---------------------------------------------------------------- internos

    function _get(string calldata agreementId) private view returns (bytes32 key, Agreement storage a) {
        key = keyOf(agreementId);
        a = _agreements[key];
        if (a.state == State.None) revert AgreementNotFound(agreementId);
    }

    function _send(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TrustoraEscrow
 * @author TRUSTORA Team
 * @notice Programmable smart-contract escrow for USDC milestone payments on Arc Testnet.
 * @dev Enforces multi-milestone escrow lifecycle with non-releasable by AI guarantee.
 * Funds can only be released by authorized human clients or resolved by designated arbiters.
 */
contract TrustoraEscrow is ReentrancyGuard, Pausable, Ownable {
    using SafeERC20 for IERC20;

    /// @notice Milestone Lifecycle States
    enum MilestoneState {
        Unfunded,          // 0: Milestone created, not yet funded
        Funded,            // 1: Client deposited USDC into escrow
        Submitted,         // 2: Freelancer submitted deliverable for review
        RevisionRequested, // 3: Client requested changes to deliverable
        Approved,          // 4: Client approved deliverable
        Released,          // 5: Escrow funds disbursed to freelancer
        Disputed,          // 6: Either party opened formal dispute
        Refunded           // 7: Funds returned to client
    }

    struct Milestone {
        uint256 id;
        bytes32 criteriaHash;      // SHA-256 of frozen acceptance criteria
        uint256 amount;            // Amount in base USDC units (6 decimals)
        MilestoneState state;
        bytes32 deliverableHash;   // SHA-256 of submitted deliverable
        string deliverableUri;     // Encrypted or decentralized storage URI
        uint64 fundedAt;
        uint64 submittedAt;
        uint64 resolvedAt;
    }

    struct Project {
        bytes32 projectId;         // Unique project hash (e.g., TRU-PROJ-YYYY-XXXX)
        address client;            // Escrow funder and approval authority
        address freelancer;        // Deliverable producer and payment recipient
        address arbiter;           // Designated dispute mediator
        uint256 milestoneCount;
        bool exists;
        uint64 createdAt;
    }

    /// @notice Official USDC Token contract on Arc Testnet
    IERC20 public immutable usdcToken;

    /// @notice Projects mapping: projectId => Project
    mapping(bytes32 => Project) public projects;

    /// @notice Milestones mapping: projectId => milestoneId => Milestone
    mapping(bytes32 => mapping(uint256 => Milestone)) public milestones;

    // --- Events ---
    event ProjectCreated(
        bytes32 indexed projectId,
        address indexed client,
        address indexed freelancer,
        address arbiter,
        uint64 createdAt
    );

    event MilestoneAdded(
        bytes32 indexed projectId,
        uint256 indexed milestoneId,
        bytes32 criteriaHash,
        uint256 amount
    );

    event MilestoneFunded(
        bytes32 indexed projectId,
        uint256 indexed milestoneId,
        address indexed client,
        uint256 amount,
        uint64 fundedAt
    );

    event MilestoneSubmitted(
        bytes32 indexed projectId,
        uint256 indexed milestoneId,
        address indexed freelancer,
        bytes32 deliverableHash,
        string deliverableUri,
        uint64 submittedAt
    );

    event RevisionRequested(
        bytes32 indexed projectId,
        uint256 indexed milestoneId,
        address indexed client,
        string reason
    );

    event MilestoneReleased(
        bytes32 indexed projectId,
        uint256 indexed milestoneId,
        address indexed freelancer,
        uint256 amount,
        uint64 releasedAt
    );

    event MilestoneRefunded(
        bytes32 indexed projectId,
        uint256 indexed milestoneId,
        address indexed client,
        uint256 amount,
        uint64 refundedAt
    );

    event MilestoneDisputed(
        bytes32 indexed projectId,
        uint256 indexed milestoneId,
        address indexed initiator,
        string reason,
        uint64 disputedAt
    );

    event DisputeResolved(
        bytes32 indexed projectId,
        uint256 indexed milestoneId,
        address indexed arbiter,
        uint256 releasedToFreelancer,
        uint256 refundedToClient,
        uint64 resolvedAt
    );

    // --- Custom Errors ---
    error ProjectAlreadyExists(bytes32 projectId);
    error ProjectDoesNotExist(bytes32 projectId);
    error InvalidAddress();
    error InvalidAmount();
    error InvalidStateTransition(MilestoneState current, MilestoneState target);
    error OnlyClientAllowed(address caller, address client);
    error OnlyFreelancerAllowed(address caller, address freelancer);
    error OnlyArbiterAllowed(address caller, address arbiter);
    error OnlyClientOrFreelancerAllowed();
    error MilestoneAlreadyExists(uint256 milestoneId);
    error MilestoneNotFound(uint256 milestoneId);
    error DisputeShareMismatch(uint256 totalSplit, uint256 milestoneAmount);

    /**
     * @notice Constructor sets the USDC ERC-20 contract and contract owner.
     * @param _usdc Address of official USDC ERC-20 token on Arc Testnet
     */
    constructor(address _usdc) Ownable(msg.sender) {
        if (_usdc == address(0)) revert InvalidAddress();
        usdcToken = IERC20(_usdc);
    }

    // --- Modifiers ---
    modifier projectExists(bytes32 _projectId) {
        if (!projects[_projectId].exists) revert ProjectDoesNotExist(_projectId);
        _;
    }

    modifier onlyClient(bytes32 _projectId) {
        if (msg.sender != projects[_projectId].client) {
            revert OnlyClientAllowed(msg.sender, projects[_projectId].client);
        }
        _;
    }

    modifier onlyFreelancer(bytes32 _projectId) {
        if (msg.sender != projects[_projectId].freelancer) {
            revert OnlyFreelancerAllowed(msg.sender, projects[_projectId].freelancer);
        }
        _;
    }

    /**
     * @notice Registers a new project in the escrow system.
     * @param _projectId Unique identifier hash for the project
     * @param _freelancer Address of the work producer
     * @param _arbiter Optional address for dispute mediation (defaults to owner if address(0))
     */
    function createProject(
        bytes32 _projectId,
        address _freelancer,
        address _arbiter
    ) external whenNotPaused {
        if (_projectId == bytes32(0)) revert ProjectDoesNotExist(_projectId);
        if (_freelancer == address(0) || _freelancer == msg.sender) revert InvalidAddress();
        if (projects[_projectId].exists) revert ProjectAlreadyExists(_projectId);

        address arbiterAddress = _arbiter == address(0) ? owner() : _arbiter;

        projects[_projectId] = Project({
            projectId: _projectId,
            client: msg.sender,
            freelancer: _freelancer,
            arbiter: arbiterAddress,
            milestoneCount: 0,
            exists: true,
            createdAt: uint64(block.timestamp)
        });

        emit ProjectCreated(_projectId, msg.sender, _freelancer, arbiterAddress, uint64(block.timestamp));
    }

    /**
     * @notice Adds an unfunded milestone with frozen acceptance criteria to a project.
     * @param _projectId Unique project identifier
     * @param _criteriaHash SHA-256 hash of agreed acceptance criteria document
     * @param _amount Amount of USDC to be locked upon funding (base units, 6 decimals)
     */
    function addMilestone(
        bytes32 _projectId,
        bytes32 _criteriaHash,
        uint256 _amount
    ) external projectExists(_projectId) onlyClient(_projectId) whenNotPaused returns (uint256) {
        if (_amount == 0) revert InvalidAmount();

        Project storage proj = projects[_projectId];
        uint256 newMilestoneId = proj.milestoneCount + 1;
        proj.milestoneCount = newMilestoneId;

        milestones[_projectId][newMilestoneId] = Milestone({
            id: newMilestoneId,
            criteriaHash: _criteriaHash,
            amount: _amount,
            state: MilestoneState.Unfunded,
            deliverableHash: bytes32(0),
            deliverableUri: "",
            fundedAt: 0,
            submittedAt: 0,
            resolvedAt: 0
        });

        emit MilestoneAdded(_projectId, newMilestoneId, _criteriaHash, _amount);
        return newMilestoneId;
    }

    /**
     * @notice Client deposits USDC into escrow for a specific milestone.
     * @dev Transfers USDC tokens using SafeERC20. Requires prior ERC-20 approval.
     * @param _projectId Unique project identifier
     * @param _milestoneId Milestone ID to fund
     */
    function fundMilestone(
        bytes32 _projectId,
        uint256 _milestoneId
    ) external projectExists(_projectId) onlyClient(_projectId) nonReentrant whenNotPaused {
        Milestone storage m = milestones[_projectId][_milestoneId];
        if (m.amount == 0) revert MilestoneNotFound(_milestoneId);
        if (m.state != MilestoneState.Unfunded) {
            revert InvalidStateTransition(m.state, MilestoneState.Funded);
        }

        m.state = MilestoneState.Funded;
        m.fundedAt = uint64(block.timestamp);

        // Safe transfer of USDC from client to this contract
        usdcToken.safeTransferFrom(msg.sender, address(this), m.amount);

        emit MilestoneFunded(_projectId, _milestoneId, msg.sender, m.amount, m.fundedAt);
    }

    /**
     * @notice Freelancer submits deliverable evidence (code hash, IPFS URI).
     * @param _projectId Unique project identifier
     * @param _milestoneId Milestone ID
     * @param _deliverableHash SHA-256 hash of deliverable bundle
     * @param _deliverableUri Storage URI of deliverable
     */
    function submitMilestoneWork(
        bytes32 _projectId,
        uint256 _milestoneId,
        bytes32 _deliverableHash,
        string calldata _deliverableUri
    ) external projectExists(_projectId) onlyFreelancer(_projectId) whenNotPaused {
        Milestone storage m = milestones[_projectId][_milestoneId];
        if (m.state != MilestoneState.Funded && m.state != MilestoneState.RevisionRequested) {
            revert InvalidStateTransition(m.state, MilestoneState.Submitted);
        }

        m.state = MilestoneState.Submitted;
        m.deliverableHash = _deliverableHash;
        m.deliverableUri = _deliverableUri;
        m.submittedAt = uint64(block.timestamp);

        emit MilestoneSubmitted(
            _projectId,
            _milestoneId,
            msg.sender,
            _deliverableHash,
            _deliverableUri,
            m.submittedAt
        );
    }

    /**
     * @notice Client requests revisions if deliverable does not satisfy acceptance criteria.
     * @param _projectId Unique project identifier
     * @param _milestoneId Milestone ID
     * @param _reason Clear description of required revisions
     */
    function requestRevision(
        bytes32 _projectId,
        uint256 _milestoneId,
        string calldata _reason
    ) external projectExists(_projectId) onlyClient(_projectId) whenNotPaused {
        Milestone storage m = milestones[_projectId][_milestoneId];
        if (m.state != MilestoneState.Submitted) {
            revert InvalidStateTransition(m.state, MilestoneState.RevisionRequested);
        }

        m.state = MilestoneState.RevisionRequested;
        emit RevisionRequested(_projectId, _milestoneId, msg.sender, _reason);
    }

    /**
     * @notice Releases escrowed milestone funds to the freelancer upon client approval.
     * @dev Non-releasable by AI guarantee: only the human client can trigger this directly.
     * @param _projectId Unique project identifier
     * @param _milestoneId Milestone ID
     */
    function releaseMilestone(
        bytes32 _projectId,
        uint256 _milestoneId
    ) external projectExists(_projectId) onlyClient(_projectId) nonReentrant whenNotPaused {
        Milestone storage m = milestones[_projectId][_milestoneId];
        if (m.state != MilestoneState.Submitted) {
            revert InvalidStateTransition(m.state, MilestoneState.Released);
        }

        m.state = MilestoneState.Released;
        m.resolvedAt = uint64(block.timestamp);

        address freelancer = projects[_projectId].freelancer;
        uint256 payout = m.amount;

        usdcToken.safeTransfer(freelancer, payout);

        emit MilestoneReleased(_projectId, _milestoneId, freelancer, payout, m.resolvedAt);
    }

    /**
     * @notice Either client or freelancer can initiate a dispute if agreement breaks down.
     * @param _projectId Unique project identifier
     * @param _milestoneId Milestone ID
     * @param _reason Explanation of the dispute
     */
    function disputeMilestone(
        bytes32 _projectId,
        uint256 _milestoneId,
        string calldata _reason
    ) external projectExists(_projectId) whenNotPaused {
        Project storage proj = projects[_projectId];
        if (msg.sender != proj.client && msg.sender != proj.freelancer) {
            revert OnlyClientOrFreelancerAllowed();
        }

        Milestone storage m = milestones[_projectId][_milestoneId];
        if (m.state != MilestoneState.Funded &&
            m.state != MilestoneState.Submitted &&
            m.state != MilestoneState.RevisionRequested) {
            revert InvalidStateTransition(m.state, MilestoneState.Disputed);
        }

        m.state = MilestoneState.Disputed;
        emit MilestoneDisputed(_projectId, _milestoneId, msg.sender, _reason, uint64(block.timestamp));
    }

    /**
     * @notice Designated arbiter settles a disputed milestone, splitting funds if applicable.
     * @param _projectId Unique project identifier
     * @param _milestoneId Milestone ID
     * @param _releaseToFreelancer Amount to disburse to freelancer (base units)
     * @param _refundToClient Amount to return to client (base units)
     */
    function resolveDispute(
        bytes32 _projectId,
        uint256 _milestoneId,
        uint256 _releaseToFreelancer,
        uint256 _refundToClient
    ) external projectExists(_projectId) nonReentrant whenNotPaused {
        Project storage proj = projects[_projectId];
        if (msg.sender != proj.arbiter) {
            revert OnlyArbiterAllowed(msg.sender, proj.arbiter);
        }

        Milestone storage m = milestones[_projectId][_milestoneId];
        if (m.state != MilestoneState.Disputed) {
            revert InvalidStateTransition(m.state, MilestoneState.Released);
        }

        if (_releaseToFreelancer + _refundToClient != m.amount) {
            revert DisputeShareMismatch(_releaseToFreelancer + _refundToClient, m.amount);
        }

        m.state = _releaseToFreelancer > 0 ? MilestoneState.Released : MilestoneState.Refunded;
        m.resolvedAt = uint64(block.timestamp);

        if (_releaseToFreelancer > 0) {
            usdcToken.safeTransfer(proj.freelancer, _releaseToFreelancer);
        }
        if (_refundToClient > 0) {
            usdcToken.safeTransfer(proj.client, _refundToClient);
        }

        emit DisputeResolved(
            _projectId,
            _milestoneId,
            msg.sender,
            _releaseToFreelancer,
            _refundToClient,
            m.resolvedAt
        );
    }

    /**
     * @notice Freelancer can voluntarily refund funded milestone back to client.
     * @param _projectId Unique project identifier
     * @param _milestoneId Milestone ID
     */
    function refundMilestone(
        bytes32 _projectId,
        uint256 _milestoneId
    ) external projectExists(_projectId) onlyFreelancer(_projectId) nonReentrant whenNotPaused {
        Milestone storage m = milestones[_projectId][_milestoneId];
        if (m.state != MilestoneState.Funded &&
            m.state != MilestoneState.Submitted &&
            m.state != MilestoneState.RevisionRequested) {
            revert InvalidStateTransition(m.state, MilestoneState.Refunded);
        }

        m.state = MilestoneState.Refunded;
        m.resolvedAt = uint64(block.timestamp);

        address client = projects[_projectId].client;
        uint256 refundAmount = m.amount;

        usdcToken.safeTransfer(client, refundAmount);

        emit MilestoneRefunded(_projectId, _milestoneId, client, refundAmount, m.resolvedAt);
    }

    // --- View Functions ---

    function getProject(bytes32 _projectId) external view returns (Project memory) {
        return projects[_projectId];
    }

    function getMilestone(bytes32 _projectId, uint256 _milestoneId) external view returns (Milestone memory) {
        return milestones[_projectId][_milestoneId];
    }

    function getMilestoneState(bytes32 _projectId, uint256 _milestoneId) external view returns (MilestoneState) {
        return milestones[_projectId][_milestoneId].state;
    }

    // --- Admin Emergency Controls ---

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}

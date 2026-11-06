import type {
  CriterionStatus,
  IntegrationStatus,
  MilestoneStatus,
} from "./enums.js";

export interface IntegrationHealth {
  status: IntegrationStatus;
  detail: string;
  checkedAt: string;
}

/** M2-DEFINED, not in contract v3, announced to team */
export interface EscrowState {
  milestoneId: string;
  client: string;
  freelancer: string;
  arbiter: string;
  token: string;
  /** Base units, never a number. */
  amount: string;
  agreementHash: string;
  deliverableHash?: string;
  deadline: string;
  status: MilestoneStatus;
}

/** M2-DEFINED, not in contract v3, announced to team */
export interface VerifiedChainEvent {
  txHash: string;
  chainId: number;
  contractAddress: string;
  milestoneId: string;
  /** Base units, never a number. */
  amount: string;
  token: string;
  freelancer: string;
  agreementHash: string;
  blockNumber: number;
  verified: boolean;
  explorerUrl?: string;
}

/** M2-DEFINED, not in contract v3, announced to team */
export interface EvaluationInput {
  criteria: string[];
  criteriaVersion: string;
  submissionDescriptor: string;
  submissionHash: string;
  consent: boolean;
}

export interface EvaluationResult {
  overall: CriterionStatus;
  criteria: {
    criterion: string;
    status: CriterionStatus;
    evidence: string;
  }[];
  limitations: string[];
  suggestedRevisions: string[];
  criteriaVersion: string;
  submissionHash: string;
  modelId: string;
  promptHash: string;
  /** An INFERENCE_REQUEST_ID. Never a transaction hash. */
  requestId: string;
  reportHash: string;
}

/** M2-DEFINED, not in contract v3, announced to team */
export interface AgentPaymentRequest {
  providerPayTo: string;
  /** Base units, never a number. */
  amount: string;
  network: string;
  asset: string;
  resourceUrl: string;
}

/** M2-DEFINED, not in contract v3, announced to team */
export interface AgentPaymentResult {
  status: string;
  settlementRef?: string;
  reason?: string;
}

/** M2-DEFINED, not in contract v3, announced to team */
export interface VerifiedSettlement {
  ref: string;
  verified: boolean;
  network: string;
}

export interface EscrowAdapter {
  getConfig(): {
    chainId: number;
    rpcUrl: string;
    escrowAddress: string;
    tokenAddress: string;
    explorerBase: string;
  };
  verifyFunding(milestoneId: string, txHash: string): Promise<VerifiedChainEvent>;
  verifyRelease(milestoneId: string, txHash: string): Promise<VerifiedChainEvent>;
  readEscrow(milestoneId: string): Promise<EscrowState>;
  health(): Promise<IntegrationHealth>;
}

export interface EvaluationAdapter {
  evaluate(input: EvaluationInput): Promise<EvaluationResult>;
  health(): Promise<IntegrationHealth>;
}

export interface AgentPaymentAdapter {
  payForService(req: AgentPaymentRequest): Promise<AgentPaymentResult>;
  verifySettlement(ref: string): Promise<VerifiedSettlement>;
  health(): Promise<IntegrationHealth>;
}

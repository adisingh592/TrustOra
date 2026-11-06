// Test doubles only. Production wiring must never import these.
import type { EscrowAdapter, EscrowState, IntegrationHealth, VerifiedChainEvent } from "@trustora/shared";
import {
  DuplicateEventError,
  type EventStore,
  type NaturalKey,
  type NewEvent,
  type StoredEvent,
  type VerificationUpdate,
} from "./types.js";

export class MOCK_InMemoryEventStore implements EventStore {
  readonly events = new Map<string, StoredEvent>();
  private sequence = 0;

  private keyOf(key: NaturalKey) {
    return `${key.referenceType}|${key.referenceValue}|${key.eventType}`;
  }

  async insert(event: NewEvent) {
    for (const existing of this.events.values()) {
      if (this.keyOf(existing) === this.keyOf(event)) throw new DuplicateEventError();
    }
    this.sequence += 1;
    const stored: StoredEvent = { ...event, id: `MOCK_event_${String(this.sequence).padStart(4, "0")}` };
    this.events.set(stored.id, stored);
    return { ...stored };
  }

  async findByNaturalKey(key: NaturalKey) {
    for (const event of this.events.values()) {
      if (this.keyOf(event) === this.keyOf(key)) return { ...event };
    }
    return null;
  }

  async listByProject(publicProjectId: string) {
    return [...this.events.values()]
      .filter((event) => event.publicProjectId === publicProjectId)
      .map((event) => ({ ...event }));
  }

  async getById(id: string) {
    const event = this.events.get(id);
    return event ? { ...event } : null;
  }

  async updateVerification(id: string, update: VerificationUpdate) {
    const event = this.events.get(id);
    if (!event) throw new Error("MOCK_InMemoryEventStore: unknown event");
    const updated = { ...event, ...update };
    this.events.set(id, updated);
    return { ...updated };
  }
}

export interface MOCK_ChainAdapterOptions {
  config: ReturnType<EscrowAdapter["getConfig"]>;
  chainEvent?: VerifiedChainEvent;
  escrow?: EscrowState;
  /** Makes every chain read fail, like an RPC outage. */
  fail?: Error;
}

/** Returns canned answers. Holds no RPC client and makes no network call. */
export class MOCK_ChainAdapter implements EscrowAdapter {
  readonly calls: string[] = [];

  constructor(private readonly options: MOCK_ChainAdapterOptions) {}

  getConfig() {
    return this.options.config;
  }

  private read<T>(name: string, value: T | undefined): Promise<T> {
    this.calls.push(name);
    if (this.options.fail) return Promise.reject(this.options.fail);
    if (value === undefined) return Promise.reject(new Error(`MOCK_ChainAdapter: no ${name} set`));
    return Promise.resolve(value);
  }

  verifyFunding() {
    return this.read("verifyFunding", this.options.chainEvent);
  }

  verifyRelease() {
    return this.read("verifyRelease", this.options.chainEvent);
  }

  readEscrow() {
    return this.read("readEscrow", this.options.escrow);
  }

  async health(): Promise<IntegrationHealth> {
    return { status: "NOT_CONFIGURED", detail: "MOCK adapter", checkedAt: new Date().toISOString() };
  }
}

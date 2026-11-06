// Test double only. Production wiring must never import this.
import { randomBytes } from "node:crypto";
import {
  type AnchorAdapter,
  AnchorError,
  type AnchorErrorCode,
  type AnchorPayload,
  AnchorPayloadSchema,
  type AnchorReadResult,
  type PublishedAnchor,
} from "@trustora/shared";

interface MockEntity {
  owner: string;
  payload: AnchorPayload;
  state: "live" | "expired";
}

/** In memory, with no network. Keys are random and exist only inside this object. */
export class MOCK_AnchorAdapter implements AnchorAdapter {
  readonly anchorAddress: string;
  readonly network = "MOCK_ARKIV_NETWORK";
  readonly published: AnchorPayload[] = [];
  private readonly entities = new Map<string, MockEntity>();

  /** Set to make calls fail, like an outage. */
  publishFailure: AnchorErrorCode | null = null;
  readFailure: AnchorErrorCode | Error | null = null;
  /** Set to make readAnchor never answer. */
  hangOnRead = false;

  constructor(anchorAddress = `0x${"a".repeat(40)}`) {
    this.anchorAddress = anchorAddress;
  }

  async publishAnchor(payload: AnchorPayload): Promise<PublishedAnchor> {
    if (this.publishFailure) throw new AnchorError(this.publishFailure);
    const parsed = AnchorPayloadSchema.parse(payload);
    const entityKey = `0x${randomBytes(32).toString("hex")}`;
    this.entities.set(entityKey, { owner: this.anchorAddress, payload: parsed, state: "live" });
    this.published.push(parsed);
    return { entityKey, expiresAt: "2099-01-01T00:00:00.000Z" };
  }

  async readAnchor(entityKey: string): Promise<AnchorReadResult> {
    if (this.hangOnRead) return new Promise(() => undefined);
    if (this.readFailure) {
      throw typeof this.readFailure === "string" ? new AnchorError(this.readFailure) : this.readFailure;
    }
    const entity = this.entities.get(entityKey);
    if (!entity) return { status: "not_found" };
    if (entity.state === "expired") return { status: "expired" };
    return {
      status: "found",
      ownerAddress: entity.owner,
      payload: entity.payload,
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
  }

  /** Test controls. */
  setOwner(entityKey: string, owner: string) {
    this.entities.get(entityKey)!.owner = owner;
  }

  tamper(entityKey: string, change: Partial<AnchorPayload>) {
    const entity = this.entities.get(entityKey)!;
    entity.payload = { ...entity.payload, ...change };
  }

  expire(entityKey: string) {
    this.entities.get(entityKey)!.state = "expired";
  }

  remove(entityKey: string) {
    this.entities.delete(entityKey);
  }
}

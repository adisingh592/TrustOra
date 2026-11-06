import type { Ecosystem } from "@trustora/shared";
import { sortEvents } from "./ordering.js";
import type { StoredEvent, TimelineFilter, TimelineItem } from "./types.js";

export const explorerUrlFor = (
  event: StoredEvent,
  templates: Partial<Record<Ecosystem, string>> = {},
): string | null => {
  const template = templates[event.ecosystem];
  return template
    ? template.replaceAll("{reference}", encodeURIComponent(event.referenceValue))
    : null;
};

/** Formats a stored event into a sanitized, user-facing timeline item. */
export const toTimelineItem = (
  event: StoredEvent,
  templates: Partial<Record<Ecosystem, string>> = {},
): TimelineItem => ({
  id: event.id,
  type: event.eventType,
  ecosystem: event.ecosystem,
  network: event.network,
  referenceType: event.referenceType,
  reference: event.referenceValue,
  status: event.verificationStatus,
  statusReason: event.statusReason,
  lastCheckedAt: event.lastCheckedAt?.toISOString() ?? null,
  occurredAt: event.occurredAt.toISOString(),
  explorerUrl: explorerUrlFor(event, templates),
  summary: event.summary,
});

/**
 * Builds a deterministic chronological timeline for a project,
 * supporting optional milestone-specific filtering.
 */
export const buildTimeline = (
  events: readonly StoredEvent[],
  filter?: TimelineFilter,
  templates: Partial<Record<Ecosystem, string>> = {},
): TimelineItem[] => {
  let filtered = events;
  if (filter?.milestoneId !== undefined) {
    filtered = filtered.filter((event) => event.milestoneId === filter.milestoneId);
  }
  return sortEvents(filtered).map((event) => toTimelineItem(event, templates));
};

type LocationMode = "mine" | "theirs";

type SnapshotService = {
  name: string;
  locationMode: LocationMode;
  ownerAddress: string | null;
  meetingLink?: string | null;
};

/** Resolve mutable service settings into immutable booking presentation data. */
export function snapshotBookingService(
  service: SnapshotService,
  clientAddress?: string | null,
) {
  const normalizedClientAddress = clientAddress?.trim() || null;
  const normalizedOwnerAddress = service.ownerAddress?.trim() || null;
  const normalizedMeetingLink = service.meetingLink?.trim() || null;
  return {
    serviceNameSnapshot: service.name.trim(),
    locationModeSnapshot: service.locationMode,
    locationSnapshot:
      service.locationMode === "theirs"
        ? normalizedClientAddress
        : normalizedOwnerAddress,
    meetingLinkSnapshot: normalizedMeetingLink,
  } as const;
}

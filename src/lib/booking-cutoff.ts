const CLIENT_CHANGE_CUTOFF_HOURS = 24;

export function canClientChangeBooking(startsAt: Date, now = new Date()) {
  return (
    startsAt.getTime() - now.getTime() >=
    CLIENT_CHANGE_CUTOFF_HOURS * 3_600_000
  );
}

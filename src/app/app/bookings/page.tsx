import { Bookings } from "@/components/app/Bookings";
import { RequireSetup } from "@/components/app/RequireSetup";

export const metadata = { title: "Your bookings" };

export default function BookingsPage() {
  return (
    <RequireSetup>
      <Bookings />
    </RequireSetup>
  );
}

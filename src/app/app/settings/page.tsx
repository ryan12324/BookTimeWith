import { Settings } from "@/components/app/Settings";
import { RequireSetup } from "@/components/app/RequireSetup";

export const metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <RequireSetup>
      <Settings />
    </RequireSetup>
  );
}

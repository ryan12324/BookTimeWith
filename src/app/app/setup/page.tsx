import { Suspense } from "react";
import { Onboarding } from "@/components/app/Onboarding";

export const metadata = { title: "Set up" };

export default function SetupPage() {
  return (
    <Suspense fallback={null}>
      <Onboarding />
    </Suspense>
  );
}

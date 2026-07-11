import { Suspense } from "react";
import type { Metadata } from "next";
import { Wordmark } from "@/components/ui";
import { SignInForm } from "@/components/SignInForm";

export const metadata: Metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main id="main-content" className="flex min-h-screen flex-col items-center bg-paper px-6 pt-16">
      <Wordmark size={16} />
      <div className="mt-10 flex w-full justify-center">
        <Suspense fallback={null}>
          <SignInForm />
        </Suspense>
      </div>
    </main>
  );
}

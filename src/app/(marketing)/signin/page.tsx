import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
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
      <footer className="mt-auto pb-8 pt-12 font-sans text-[12px] text-faint">
        <div className="flex gap-4">
          <Link href="https://booktimewith.com/privacy" className="text-faint hover:underline">
            Privacy
          </Link>
          <Link href="https://booktimewith.com/terms" className="text-faint hover:underline">
            Terms
          </Link>
        </div>
      </footer>
    </main>
  );
}

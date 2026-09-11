import Link from "next/link";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { Container } from "@/components/ui/container";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({ title: "Create account" });

export default function SignUpPage() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center gap-8 py-24">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight">
          Create account
        </h1>
        <div className="flex flex-col gap-6">
          <GoogleSignInButton />
          <div className="flex items-center gap-3 text-xs text-foreground/50">
            <span className="h-px flex-1 bg-foreground/15" />
            or
            <span className="h-px flex-1 bg-foreground/15" />
          </div>
          <SignUpForm />
        </div>
        <p className="mt-6 text-sm text-foreground/70">
          Already have an account?{" "}
          <Link href="/sign-in" className="underline">
            Sign in
          </Link>
        </p>
      </div>
    </Container>
  );
}

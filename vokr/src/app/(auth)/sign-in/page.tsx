import Link from "next/link";

import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { SignInForm } from "@/components/auth/sign-in-form";
import { Container } from "@/components/ui/container";
import { signInErrorMessage } from "@/lib/auth-error-messages";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({ title: "Sign in" });

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // `/api/auth/confirm` and `/api/auth/callback` redirect their failures
  // here with an `?error=` code and log the real reason server-side.
  const errorMessage = signInErrorMessage((await searchParams).error);

  return (
    <Container className="flex flex-1 flex-col items-center justify-center gap-8 py-24">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight">Sign in</h1>
        {errorMessage ? (
          <p
            role="alert"
            className="mb-6 rounded-md border border-red-600/30 bg-red-600/5 px-3 py-2 text-sm text-red-600"
          >
            {errorMessage}
          </p>
        ) : null}
        <div className="flex flex-col gap-6">
          <GoogleSignInButton />
          <div className="flex items-center gap-3 text-xs text-foreground/50">
            <span className="h-px flex-1 bg-foreground/15" />
            or
            <span className="h-px flex-1 bg-foreground/15" />
          </div>
          <SignInForm />
        </div>
        <p className="mt-6 text-sm text-foreground/70">
          <Link href="/forgot-password" className="underline">
            Forgot your password?
          </Link>
        </p>
        <p className="mt-2 text-sm text-foreground/70">
          New here?{" "}
          <Link href="/sign-up" className="underline">
            Create an account
          </Link>
        </p>
      </div>
    </Container>
  );
}

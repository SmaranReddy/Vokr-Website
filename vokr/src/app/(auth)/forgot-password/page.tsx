import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { Container } from "@/components/ui/container";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({ title: "Reset your password" });

export default function ForgotPasswordPage() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center gap-8 py-24">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight">
          Reset your password
        </h1>
        <ForgotPasswordForm />
        <p className="mt-6 text-sm text-foreground/70">
          <Link href="/sign-in" className="underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </Container>
  );
}

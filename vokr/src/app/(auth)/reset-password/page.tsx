import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { Container } from "@/components/ui/container";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({ title: "Set a new password" });

export default function ResetPasswordPage() {
  return (
    <Container className="flex flex-1 flex-col items-center justify-center gap-8 py-24">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight">
          Set a new password
        </h1>
        <ResetPasswordForm />
      </div>
    </Container>
  );
}

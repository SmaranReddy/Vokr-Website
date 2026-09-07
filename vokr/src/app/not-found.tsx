import Link from "next/link";
import { Container } from "@/components/ui/container";

export default function NotFound() {
  return (
    <Container className="flex flex-1 flex-col items-start justify-center gap-4 py-24">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-foreground/70">
        The page you&apos;re looking for doesn&apos;t exist.
      </p>
      <Link
        href="/"
        className="text-sm font-medium underline underline-offset-4"
      >
        Return home
      </Link>
    </Container>
  );
}

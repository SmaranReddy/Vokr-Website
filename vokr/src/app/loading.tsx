import { Container } from "@/components/ui/container";

export default function Loading() {
  return (
    <Container className="flex flex-1 items-center justify-center py-24">
      <p className="text-sm text-foreground/60">Loading…</p>
    </Container>
  );
}

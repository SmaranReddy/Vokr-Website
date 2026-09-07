import { Container } from "@/components/ui/container";
import { siteConfig } from "@/config/site";

export default function Home() {
  return (
    <Container className="flex flex-1 flex-col items-start justify-center gap-6 py-24">
      <p className="text-sm font-medium uppercase tracking-widest text-foreground/50">
        Foundation build
      </p>
      <h1 className="max-w-xl text-4xl font-semibold tracking-tight text-balance">
        {siteConfig.tagline}
      </h1>
      <p className="max-w-md text-base text-foreground/70">
        {siteConfig.description}
      </p>
    </Container>
  );
}

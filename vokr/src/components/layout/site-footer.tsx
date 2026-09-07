import { Container } from "@/components/ui/container";
import { siteConfig } from "@/config/site";

export function SiteFooter() {
  return (
    <footer className="border-t border-foreground/10">
      <Container className="flex h-16 items-center text-sm text-foreground/60">
        © {new Date().getFullYear()} {siteConfig.name}
      </Container>
    </footer>
  );
}

import { Container } from "@/components/shared/Container";
import { ToolChip } from "@/components/shared/ToolChip";
import { Section } from "@/components/shared/Section";
import { copy } from "@/content/he";

export function ToolsGlance() {
  return (
    <Section className="pt-6">
      <Container>
        <div className="flex flex-wrap gap-2">
          {copy.tools.map((tool) => (
            <ToolChip key={tool.name} {...tool} />
          ))}
        </div>
      </Container>
    </Section>
  );
}

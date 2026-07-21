import { Container } from "@/components/shared/Container";
import { Section } from "@/components/shared/Section";
import { copy } from "@/content/he";

export function AgentJobs() {
  const [search, compare, basket, promotions] = copy.jobs;

  return (
    <Section>
      <Container>
        <div className="grid gap-px overflow-hidden rounded-[var(--radius-lg)] bg-[color:color-mix(in_oklch,var(--color-olive)_20%,transparent)] md:grid-cols-12">
          <Job className="bg-[var(--color-olive)] text-[var(--color-paper)] md:col-span-7 md:min-h-80" job={basket} />
          <Job className="bg-[color:color-mix(in_oklch,var(--color-paper)_88%,var(--color-olive-soft))] md:col-span-5" job={search} />
          <Job className="bg-[var(--color-paper)] md:col-span-4" job={compare} />
          <Job className="bg-[color:color-mix(in_oklch,var(--color-paper)_78%,var(--color-accent))] md:col-span-8" job={promotions} />
        </div>
      </Container>
    </Section>
  );
}

function Job({
  className,
  job,
}: {
  className: string;
  job: (typeof copy.jobs)[number];
}) {
  return (
    <article className={`flex min-h-52 flex-col justify-end p-7 md:p-9 ${className}`}>
      <h2 className="text-3xl font-semibold tracking-[-0.045em]">{job.title}</h2>
      <p className="mt-3 max-w-sm leading-7 opacity-80">{job.body}</p>
    </article>
  );
}

import type { MaterializedSample } from './materialize.js';
import type { ResolvedTemplateSource } from './template-source.js';

export interface TimingEntry {
  phase: string;
  ms: number;
}

export interface Provenance {
  generated_at: string;
  template_repo: string;
  template_ref: string;
  template_commit_sha: string;
  samples: Array<{ slug: string; name: string; template: string; expect_kind: string; commit_sha: string }>;
  engine_settings: { seed?: number; think_ms?: number; teams_requested?: number };
  timings: TimingEntry[];
}

export function buildProvenance(opts: {
  templateSource: ResolvedTemplateSource;
  templateRepo: string;
  materialized: MaterializedSample[];
  seed?: number;
  thinkMs?: number;
  teamsRequested?: number;
  timings: TimingEntry[];
}): Provenance {
  return {
    generated_at: new Date().toISOString(),
    template_repo: opts.templateRepo,
    template_ref: opts.templateSource.ref,
    template_commit_sha: opts.templateSource.commitSha,
    samples: opts.materialized.map((m) => ({
      slug: m.slug,
      name: m.sample.name,
      template: m.sample.template,
      expect_kind: m.sample.expect.kind,
      commit_sha: m.commitSha,
    })),
    engine_settings: { seed: opts.seed, think_ms: opts.thinkMs, teams_requested: opts.teamsRequested },
    timings: opts.timings,
  };
}

export class Stopwatch {
  private readonly timings: TimingEntry[] = [];

  async time<T>(phase: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.timings.push({ phase, ms: Date.now() - start });
    }
  }

  report(): TimingEntry[] {
    return this.timings;
  }

  print(): void {
    const total = this.timings.reduce((sum, t) => sum + t.ms, 0);
    console.log('\nTiming summary:');
    for (const t of this.timings) {
      console.log(`  ${t.phase.padEnd(24)} ${t.ms}ms`);
    }
    console.log(`  ${'total'.padEnd(24)} ${total}ms`);
  }
}

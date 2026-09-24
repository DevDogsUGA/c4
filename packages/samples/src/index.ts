// Public API of @acm-uga/c4-samples.

export { TEMPLATES, TEMPLATE_NAMES, isTemplateName, designatedBotFile, type TemplateName } from './templates.js';
export {
  resolveTemplateSource,
  DEFAULT_TEMPLATE_REPO,
  DEFAULT_TEMPLATE_REF,
  DEFAULT_CACHE_DIR,
  type TemplateSourceOptions,
  type ResolvedTemplateSource,
} from './template-source.js';
export { SampleJsonSchema, ExpectKindSchema, ExpectSchema, type SampleJson, type Expect, type ExpectKind } from './sample-schema.js';
export {
  materializeSample,
  checkOverlayRule,
  listSampleSlugs,
  OverlayViolationError,
  type MaterializedSample,
  type MaterializeOptions,
} from './materialize.js';
export { buildRoster, type RosterJson, type RosterTeam } from './roster.js';
export { RealEngineCli, type EngineCli, type FreezeOptions, type RunTournamentOptions } from './engine-cli.js';
export { checkExpectations, checkFailStateCoverage, formatTable, type ExpectationCheck, type CoverageCheck } from './expectations.js';
export { buildProvenance, Stopwatch, type Provenance, type TimingEntry } from './provenance.js';
export { runSamples, type RunSamplesOptions, type RunSamplesResult } from './run.js';

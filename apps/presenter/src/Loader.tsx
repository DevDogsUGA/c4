// Directory file-picker fallback for loading tournament data when no
// ?dir= query param is present. Parses picked files through records.ts's
// validated parsers -- same contract as the ?dir= fetch path.

import { useRef } from 'react';
import type { MatchRecord } from '@acm-uga/c4-contract';
import {
  parseManifest,
  parseMatchRecord,
  parseTournamentBundle,
  parseTournamentSummary,
  tournamentDataFromBundle,
  type TournamentData,
} from './records.js';

export function Loader({ onLoad }: { onLoad: (data: TournamentData) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function onChange(): Promise<void> {
    const fileList = inputRef.current?.files ?? null;
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList);

    // A single .json file (not a manifest.json folder) is treated as a
    // tournament bundle -- the engine's single-file R2 export -- per
    // SHOW_PLAN.md's loading modes.
    if (files.length === 1 && files[0]!.name.toLowerCase().endsWith('.json') && files[0]!.name !== 'manifest.json') {
      const file = files[0]!;
      try {
        const bundle = parseTournamentBundle(JSON.parse(await file.text()), file.name);
        onLoad(tournamentDataFromBundle(bundle));
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err));
      }
      return;
    }

    const manifestFile = files.find((f) => f.name === 'manifest.json');
    if (!manifestFile) {
      alert('Selected folder is missing manifest.json (or pick a single tournament-bundle .json file instead)');
      return;
    }
    const manifest = parseManifest(JSON.parse(await manifestFile.text()), manifestFile.name);

    const byName = new Map(files.map((f) => [f.name, f]));

    const summaryFile = byName.get(manifest.summary);
    if (!summaryFile) {
      alert(`manifest.json references missing summary file: ${manifest.summary}`);
      return;
    }
    const summary = parseTournamentSummary(JSON.parse(await summaryFile.text()), manifest.summary);

    const matches: MatchRecord[] = [];
    for (const filename of manifest.matches) {
      const file = byName.get(filename);
      if (!file) {
        alert(`manifest.json references missing match file: ${filename}`);
        return;
      }
      matches.push(parseMatchRecord(JSON.parse(await file.text()), filename));
    }

    onLoad({ summary, matches });
  }

  return (
    <div className="relative z-10 pt-4 text-steel">
      <p className="m-0">
        Load a tournament: pick the output folder from <code className="font-mono">match-engine</code> (or
        fixtures), or a single tournament-bundle <code className="font-mono">.json</code> file.
      </p>
      <input
        ref={inputRef}
        type="file"
        // @ts-expect-error non-standard attribute, needed for directory picking
        webkitdirectory=""
        multiple
        onChange={() => void onChange()}
        className="mt-2 text-chalk"
      />
      <p className="m-0 mt-3 text-xs uppercase tracking-widest text-graphite">or</p>
      <input
        type="file"
        accept="application/json,.json"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0] ?? null;
          if (!file) return;
          void (async () => {
            try {
              const bundle = parseTournamentBundle(JSON.parse(await file.text()), file.name);
              onLoad(tournamentDataFromBundle(bundle));
            } catch (err) {
              alert(err instanceof Error ? err.message : String(err));
            }
          })();
        }}
        className="mt-2 text-chalk"
      />
    </div>
  );
}

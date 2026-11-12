import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Uses the existing development deployment's credential without printing or saving it.
const token = execFileSync(
  process.execPath,
  ['node_modules/convex/bin/main.js', 'env', 'get', 'TMDB_API_READ_ACCESS_TOKEN'],
  {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  },
).trim();
if (!token || token === 'undefined')
  throw new Error('The development deployment has no TMDB credential');
const directory = resolve(process.argv[2] ?? '/tmp/marker-series-benchmark');
mkdirSync(directory, { recursive: true });
const save = (name, data) => writeFileSync(join(directory, name), JSON.stringify(data, null, 2));
const request = async (path) => {
  const started = performance.now();
  const response = await fetch(`https://api.themoviedb.org/3${path}`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`TMDB returned HTTP ${response.status}`);
  const data = await response.json();
  return { data, milliseconds: Number((performance.now() - started).toFixed(2)) };
};
const start = performance.now();
const title = await request('/tv/37854?append_to_response=credits,external_ids');
save('title.json', title.data);
const pending = title.data.seasons.map((season) => season.season_number);
const seasons = [];
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(8, pending.length) }, async () => {
    while (next < pending.length) {
      const season = pending[next++];
      const result = await request(`/tv/37854/season/${season}`);
      save(`season-${season}.json`, result.data);
      seasons.push({
        season,
        episodes: result.data.episodes.length,
        milliseconds: result.milliseconds,
      });
    }
  }),
);
const individual = {
  source:
    'Live TMDB from development machine; application cache bypassed; excludes Convex and TVDB',
  titleMilliseconds: title.milliseconds,
  milliseconds: Number((performance.now() - start).toFixed(2)),
  concurrency: 8,
  seasons: seasons.sort((a, b) => a.season - b.season),
};
save('provider-individual.json', individual);
const batchedStart = performance.now();
const groups = [];
for (let offset = 0; offset < pending.length; offset += 20)
  groups.push(pending.slice(offset, offset + 20));
const batches = await Promise.all(
  groups.map(async (group) => {
    const result = await request(
      `/tv/37854?append_to_response=${group.map((season) => `season/${season}`).join(',')}`,
    );
    return {
      seasons: group,
      milliseconds: result.milliseconds,
      episodes: group.reduce(
        (total, season) => total + (result.data[`season/${season}`]?.episodes?.length ?? 0),
        0,
      ),
    };
  }),
);
const batched = {
  source: 'Live TMDB append_to_response; excludes initial title, Convex and TVDB',
  milliseconds: Number((performance.now() - batchedStart).toFixed(2)),
  batches,
};
save('provider-batched.json', batched);
console.log(JSON.stringify({ directory, individual, batched }, null, 2));

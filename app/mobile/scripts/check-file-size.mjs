import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const PRODUCTION_LIMIT = 600;
const TEST_LIMIT = 700;
const trackedFiles = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '*.ts', '*.tsx', '*.js', '*.mjs'],
  { encoding: 'utf8' },
)
  .trim()
  .split('\n')
  .filter(Boolean)
  .filter(existsSync)
  .filter((file) => !file.includes('/_generated/'));

const oversized = trackedFiles.flatMap((file) => {
  const lineCount = readFileSync(file, 'utf8').replace(/\n$/u, '').split('\n').length;
  const limit = file.startsWith('tests/') ? TEST_LIMIT : PRODUCTION_LIMIT;
  return lineCount > limit ? [{ file, lineCount, limit }] : [];
});

if (oversized.length) {
  console.error('Files that need a smaller, single-purpose module:');
  for (const { file, lineCount, limit } of oversized) {
    console.error(`- ${file}: ${lineCount} lines (limit ${limit})`);
  }
  process.exitCode = 1;
} else {
  console.log('All maintained source files are within the readability limits.');
}

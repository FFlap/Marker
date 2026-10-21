import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBoundaryChecker } from './check-import-boundaries.mjs';

const root = mkdtempSync(path.join(tmpdir(), 'marker-import-boundaries-'));
after(() => rmSync(root, { recursive: true, force: true }));
const write = (filename, content) => {
  const file = path.join(root, filename);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
};
for (const app of ['web', 'mobile', 'extension']) {
  write(`app/${app}/package.json`, JSON.stringify({ name: `@marker/${app}` }));
}
write(
  'shared/package.json',
  JSON.stringify({
    name: '@marker/shared',
    exports: {
      './api': { types: './convex/_generated/api.d.ts', default: './convex/_generated/api.js' },
      './dataModel': { types: './convex/_generated/dataModel.d.ts' },
      './calendar': './lib/calendar.ts',
    },
  }),
);
write(
  'app/web/tsconfig.app.json',
  JSON.stringify({
    compilerOptions: {
      baseUrl: '.',
      paths: {
        '@/*': ['./src/*'],
        '@mobile/*': ['../mobile/src/*'],
        '@mobile/local-assets/*': ['./src/assets/*'],
        '@mobile/logo.svg': ['./src/assets/logo.svg'],
        '@backend/*': ['../../shared/convex/*'],
        '@fallback/*': ['./missing/*', '../mobile/src/*'],
      },
    },
  }),
);
write('app/web/src/local.ts', 'export const value = 1;');
write('app/mobile/src/local.ts', 'export const value = 1;');
write('app/mobile/src/poster.svg', '<svg />');
write('app/mobile/src/styles.css', 'body {}');
write('shared/convex/schema.ts', 'export default {};');
const check = createBoundaryChecker(root);
const errors = (file, source) => check(file, source).map((entry) => entry.message);

test('allows public API, model types, helpers, local modules, and external dependencies', () => {
  assert.deepEqual(
    errors(
      'app/web/src/view.ts',
      `
        import { api } from '@marker/shared/api';
        import type { Id } from '@marker/shared/dataModel';
        export { loadCalendarPages } from '@marker/shared/calendar';
        import { value } from '@/local';
        import './styles.css';
        import { useQuery } from 'convex/react';
      `,
    ),
    [],
  );
});

test('rejects sibling app imports via relative paths, package names, and TS aliases', () => {
  const messages = errors(
    'app/web/src/view.ts',
    `
      import { value } from '../../mobile/src/local';
      export { value } from '@marker/extension/private';
      import { value } from '@mobile/local';
    `,
  );
  assert.equal(messages.length, 3);
  assert.ok(messages.every((message) => message.startsWith('Apps must not import another app')));
});

test('rejects private shared exports and relative or aliased access to shared code', () => {
  assert.equal(
    errors(
      'app/web/src/view.ts',
      `
        import schema from '../../../shared/convex/schema';
        import { value } from '@marker/shared/convex/schema';
        import { value } from '@backend/schema';
        import { api } from '../../../shared/convex/_generated/api';
        import { value } from '../../../shared/lib/calendar';
      `,
    ).length,
    5,
  );
});

test('checks dynamic imports, CommonJS, import types, re-exports, and test mocks', () => {
  assert.equal(
    errors(
      'app/web/src/view.ts',
      `
        const first = import('../../mobile/src/local');
        const second = require('../../mobile/src/local');
        require.resolve('../../mobile/src/local');
        import third = require('../../mobile/src/local');
        type Fourth = import('../../mobile/src/local').Value;
        export * from '../../mobile/src/local';
        vi.mock('../../mobile/src/local', () => ({}));
        jest.requireActual('../../mobile/src/local');
      `,
    ).length,
    8,
  );
});

test('checks literal glob imports, including exclusions and template literals', () => {
  assert.equal(
    errors(
      'app/web/src/view.ts',
      `
        import.meta.glob('../../mobile/src/*.ts');
        import.meta.glob(['./*.ts', '!../../extension/src/*.ts']);
        const lazy = import(\`../../mobile/src/local\`);
      `,
    ).length,
    3,
  );
});

test('rejects aliased glob imports across package boundaries', () => {
  const messages = errors(
    'app/web/src/view.ts',
    `
      import.meta.glob('@mobile/**/*.ts');
      import.meta.glob(['./*.ts', '!@backend/**/*.ts']);
      import.meta.globEager('@fallback/**/*.ts');
    `,
  );
  assert.equal(messages.length, 3);
  assert.match(messages[0], /^Apps must not import another app/u);
  assert.match(messages[1], /^Import shared code through @marker\/shared exports/u);
  assert.match(messages[2], /^Apps must not import another app/u);
});

test('rejects aliased asset imports even when TypeScript cannot resolve them', () => {
  const messages = errors(
    'app/web/src/view.ts',
    `
      import logo from '@mobile/poster.svg';
      import '@mobile/styles.css';
      import schema from '@backend/schema?raw';
    `,
  );
  assert.equal(messages.length, 3);
  assert.match(messages[0], /^Apps must not import another app/u);
  assert.match(messages[1], /^Apps must not import another app/u);
  assert.match(messages[2], /^Import shared code through @marker\/shared exports/u);
});

test('allows local globs and honors the most specific alias', () => {
  assert.deepEqual(
    errors(
      'app/web/src/view.ts',
      `
        import.meta.glob('@/assets/*.svg');
        import.meta.glob('@mobile/local-assets/*.svg');
        import logo from '@mobile/logo.svg';
      `,
    ),
    [],
  );
});

test('shared code cannot depend on any app, including through package imports', () => {
  assert.deepEqual(
    errors(
      'shared/convex/handler.ts',
      `
        import { value } from '../../app/web/src/local';
        import { value } from '@marker/mobile/local';
      `,
    ),
    ['Shared code must not depend on an app.', 'Shared code must not depend on an app.'],
  );
});

test('backend and backend tests can use helpers and generated Convex modules', () => {
  assert.deepEqual(
    errors(
      'shared/convex/handler.ts',
      `
        import { api } from './_generated/api';
        import { value } from '../lib/calendar';
        import { value } from '@marker/shared/calendar';
      `,
    ),
    [],
  );
  assert.deepEqual(
    errors(
      'shared/tests/convex/handler.test.ts',
      `import schema from '../../convex/schema'; import.meta.glob('../../convex/**/*.ts');`,
    ),
    [],
  );
});

test('helpers cannot acquire backend, native, or Node dependencies', () => {
  const messages = errors(
    'shared/lib/helper.ts',
    `
      import schema from '../convex/schema';
      import { api } from '@marker/shared/api';
      import type { Id } from '@marker/shared/dataModel';
      import { value } from '../tests/fixture';
      import { query } from 'convex/server';
      import { value } from '@convex-dev/migrations';
      import { View } from 'react-native';
      import { value } from 'expo-constants';
      import { readFile } from 'node:fs/promises';
      import { readFile } from 'fs/promises';
    `,
  );
  assert.equal(messages.length, 10);
  assert.ok(messages.every((message) => message.startsWith('Shared helpers must')));
  assert.deepEqual(errors('shared/lib/helper.ts', `import { value } from './calendar';`), []);
});

test('reports the import location and ignores strings that are not module references', () => {
  const issues = check(
    'app/web/src/view.ts',
    `const example = "import x from '../../mobile/src/local'";\nimport { value } from '../../mobile/src/local';`,
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 2);
  assert.equal(issues[0].specifier, '../../mobile/src/local');
});

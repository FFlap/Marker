import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const localManifest = path.join(process.cwd(), 'package.json');
const require = createRequire(
  existsSync(localManifest) ? localManifest : new URL('../shared/package.json', import.meta.url),
);
const ts = require('typescript');
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/u, '')));
const inside = (directory, file) =>
  file === directory || file.startsWith(`${directory}${path.sep}`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

function moduleSpecifiers(source) {
  const imports = [];
  const add = (node) => {
    if (node && ts.isStringLiteralLike(node)) imports.push(node);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) add(node.moduleSpecifier);
    if (ts.isExternalModuleReference(node)) add(node.expression);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      add(node.argument.literal);
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(source);
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        /^(require|require\.resolve|(?:jest|vi)\.(?:mock|doMock|unmock|requireActual|importActual|importMock))$/u.test(
          callee,
        )
      ) {
        add(node.arguments[0]);
      } else if (/^import\.meta\.glob(?:Eager)?$/u.test(callee)) {
        const patterns = node.arguments[0];
        if (patterns && ts.isArrayLiteralExpression(patterns)) patterns.elements.forEach(add);
        else add(patterns);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
}

export function createBoundaryChecker(root = repositoryRoot) {
  const sharedDirectory = path.join(root, 'shared');
  const projectDirectories = [
    sharedDirectory,
    ...readdirSync(path.join(root, 'app'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, 'app', entry.name)),
  ].filter((directory) => existsSync(path.join(directory, 'package.json')));
  const projects = projectDirectories.map((directory) => {
    const manifest = readJson(path.join(directory, 'package.json'));
    // Vite keeps the application aliases in tsconfig.app.json.
    const configFile = ['tsconfig.app.json', 'tsconfig.json']
      .map((name) => path.join(directory, name))
      .find(existsSync);
    let options = {};
    if (configFile) {
      const config = ts.readConfigFile(configFile, ts.sys.readFile);
      if (config.error) throw new Error(`Cannot read ${configFile}`);
      options = ts.parseJsonConfigFileContent(config.config, ts.sys, directory).options;
    }
    return { directory, name: manifest.name, exports: manifest.exports ?? {}, options };
  });
  const shared = projects.find((project) => project.directory === sharedDirectory);
  const owner = (file) => projects.find((project) => inside(project.directory, file));
  const packageMatch = (specifier, name) => specifier === name || specifier.startsWith(`${name}/`);

  function violation(file, specifier) {
    const sourceProject = owner(file);
    if (!sourceProject) return undefined;
    const sourceIsShared = sourceProject === shared;
    const sourceIsLibrary = inside(path.join(sharedDirectory, 'lib'), file);
    const targetPackage = projects.find((project) => packageMatch(specifier, project.name));
    if (targetPackage && targetPackage !== shared && targetPackage !== sourceProject) {
      return sourceIsShared
        ? 'Shared code must not depend on an app.'
        : 'Apps must not import another app; move reusable code into shared/lib.';
    }

    let target;
    if (targetPackage === shared) {
      const subpath = `.${specifier.slice(shared.name.length)}`;
      const exported = shared.exports[subpath];
      if (!exported) return 'Use an explicit @marker/shared export; shared internals are private.';
      target = path.resolve(sharedDirectory, exported.types ?? exported.default ?? exported);
    } else if (specifier.startsWith('.')) {
      target = path.resolve(path.dirname(file), specifier);
    } else if (specifier.startsWith('file:')) {
      target = fileURLToPath(specifier);
    } else if (path.isAbsolute(specifier)) {
      target = specifier;
    } else {
      target = ts.resolveModuleName(specifier, file, sourceProject.options, ts.sys).resolvedModule
        ?.resolvedFileName;
    }

    if (target) {
      const targetProject = owner(target);
      if (sourceIsShared && targetProject && targetProject !== shared) {
        return 'Shared code must not depend on an app.';
      }
      if (!sourceIsShared && targetProject && targetProject !== sourceProject) {
        if (targetProject !== shared) {
          return 'Apps must not import another app; move reusable code into shared/lib.';
        }
        if (targetPackage !== shared) {
          return 'Import shared code through @marker/shared exports, not relative paths or aliases.';
        }
      }
      if (
        sourceIsLibrary &&
        inside(sharedDirectory, target) &&
        !inside(path.join(sharedDirectory, 'lib'), target) &&
        !inside(path.join(sharedDirectory, 'node_modules'), target)
      ) {
        return 'Shared helpers must not depend on Convex functions, tests, or tooling.';
      }
    }

    if (
      sourceIsLibrary &&
      (specifier.startsWith('node:') ||
        builtins.has(specifier) ||
        /^(convex(?:\/|$)|@convex-dev\/|react-native(?:\/|$)|expo(?:[-/]|$)|@expo\/)/u.test(
          specifier,
        ))
    ) {
      return 'Shared helpers must stay portable; backend and native dependencies belong elsewhere.';
    }
    return undefined;
  }

  return (filename, text = readFileSync(filename, 'utf8')) => {
    const file = path.resolve(root, filename);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    return moduleSpecifiers(source).flatMap((node) => {
      const message = violation(file, node.text.replace(/^!/u, ''));
      if (!message) return [];
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      return [{ file, line: line + 1, column: character + 1, specifier: node.text, message }];
    });
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = createBoundaryChecker();
  const files = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: process.cwd(), encoding: 'utf8' },
  )
    .split('\0')
    .filter((file) => /\.[cm]?[jt]sx?$/u.test(file) && !file.includes('/_generated/'))
    .map((file) => path.resolve(file))
    .filter(existsSync);
  const violations = [...new Set(files)].flatMap((file) => check(file));
  for (const { file, line, column, specifier, message } of violations) {
    console.error(
      `${path.relative(repositoryRoot, file)}:${line}:${column} ${message} (${specifier})`,
    );
  }
  if (violations.length) process.exitCode = 1;
  else console.log(`Import boundaries passed for ${files.length} source files.`);
}

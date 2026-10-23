import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

// Follow the entry component and local route delegates, rather than merely checking
// for an import: a ScreenView nested inside a plain root would miss the convention.
function entryViolations(source: string): string[] {
  const file = ts.createSourceFile(
    'route.tsx',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const functions = new Map<string, ts.FunctionDeclaration>();
  let entry: ts.FunctionDeclaration | undefined;
  for (const node of file.statements) {
    if (!ts.isFunctionDeclaration(node)) continue;
    if (node.name) functions.set(node.name.text, node);
    if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) entry = node;
  }
  const errors: string[] = [];
  const visited = new Set<ts.FunctionDeclaration>();
  function expression(node: ts.Expression): void {
    if (ts.isParenthesizedExpression(node)) return expression(node.expression);
    if (ts.isConditionalExpression(node)) {
      expression(node.whenTrue);
      expression(node.whenFalse);
      return;
    }
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText(file);
      if (['ScreenView', 'ScreenKeyboardScrollView', 'Redirect'].includes(tag)) return;
      if (tag === 'ScreenErrorBoundary' && ts.isJsxElement(node)) {
        for (const child of node.children) {
          if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child)) expression(child);
        }
        return;
      }
      const delegate = functions.get(tag);
      if (delegate) return component(delegate);
      errors.push(`unsupported screen root: ${tag}`);
      return;
    }
    errors.push(`unsupported screen return: ${node.getText(file).slice(0, 60)}`);
  }
  function component(node: ts.FunctionDeclaration) {
    if (visited.has(node)) return;
    visited.add(node);
    function visit(child: ts.Node) {
      if (ts.isReturnStatement(child) && child.expression) expression(child.expression);
      else if (!ts.isFunctionLike(child)) ts.forEachChild(child, visit);
    }
    if (node.body) visit(node.body);
  }
  if (entry) component(entry);
  else errors.push('entry must be a default function declaration so its roots can be checked');
  return errors;
}
function routes(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? routes(path) : /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe('screen layout convention', () => {
  it('requires every entry branch to use a shared native root or delegate to one', () => {
    const root = join(process.cwd(), 'src/app');
    const failures = routes(root).flatMap((path) => {
      // Navigator layouts keep navigation mounted; they are not visible screen content.
      if (path.endsWith('/_layout.tsx')) return [];
      return entryViolations(readFileSync(path, 'utf8')).map(
        (error) => `${relative(root, path)}: ${error}`,
      );
    });
    expect(failures).toEqual([]);
  });
  it('rejects forgotten roots, including one branch or a nested shared layout', () => {
    expect(
      entryViolations('export default function Page() { return <View><ScreenView /></View>; }'),
    ).toHaveLength(1);
    expect(
      entryViolations(
        'export default function Page() { if (failed) return <View />; return <ScreenView />; }',
      ),
    ).toHaveLength(1);
    expect(
      entryViolations(
        'export default function Page() { return <Content />; } function Content() { return <View />; }',
      ),
    ).toHaveLength(1);
    expect(
      entryViolations('export default function Page() { return <Redirect href="/" />; }'),
    ).toEqual([]);
  });
  it('keeps Expo splash ownership exclusively in the root layout', () => {
    const root = join(process.cwd(), 'src');
    const owners = routes(root).filter((path) =>
      /from ['"]expo-splash-screen['"]/.test(readFileSync(path, 'utf8')),
    );
    expect(owners.map((path) => relative(root, path))).toEqual(['app/_layout.tsx']);
  });
});

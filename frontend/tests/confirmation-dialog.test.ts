import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const srcRoot = fileURLToPath(new URL("../src/", import.meta.url));
const providerSource = readFileSync(
  new URL("../src/components/ConfirmationProvider.tsx", import.meta.url),
  "utf8",
);
const authenticatedRouteSource = readFileSync(
  new URL("../src/routes/_authenticated/route.tsx", import.meta.url),
  "utf8",
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (![".ts", ".tsx"].includes(extname(entry.name))) return [];
    return [path];
  });
}

test("authenticated screens share the platform confirmation dialog", () => {
  assert.match(authenticatedRouteSource, /<ConfirmationProvider>[\s\S]*<Outlet \/>/);
  assert.match(providerSource, /<AlertDialog open=\{Boolean\(request\)\}/);
  assert.match(providerSource, /w-\[calc\(100%-2rem\)\] max-w-md/);
  assert.match(providerSource, /border-border bg-card/);
  assert.match(providerSource, /AlertDialogCancel[\s\S]*AlertDialogAction/);
  assert.match(providerSource, /destructive[\s\S]*bg-destructive/);
});

test("frontend routes do not use browser-native alert, confirm or prompt popups", () => {
  const violations = sourceFiles(srcRoot).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return /(?:window\s*\.\s*)?(?:alert|confirm|prompt)\s*\(/.test(source)
      ? [relative(srcRoot, file)]
      : [];
  });

  assert.deepEqual(violations, []);
});

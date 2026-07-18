import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

async function dtsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return dtsFiles(path);
      return entry.isFile() && path.endsWith('.d.ts') ? [path] : [];
    }),
  );
  return files.flat().sort();
}

const root = process.argv[2] ?? 'dist';
for (const path of await dtsFiles(root)) {
  const source = await readFile(path, 'utf8');
  const normalized = source.replace(/(from\s+['"]\.\.?\/[^'"]+)\.ts(['"])/g, '$1.js$2');
  if (normalized !== source) {
    await writeFile(path, normalized, 'utf8');
  }
}

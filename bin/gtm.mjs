#!/usr/bin/env node
// CLI shim: runs the TypeScript entrypoint through tsx, from any working directory.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'tsx/esm/api';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.GTM_HOME ??= root;
register();
await import(path.join(root, 'src/cli/index.ts'));

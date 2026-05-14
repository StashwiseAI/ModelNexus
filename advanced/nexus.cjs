#!/usr/bin/env node
// Thin shim — delegates to the TS entrypoint via tsx so we don't need a build step.
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const root = path.join(__dirname, '..')
const entry = path.join(root, 'src', 'cli', 'nexus.ts')

const result = spawnSync(
  process.execPath,
  [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), entry, ...process.argv.slice(2)],
  { stdio: 'inherit', cwd: root, env: process.env }
)

process.exit(result.status ?? 1)

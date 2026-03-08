import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'

function resolveCommitSha(): string {
  if (process.env.VITE_COMMIT_SHA) return process.env.VITE_COMMIT_SHA
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
  } catch {
    return 'dev'
  }
}

function resolveBuildTime(): string {
  if (process.env.VITE_BUILD_TIME) return process.env.VITE_BUILD_TIME
  return new Date().toISOString()
}

const buildMeta = {
  'import.meta.env.VITE_COMMIT_SHA': JSON.stringify(resolveCommitSha()),
  'import.meta.env.VITE_BUILD_TIME': JSON.stringify(resolveBuildTime()),
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  define: buildMeta,
})

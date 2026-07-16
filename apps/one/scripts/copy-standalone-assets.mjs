import { cpSync, existsSync, rmSync } from "node:fs";

const STANDALONE_ROOT = ".next/standalone/apps/one";

// `next build` with output:'standalone' regenerates .next/standalone without
// the client static files or the project public assets, so both must be copied
// in after each build or the deployed site ships unstyled and missing /icon.svg.
// Uses Node fs so the copy works on any platform (no Unix-only rm/cp).
for (const dir of ["public", ".next/static"]) {
  const src = dir;
  const dest = `${STANDALONE_ROOT}/${dir}`;
  rmSync(dest, { recursive: true, force: true });
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
  }
}

#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";

const rootDir = process.cwd();
const outDir = join(rootDir, "apps", "crawclaw-admin-desktop", "out");
const artifactDir = process.env.ARTIFACT_DIR;
const artifactLabel = process.env.ARTIFACT_LABEL || "desktop";

if (!artifactDir) {
  throw new Error("ARTIFACT_DIR is required");
}
if (!existsSync(outDir)) {
  throw new Error(`Desktop output directory does not exist: ${outDir}`);
}

rmSync(artifactDir, { recursive: true, force: true });
mkdirSync(artifactDir, { recursive: true });

const artifacts = collectArtifacts(outDir);
if (artifacts.length === 0) {
  throw new Error(`No desktop release artifacts found under ${outDir}`);
}

const checksumLines = [];
for (const artifact of artifacts) {
  const target = join(artifactDir, basename(artifact));
  copyFileSync(artifact, target);
  checksumLines.push(`${sha256(target)}  ${basename(target)}`);
}
writeFileSync(
  join(artifactDir, `SHA256SUMS-${artifactLabel}.txt`),
  `${checksumLines.toSorted().join("\n")}\n`,
  "utf-8",
);

function collectArtifacts(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isFile() && isReleaseArtifact(path)) {
      files.push(path);
    }
  }
  return files.toSorted((left, right) => left.localeCompare(right));
}

function isReleaseArtifact(path) {
  return /\.(AppImage|blockmap|dmg|exe|msi|pkg|snap|yml|zip)$/i.test(path);
}

function sha256(path) {
  return createHash("sha256")
    .update(readFileSync(resolve(path)))
    .digest("hex");
}

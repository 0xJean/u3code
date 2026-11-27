import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
import { PlaybookPackManifest } from "@u3code/hub-contracts";

const decodePackManifest = Schema.decodeUnknownSync(PlaybookPackManifest);

export interface ValidatedPlaybookPack {
  readonly packDir: string;
  readonly manifest: PlaybookPackManifest;
}

export interface InstallPlaybookPackOptions {
  readonly packDir: string;
  readonly workflowsDir?: string;
  readonly skillsDir?: string;
  readonly force?: boolean;
  readonly dryRun?: boolean;
}

export interface InstallPlaybookPackResult {
  readonly manifest: PlaybookPackManifest;
  readonly workflowsDir: string;
  readonly skillsDir: string;
  readonly installedWorkflows: readonly string[];
  readonly skippedWorkflows: readonly string[];
  readonly installedSkills: readonly string[];
  readonly skippedSkills: readonly string[];
}

function assertSafeRelativePath(baseDir: string, relativePath: string): string {
  const resolvedBase = NodePath.resolve(baseDir);
  const resolvedTarget = NodePath.resolve(resolvedBase, relativePath);
  if (
    resolvedTarget !== resolvedBase &&
    !resolvedTarget.startsWith(`${resolvedBase}${NodePath.sep}`)
  ) {
    throw new Error(`Unsafe path traversal in pack manifest: '${relativePath}'`);
  }
  return resolvedTarget;
}

export function validatePlaybookPack(packDir: string): ValidatedPlaybookPack {
  const resolvedDir = NodePath.resolve(packDir);
  const manifestPath = NodePath.join(resolvedDir, "u3code-pack.json");
  if (!NodeFS.existsSync(manifestPath)) {
    throw new Error(`Missing u3code-pack.json in '${resolvedDir}'.`);
  }

  const raw = JSON.parse(NodeFS.readFileSync(manifestPath, "utf8")) as unknown;
  const manifest = decodePackManifest(raw);

  for (const wf of manifest.workflows ?? []) {
    const wfPath = assertSafeRelativePath(resolvedDir, wf.file);
    if (!NodeFS.existsSync(wfPath) || !NodeFS.statSync(wfPath).isFile()) {
      throw new Error(`Workflow file declared in manifest does not exist: '${wf.file}'`);
    }
  }

  for (const skill of manifest.skills ?? []) {
    const skillDir = assertSafeRelativePath(resolvedDir, skill.dir);
    const skillMd = NodePath.join(skillDir, "SKILL.md");
    if (!NodeFS.existsSync(skillMd) || !NodeFS.statSync(skillMd).isFile()) {
      throw new Error(`Skill directory '${skill.dir}' must contain a SKILL.md file.`);
    }
  }

  return { packDir: resolvedDir, manifest };
}

export function installPlaybookPack(
  options: InstallPlaybookPackOptions,
): InstallPlaybookPackResult {
  const { packDir, manifest } = validatePlaybookPack(options.packDir);
  const workflowsDir = NodePath.resolve(
    options.workflowsDir ??
      process.env.T3CODE_WORKFLOWS ??
      NodePath.join(NodeOS.homedir(), ".t3", "workflows"),
  );
  const skillsDir = NodePath.resolve(
    options.skillsDir ?? NodePath.join(NodeOS.homedir(), ".agents", "skills"),
  );
  const force = options.force === true;
  const dryRun = options.dryRun === true;

  const installedWorkflows: string[] = [];
  const skippedWorkflows: string[] = [];
  const installedSkills: string[] = [];
  const skippedSkills: string[] = [];

  if (!dryRun && (manifest.workflows?.length ?? 0) > 0) {
    NodeFS.mkdirSync(workflowsDir, { recursive: true });
  }
  if (!dryRun && (manifest.skills?.length ?? 0) > 0) {
    NodeFS.mkdirSync(skillsDir, { recursive: true });
  }

  for (const wf of manifest.workflows ?? []) {
    const srcPath = assertSafeRelativePath(packDir, wf.file);
    const destName = NodePath.basename(wf.file);
    const destPath = NodePath.join(workflowsDir, destName);
    if (NodeFS.existsSync(destPath) && !force) {
      skippedWorkflows.push(destPath);
      continue;
    }
    if (!dryRun) {
      NodeFS.copyFileSync(srcPath, destPath);
    }
    installedWorkflows.push(destPath);
  }

  for (const skill of manifest.skills ?? []) {
    const srcDir = assertSafeRelativePath(packDir, skill.dir);
    const destName = NodePath.basename(skill.dir);
    const destDir = NodePath.join(skillsDir, destName);
    if (NodeFS.existsSync(destDir) && !force) {
      skippedSkills.push(destDir);
      continue;
    }
    if (!dryRun) {
      NodeFS.cpSync(srcDir, destDir, { recursive: true, force: true });
    }
    installedSkills.push(destDir);
  }

  return {
    manifest,
    workflowsDir,
    skillsDir,
    installedWorkflows,
    skippedWorkflows,
    installedSkills,
    skippedSkills,
  };
}

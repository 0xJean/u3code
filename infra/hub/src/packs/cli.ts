import { installPlaybookPack } from "./installer.ts";

function parseArgs(argv: readonly string[]): {
  readonly packDir: string;
  readonly workflowsDir?: string;
  readonly skillsDir?: string;
  readonly force: boolean;
  readonly dryRun: boolean;
} {
  let packDir = "";
  let workflowsDir: string | undefined;
  let skillsDir: string | undefined;
  let force = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg === "--force") {
      force = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--workflows-dir" && argv[i + 1]) {
      workflowsDir = argv[i + 1];
      i += 1;
    } else if (arg === "--skills-dir" && argv[i + 1]) {
      skillsDir = argv[i + 1];
      i += 1;
    } else if (!arg.startsWith("-") && !packDir) {
      packDir = arg;
    }
  }

  if (!packDir) {
    console.error(
      "Usage: node infra/hub/src/packs/cli.ts <pack-dir> [--workflows-dir <dir>] [--skills-dir <dir>] [--force] [--dry-run]",
    );
    process.exit(1);
  }

  return {
    packDir,
    ...(workflowsDir !== undefined ? { workflowsDir } : {}),
    ...(skillsDir !== undefined ? { skillsDir } : {}),
    force,
    dryRun,
  };
}

const args = parseArgs(process.argv.slice(2));
const result = installPlaybookPack(args);

console.log(
  `${args.dryRun ? "[DRY RUN] " : ""}Playbook Pack: ${result.manifest.name} (${result.manifest.id}@${result.manifest.version})`,
);
console.log(
  `  Workflows installed: ${result.installedWorkflows.length}, skipped: ${result.skippedWorkflows.length} (target: ${result.workflowsDir})`,
);
console.log(
  `  Skills installed: ${result.installedSkills.length}, skipped: ${result.skippedSkills.length} (target: ${result.skillsDir})`,
);
if (result.manifest.hub?.workflowPresetId) {
  console.log(`  Recommended Hub Workflow Preset: ${result.manifest.hub.workflowPresetId}`);
}
if ((result.manifest.hub?.defaultDirectives?.length ?? 0) > 0) {
  console.log("  Suggested Project Directives:");
  for (const directive of result.manifest.hub?.defaultDirectives ?? []) {
    console.log(`    - ${directive}`);
  }
}

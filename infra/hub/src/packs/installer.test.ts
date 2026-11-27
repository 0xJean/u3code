import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { installPlaybookPack, validatePlaybookPack } from "./installer.ts";

const REPO_ROOT = NodePath.resolve(import.meta.dirname, "../../../..");

describe("Playbook Pack validator & installer", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it("validates bundled reference packs cleanly", () => {
    const autofix = validatePlaybookPack(NodePath.join(REPO_ROOT, "packs/bot-review-autofix"));
    expect(autofix.manifest.id).toBe("bot-review-autofix");
    expect(autofix.manifest.workflows?.length).toBe(1);
    expect(autofix.manifest.skills?.length).toBe(1);

    const release = validatePlaybookPack(NodePath.join(REPO_ROOT, "packs/release-readiness"));
    expect(release.manifest.id).toBe("release-readiness");
    expect(release.manifest.workflows?.length).toBe(1);
    expect(release.manifest.skills?.length).toBe(1);
  });

  it("installs workflows and skills into target directories and respects overwrite guard", () => {
    const sandbox = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "u3code-pack-test-"));
    tempDirs.push(sandbox);
    const workflowsDir = NodePath.join(sandbox, "workflows");
    const skillsDir = NodePath.join(sandbox, "skills");

    const first = installPlaybookPack({
      packDir: NodePath.join(REPO_ROOT, "packs/bot-review-autofix"),
      workflowsDir,
      skillsDir,
    });
    expect(first.installedWorkflows).toHaveLength(1);
    expect(first.installedSkills).toHaveLength(1);
    expect(NodeFS.existsSync(NodePath.join(workflowsDir, "bot-review-autofix.ts"))).toBe(true);
    expect(NodeFS.existsSync(NodePath.join(skillsDir, "workitem-delivery", "SKILL.md"))).toBe(true);

    // Second install without --force skips existing files cleanly
    const second = installPlaybookPack({
      packDir: NodePath.join(REPO_ROOT, "packs/bot-review-autofix"),
      workflowsDir,
      skillsDir,
    });
    expect(second.installedWorkflows).toHaveLength(0);
    expect(second.skippedWorkflows).toHaveLength(1);
    expect(second.skippedSkills).toHaveLength(1);

    // With --force, overwrites cleanly
    const forced = installPlaybookPack({
      packDir: NodePath.join(REPO_ROOT, "packs/bot-review-autofix"),
      workflowsDir,
      skillsDir,
      force: true,
    });
    expect(forced.installedWorkflows).toHaveLength(1);
    expect(forced.installedSkills).toHaveLength(1);
  });
});

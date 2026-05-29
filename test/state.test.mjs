import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJob, listJobs, resolveJobFile, resolveJobReference, saveState, updateJob, writeJob } from "../src/state.mjs";

test("state stores, updates, and resolves jobs by id prefix", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cmi-state-"));
  createJob(cwd, {
    id: "mimo-abc123",
    kind: "delegate",
    title: "MiMo copywrite",
    status: "queued",
    summary: "queued job",
  });
  updateJob(cwd, "mimo-abc123", {
    status: "completed",
    summary: "done",
    result: { summary: "done" },
  });

  const jobs = listJobs(cwd);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].status, "completed");
  assert.equal(resolveJobReference(cwd, "mimo-abc")?.id, "mimo-abc123");
  assert.equal(resolveJobReference(cwd, "")?.summary, "done");
});

test("state prunes old job artifacts outside the retained index", () => {
  const cwd = mkdtempSync(join(tmpdir(), "cmi-state-prune-"));
  writeJob(cwd, "mimo-old", { id: "mimo-old", status: "completed" });

  saveState(cwd, {
    jobs: [{
      id: "mimo-new",
      status: "completed",
      updatedAt: "2026-05-29T00:00:00.000Z",
    }],
  });

  assert.equal(existsSync(resolveJobFile(cwd, "mimo-old")), false);
});

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(root, "skills", "codex-mimo");
const dest = join(process.env.CODEX_HOME || join(homedir(), ".codex"), "skills", "codex-mimo");

mkdirSync(dirname(dest), { recursive: true });
rmSync(dest, { recursive: true, force: true });
cpSync(source, dest, { recursive: true });

console.log(`installed skill: ${dest}`);

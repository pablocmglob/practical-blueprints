#!/usr/bin/env node
/**
 * gen_agents.py — renders .coda/agents/<name>.md from .agents/roles/<name>.md.
 *
 * Usage:
 *   node tools/gen_agents.py --write   render generated files
 *   node tools/gen_agents.py --check   verify rendered files match (exit 1 on drift)
 *
 * Role files carry neutral frontmatter (name, description, tools, label,
 * isolation, hook). Generated files add a GENERATED header and the rendered
 * body. Nobody edits a generated file by hand; a policy test fails on drift.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const ROLES_DIR = path.join(ROOT, ".agents", "roles");
const OUT_DIR = path.join(ROOT, ".coda", "agents");

const GENERATED_MARK = "<!-- GENERATED from .agents/roles/%s.md by tools/gen_agents.py -- DO NOT EDIT BY HAND -->";

function parseFrontmatter(text, file) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) throw new Error(`role file ${file} has no frontmatter`);
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^(\w+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      value = value.replace(/^["']|["']$/g, "");
    }
    meta[kv[1]] = value;
  }
  if (!meta.name) {
    console.error(`gen_agents: role file ${file} has no 'name:' frontmatter`);
    process.exit(2);
  }
  return meta;
}

function render(roleFile, meta, body) {
  const tools = Array.isArray(meta.tools) ? meta.tools : (meta.tools ? meta.tools.split(/\s+/) : []);
  const lines = [];
  lines.push(GENERATED_MARK.replace("%s", path.basename(roleFile)));
  lines.push("---");
  lines.push(`name: ${meta.name}`);
  lines.push(`description: ${meta.description || ""}`);
  lines.push(`tools: ${JSON.stringify(tools)}`);
  lines.push(`label: ${meta.label || meta.name}`);
  if (meta.isolation) lines.push(`isolation: ${meta.isolation}`);
  if (meta.hook) lines.push(`hook: ${meta.hook}`);
  lines.push("---");
  lines.push("");
  lines.push(body.trimEnd());
  lines.push("");
  return lines.join("\n");
}

function main() {
  const mode = process.argv[2];
  if (mode !== "--write" && mode !== "--check") {
    console.error("usage: node tools/gen_agents.py --write | --check");
    process.exit(2);
  }
  const roleFiles = fs.readdirSync(ROLES_DIR).filter((f) => f.endsWith(".md")).sort();
  const expected = new Map();
  const errors = [];

  for (const f of roleFiles) {
    const full = path.join(ROLES_DIR, f);
    const raw = fs.readFileSync(full, "utf8");
    const meta = parseFrontmatter(raw, f);
    const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
    expected.set(meta.name, render(f, meta, body));
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const existing = new Set(
    fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR).filter((f) => f.endsWith(".md")) : []
  );

  const drifted = [];
  for (const [name, content] of expected) {
    const outFile = path.join(OUT_DIR, `${name}.md`);
    const exists = fs.existsSync(outFile);
    if (mode === "--write") {
      fs.writeFileSync(outFile, content);
      console.log(`gen_agents: wrote ${path.relative(ROOT, outFile)}`);
    } else if (!exists) {
      drifted.push(`${path.relative(ROOT, outFile)}: missing`);
    } else if (fs.readFileSync(outFile, "utf8") !== content) {
      drifted.push(`${path.relative(ROOT, outFile)}: drifted`);
    }
  }
  for (const f of existing) {
    const name = f.replace(/\.md$/, "");
    if (!expected.has(name)) drifted.push(`${path.join(OUT_DIR, f)}: orphaned (no role file)`);
  }

  if (mode === "--check") {
    if (drifted.length) {
      console.error("gen_agents: DRIFT detected:");
      for (const d of drifted) console.error(`  ${d}`);
      console.error("run: node tools/gen_agents.py --write");
      process.exit(1);
    }
    console.log(`gen_agents: OK (${expected.size} agents in sync)`);
  }
}

main();

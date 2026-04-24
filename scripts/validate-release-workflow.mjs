import fs from "node:fs";
import assert from "node:assert/strict";

const workflow = fs.readFileSync(".github/workflows/release.yml", "utf8");

const requiredSnippets = [
  "push:",
  "branches: [main]",
  "permissions:",
  "contents: write",
  "cargo test --workspace",
  "cargo clippy --workspace --all-targets -- -D warnings",
  "-A clippy::uninlined_format_args",
  "npm test",
  "npm run lint",
  "npm run build",
  "cargo tauri build",
  "main-",
  "git tag",
  "git push origin",
  "gh release create",
  "gh release upload",
  "target/release/bundle/deb/*.deb",
  "target/release/bundle/appimage/*.AppImage",
];

for (const snippet of requiredSnippets) {
  assert.ok(
    workflow.includes(snippet),
    "release.yml must include: " + snippet,
  );
}

assert.ok(
  /needs:\s*verify/.test(workflow),
  "build/publish job must depend on the verification job",
);

console.log("release workflow contract is valid");

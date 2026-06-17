const fs = require("fs");
const path = require("path");

const root = process.cwd();
const pairs = [
  {
    from: path.join(root, "src", "templates"),
    to: path.join(root, "dist", "templates"),
    type: "dir",
  },
  {
    from: path.join(root, "src", "coreControl", "keystone_ci_addition.yaml"),
    to: path.join(root, "dist", "coreControl", "keystone_ci_addition.yaml"),
    type: "file",
  },
];

for (const pair of pairs) {
  if (!fs.existsSync(pair.from)) {
    continue;
  }

  if (pair.type === "dir") {
    fs.rmSync(pair.to, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(pair.to), { recursive: true });
    fs.cpSync(pair.from, pair.to, { recursive: true, force: true });
    continue;
  }

  fs.mkdirSync(path.dirname(pair.to), { recursive: true });
  fs.copyFileSync(pair.from, pair.to);
}

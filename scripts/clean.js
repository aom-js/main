const fs = require("node:fs");
const path = require("node:path");
const packages = require("./packages");
const files = require("./files");

packages.forEach((package) => {
  // удалим сборочные конфиги
  files.buildsConfig.forEach((config) => {
    const tsconfig = path.join(package, config);
    if (fs.existsSync(tsconfig)) {
      fs.rmSync(tsconfig);
    }
  });
  const distDir = path.join(package, "dist");
  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { force: true, recursive: true });
  }
  // восстановим нулевой package.json из исходного
  const packageJsonFile = path.join(package, "package.json");
  const packageJson = {};
  files.srcPackageJsons.forEach((fileName) => {
    const srcPackageFile = path.join(package, fileName);
    const srcPackageJson = fs.readFileSync(srcPackageFile).toString();
    Object.assign(packageJson, JSON.parse(srcPackageJson));
  });
  fs.writeFileSync(packageJsonFile, JSON.stringify(packageJson, null, 2));
  console.log(`${package} clean for development`);
});

const fs = require("node:fs");
const path = require("node:path");
const packages = require("./packages");
const files = require("./files");

const distPackageJsonFile = path.join(__dirname, "./jsons", files.distPackageJson);
const distPackageJson = require(distPackageJsonFile);
// одна версия на все пакеты — корневая (https://aom.js.org/publishing/)
const { version } = require("../package.json");

packages.forEach((package) => {
  // создадим сборочные конфиги
  files.buildsConfig.forEach((config) => {
    const sourceConfig = path.join(__dirname, "./jsons", config);
    const destConfig = path.join(package, config);
    fs.copyFileSync(sourceConfig, destConfig);
  });

  const resultPackageJson = { version };
  // создадим результирующий конфиг для билда
  files.srcPackageJsons.forEach((fileName) => {
    const srcPackageJsonFile = path.join(package, fileName);
    const srcPackageJson = require(srcPackageJsonFile);
    Object.assign(resultPackageJson, srcPackageJson);
  });
  // шаблон задаёт ".", пакет может добавить свои точки входа (router: "./testing")
  const ownExports = resultPackageJson.exports;
  Object.assign(resultPackageJson, distPackageJson);
  resultPackageJson.exports = { ...distPackageJson.exports, ...ownExports };
  // const resultPackageJson = { ...srcPackageJson, ...distPackageJson };
  const resultPackageJsonFile = path.join(package, "package.json");
  fs.writeFileSync(resultPackageJsonFile, JSON.stringify(resultPackageJson, null, 2));
  console.log(`${package} ready for build`);
});

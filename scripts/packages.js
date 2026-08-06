const fs = require("node:fs");
const path = require("node:path");

const packagesDir = "../packages";

const packages = fs
  .readdirSync(path.join(__dirname, packagesDir))
  .map((package) => path.resolve(path.join(__dirname, "../packages", package)))
  .filter((value) => fs.statSync(value).isDirectory());

module.exports = packages;

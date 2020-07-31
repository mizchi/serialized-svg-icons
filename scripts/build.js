const cheerio = require("cheerio");
const glob = require("glob-promise");
const path = require("path");
const fs = require("fs/promises");
const camelcase = require("camelcase");
const findPackage = require("find-package");
const { icons } = require("../src/icons");

// file path
const rootDir = path.resolve(__dirname, "../");
const DIST = path.resolve(rootDir, ".");
const LIB = path.resolve(rootDir, "./lib");

// logic

async function getIconFiles(content) {
  return glob(content.files);
}
async function convertIconData(svg, multiColor) {
  const $svg = cheerio.load(svg, { xmlMode: true })("svg");

  // filter/convert attributes
  // 1. remove class attr
  // 2. convert to camelcase ex: fill-opacity => fillOpacity
  const attrConverter = (
    /** @type {{[key: string]: string}} */ attribs,
    /** @type string */ tagName
  ) =>
    attribs &&
    Object.keys(attribs)
      .filter(
        (name) =>
          ![
            "class",
            ...(tagName === "svg"
              ? ["xmlns", "xmlns:xlink", "xml:space", "width", "height"]
              : []), // if tagName is svg remove size attributes
          ].includes(name)
      )
      .reduce((obj, name) => {
        const newName = camelcase(name);
        switch (newName) {
          case "fill":
            if (attribs[name] === "none" || multiColor) {
              obj[newName] = attribs[name];
            }
            break;
          default:
            obj[newName] = attribs[name];
            break;
        }
        return obj;
      }, {});

  // convert to [ { tag: 'path', attr: { d: 'M436 160c6.6 ...', ... }, child: { ... } } ]
  const elementToTree = (/** @type {Cheerio} */ element) =>
    element
      .filter((_, e) => e.tagName && !["style"].includes(e.tagName))
      .map((_, e) => ({
        tag: e.tagName,
        attr: attrConverter(e.attribs, e.tagName),
        child:
          e.children && e.children.length
            ? elementToTree(cheerio(e.children))
            : undefined,
      }))
      .get();

  const tree = elementToTree($svg);
  return tree[0]; // like: [ { tag: 'path', attr: { d: 'M436 160c6.6 ...', ... }, child: { ... } } ]
}
function generateIconRow(icon, formattedName, iconData) {
  return `export const ${formattedName} = ${JSON.stringify(iconData)};\n`;
}

async function dirInit() {
  const ignore = (err) => {
    if (err.code === "EEXIST") return;
    throw err;
  };
  for (const icon of icons) {
    await fs.mkdir(path.resolve(DIST, icon.id)).catch(ignore);
  }
}
async function writeIconModule(icon) {
  const exists = new Set(); // for remove duplicate
  for (const content of icon.contents) {
    const files = await getIconFiles(content);
    console.log(icon.id, files.length);
    for (const file of files) {
      // console.log("file", file);
      const svgStr = await fs.readFile(file, "utf8");
      const iconData = await convertIconData(svgStr, content.multiColor);
      const rawName = path.basename(file, path.extname(file));
      const pascalName = camelcase(rawName, { pascalCase: true });
      const name =
        (content.formatter && content.formatter(pascalName)) || pascalName;
      if (exists.has(name)) continue;
      exists.add(name);

      const modRes = generateIconRow(icon, name, iconData);
      await fs.appendFile(
        path.resolve(DIST, icon.id, "index.js"),
        modRes,
        "utf8"
      );
      exists.add(file);
    }
  }
}

async function writeLicense() {
  const iconLicenses =
    icons
      .map((icon) =>
        [
          `${icon.name} - ${icon.projectUrl}`,
          `License: ${icon.license} ${icon.licenseUrl}`,
        ].join("\n")
      )
      .join("\n\n") + "\n";

  await fs.copyFile(
    path.resolve(rootDir, "LICENSE_HEADER"),
    path.resolve(rootDir, "LICENSE")
  );
  await fs.appendFile(path.resolve(rootDir, "LICENSE"), iconLicenses, "utf8");
}

async function main() {
  try {
    await dirInit();
    await writeLicense();
    for (const icon of icons) {
      await writeIconModule(icon);
    }
    console.log("done");
  } catch (e) {
    console.error(e);
  }
}
main();

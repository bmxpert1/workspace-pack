#!/usr/bin/env node

const {resolve} = require("path");
const archiver = require("archiver-promise");
const glob = require("fast-glob");
const {existsSync, copySync, removeSync, ensureDirSync} = require("fs-extra");
const mri = require("mri");
const resolveDependencies = require("../lib/resolveDependencies");

const args = mri(process.argv.slice(2), {
    default: {
        "root-dir": process.cwd(),
        "build-dir": "_build",
        "out-dir": "dist",
        "layer": false
    },
    string: ["root-dir", "build-dir", "out-dir", "zip-name"],
    boolean: ["layer"],
});

let rootDir = args["root-dir"];

const workspacePkg = require(resolve(rootDir, "package.json"));
if (!workspacePkg.workspaces) {
    throw new Error(
        "You must specify a `workspaces` field in your workspaces's package.json."
    );
}

if (!Array.isArray(workspacePkg.workspaces) && !Array.isArray(workspacePkg.workspaces.packages)) {
    throw new Error(
        "The specified `workspaces` field in your package.json must either by an array or an object containing an array with the key `packages`."
    );
}

const localPackages = glob.sync(Array.isArray(workspacePkg.workspaces) ? workspacePkg.workspaces : workspacePkg.workspaces.packages, {
    cwd: rootDir,
    onlyDirectories: true
});

let pkgDir;
const [folder] = args._;
if (folder) {
    pkgDir = localPackages.find(dir => dir.split("/").pop() === folder);
} else {
    pkgDir = process.cwd();
}

if (!pkgDir) {
    throw new Error(`Folder \`${folder}\` was not found.`);
}

const pkg = require(resolve(rootDir, pkgDir, "package.json"));
if (!pkg) {
    throw new Error(`package.json \`${resolve(rootDir, pkgDir, "package.json")}\` was not found.`);
}

const localModules = [];
for (const dir of localPackages) {
    try {
        const pkg = require(resolve(rootDir, dir, "package.json"));
        localModules.push(pkg);
    } catch (e) {
    }
}

const buildDir = resolve(rootDir, args["build-dir"]);
removeSync(buildDir);

const main = async () => {
    let pkgTargetFolder = buildDir;
    let nodePrefixFolder = resolve(buildDir, "node_modules");
    if (args["layer"]) {
        nodePrefixFolder = resolve(buildDir, 'nodejs', "node_modules");
        pkgTargetFolder = resolve(nodePrefixFolder, pkg.name);
    }

    // copy package to build folder
    copySync(resolve(rootDir, pkgDir), pkgTargetFolder);
    ensureDirSync(resolve(rootDir, pkgDir, "node_modules"));

    // resolve dependencies
    const deps = await resolveDependencies(pkg.dependencies, localModules, [resolve("node_modules"), resolve(rootDir, pkgDir, "node_modules")]);

    // copy dependencies to node_modules
    deps
        .filter((value, index, self) => self.indexOf(value) === index)
        .map(dep => {
            const versionIndex = dep.lastIndexOf("@");
            const dirName = versionIndex <= 0 ? dep : dep.substr(0, versionIndex);
            const dir = resolve(rootDir, "node_modules", dirName);
            if (!existsSync(dir)) return;

            copySync(dir, resolve(nodePrefixFolder, dirName), {
                dereference: true
            });
        });

    // package into zip
    const outDir = resolve(rootDir, args['out-dir']);
    ensureDirSync(outDir);
    const output = args['zip-name'] || `${pkg.name.replace("/", "-")}.zip`;
    const zipFile = resolve(outDir, output);
    const zip = archiver(zipFile, {store: true});
    zip.directory(buildDir, false);
    await zip.finalize();
    console.log(`Zip created ${zipFile}`)

    // remove build folder
    removeSync(buildDir);
};

main()
    .then(() => process.exit())
    .catch(e => console.error(e) && process.exit(1));

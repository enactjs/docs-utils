#!/usr/bin/env node

'use strict';

/* eslint-env node */
// For `--standalone` the `--path` needs to include the library name or point to `packages`, no
//	trailing `/`.  Defaults to the current working directory.

// TODO: Allow for configuring output and input dirs better
// TODO: Consider returning useful values from functions instead of just outputting/saving/etc.

const shelljs = require('shelljs'),
	fs = require('fs'),
	pathModule = require('path'),
	ProgressBar = require('progress'),
	documentation = require('documentation'),
	elasticlunr = require('elasticlunr'),
	jsonata = require('jsonata'),
	readdirp = require('readdirp'),
	mkdirp = require('mkdirp'),
	toc = require('markdown-toc'),
	jsonfile = require('jsonfile'),
	chalk = require('chalk'),
	matter = require('gray-matter'),
	parseArgs = require('minimist');

const dataDir = 'src/data';
const docVersionFile = `${dataDir}/docVersion.json`;
const libraryDescriptionFile = `${dataDir}/libraryDescription.json`;
const libraryDescription = {};
const allRefs = {};
const allStatics = [];
const allLinks = {};
const allLibraries = {};
const allModules = [];

// Documentation.js output is pruned for file size.  The following keys will be deleted:
const keysToIgnore = ['lineNumber', 'position', 'code', 'loc', 'context', 'path', 'loose', 'checked', 'todos', 'errors'];
// These are allowed 'errors' in the documentation.  These are our custom tags.
const allowedErrorTags = ['@curried', '@hoc', '@hocconfig', '@omit', '@required', '@template', '@ui'];

/**
 * Scans the specified repos in the `raw` directory for files containing `@module`.
 *
 * @param {string[]} paths - An array of directories to scan for files
 * @param {string} [pattern=*.js] - An optional regex string to be used for filtering files
 * 	by default, `raw/enact/packages` will be scanned.
 * @returns {string[]} - A list of paths of matching files
 */
const getValidFiles = (paths, pattern = '*.js') => {
	const files = [];

	paths.forEach(path => {
		const grepCmd = `grep -r -l "@module" ${path} --exclude-dir={build,node_modules,sampler,samples,tests,dist,coverage} --include=${pattern}`;
		const moduleFiles = shelljs.exec(grepCmd, {silent: true});
		Array.prototype.push.apply(files, moduleFiles.stdout.trim().split('\n'));
		console.log(grepCmd);
	});

	console.log(files);

	return files;
};

/**
 * Scans a list of files for documentation and writes them into './src/pages/docs/modules' separated
 * in directories by module. Module name is inferred from filename.
 *
 * @param {string[]} paths - A list of paths to parse. Note that additional files in the specified
 *	directory will be scanned (e.g. `Panels/index.js` will scan all files in `Panels`).
 * @param {boolean} strict - If `true`, the process exit code will be set if any warnings exist
 * @param {boolean} noSave - If `true`, no files are written to disk
 * @returns {Promise[]} - An array of promises that represent the scanning process
 */
const getDocumentation = (paths, strict, noSave) => {
	const docOutputPath = '/src/pages/docs/modules';
	// TODO: Add @module to all files and scan files and combine json
	const validPaths = paths.reduce((prev, path) => {
		return prev.add(path.split('/').slice(0, -1).join('/'));
	}, new Set());
	const promises = [];

	const bar = new ProgressBar('Parsing: [:bar] (:current/:total) :file',
		{total: validPaths.size, width: 20, complete: '#', incomplete: ' '});

	validPaths.forEach(function (path) {
		// TODO: If we do change it to scan each file rather than directory we need to fix componentDirectory matching
		let componentDirectory = path.split('packages/')[1] || path.split('raw/')[1] || path.split('/').slice(-2).join('/');
		const basePath = process.cwd() + docOutputPath;
		// Check for 'spotlight/src' and anything similar
		let componentDirParts = componentDirectory && componentDirectory.split('/');
		if ((Array.isArray(componentDirParts) && componentDirParts.length > 1) && (componentDirParts.pop() === 'src')) {
			componentDirectory = componentDirParts.join('/');
		}

		promises.push(documentation.build(path, {shallow: true}).then(output => {
			bar.tick({file: componentDirectory});
			if (output.length) {

				validate(output, componentDirectory, strict);

				if (!noSave) {
					const outputPath = basePath + '/' + componentDirectory;
					shelljs.mkdir('-p', outputPath);
					const stringified = JSON.stringify(output, (k, v) => {
						if (k === 'errors' && v.length !== 0) {
							v.forEach(err => {
								const shortMsg = err.message ? err.message.replace('unknown tag ', '') : '';
								if (!shortMsg) {
									// eslint-disable-next-line no-console
									console.log(chalk.red(`\nParse error: ${err} in ${chalk.white(path)}`));
								} else if (!allowedErrorTags.includes(shortMsg)) {
									// eslint-disable-next-line no-console
									console.log(chalk.red(`\nParse error: ${err.message} in ${chalk.white(path)}:${chalk.white(err.commentLineNumber)}`));
								}
							});
						}
						return (keysToIgnore.includes(k)) ? void 0 : v;
					}, 2);

					fs.writeFileSync(outputPath + '/index.json', stringified, 'utf8');
				}
			}
		}).catch((err) => {
			process.exitCode = 2;
			console.log(chalk.red(`Unable to process ${path}: ${err}`));	// eslint-disable-line no-console
			bar.tick({file: componentDirectory});
		}));
	});
	return Promise.all(promises);
};

function docNameAndPosition (doc) {
	const filename = doc.context.file.replace(/.*\/raw\/enact\//, '');
	return `${doc.name ? doc.name + ' in ' : ''}${filename}:${doc.context.loc.start.line}`;
}

function warn (msg, strict) {
	console.log(chalk.red(msg));	// eslint-disable-line no-console
	if (strict && !process.exitCode) {
		process.exitCode = 1;
	}
}

/**
 * Performs a series of validations to ensure that the passed documentation is well formed.
 *
 * @param {object} docs - An object containing the docs to be validated
 * @param {string} componentDirectory - The directory source for the doc
 * @param {boolean} strict - If `true`, the process exit code will be set if any warnings exist
 * @private
 */
function validate (docs, componentDirectory, strict) {
	let first = true;
	function prettyWarn (msg) {
		if (first) {	// bump to next line from progress bar
			console.log('');	// eslint-disable-line no-console
			first = false;
		}
		warn(msg, strict);
	}

	function pushRef (ref, type, name, context) {
		if (!allRefs[ref]) {
			allRefs[ref] = [];
		}
		allRefs[ref].push({type, name, context});
	}

	// Find all @see tags with the context of the owner, return object with arrays of tags/context
	const findSees = '**.*[tags[title="see"]] {"tags": [tags[title="see"]], "context": [context]}',
		validSee = /({@link|http)/,
		findLinks = "**[type='link'].url[]";
		// TODO: findLinks with context: http://try.jsonata.org/BJv4E4UgL

	if (docs.length > 1) {
		const doclets = docs.map(docNameAndPosition).join('\n');
		prettyWarn(`Too many doclets (${docs.length}):\n${doclets}`);
	}
	if ((docs[0].path) && (docs[0].path[0].kind === 'module')) {
		if (docs[0].path[0].name !== componentDirectory) {
			prettyWarn(`Module name (${docs[0].path[0].name}) does not match path: ${componentDirectory} in ${docNameAndPosition(docs[0])}`);
		}
	} else {
		prettyWarn(`First item not a module: ${docs[0].path[0].name} (${docs[0].path[0].kind}) in ${docNameAndPosition(docs[0])}`);
	}

	if (docs[0].members && docs[0].members.static.length) {
		const uniques = {};
		docs[0].members.static.forEach(member => {
			const name = member.name;
			if (uniques[name]) {
				prettyWarn(`Duplicate module member ${docNameAndPosition(member)}, original: ${docNameAndPosition(uniques[name])}`);
			} else {
				uniques[name] = member;
				allStatics.push(`${member.memberof}.${member.name}`);
			}
			member.tags.forEach(tag => {
				switch (tag.title) {
					case 'extends':
					case 'mixes':
						pushRef(tag.name, tag.title, name, member.context);
						break;
				}
			});
		});
	}

	const sees = jsonata(findSees).evaluate(docs[0]);
	if (sees.tags) {
		sees.tags.forEach((see, idx) => {
			if (!validSee.test(see.description)) {
				const filename = sees.context[idx].file.replace(/.*\/raw\/enact\//, '');
				prettyWarn(`Potentially invalid @see '${chalk.white(see.description)}' at ${chalk.white(filename)}:${chalk.white(see.lineNumber)}`);
			}
		});
	}

	const links = jsonata(findLinks).evaluate(docs[0]);
	if (links) {
		links.forEach(link => {
			if (!allLinks[link]) {
				allLinks[link] = [];
			}
			if (!allLinks[link].includes(docs[0].name)) {
				allLinks[link].push(docs[0].name);
			}
		});
	}
	allModules.push(docs[0].name);
	const library = docs[0].name.split('/')[0];
	allLibraries[library] = true;
}

/**
 * Runs post-processing on the imported docs to check for cross-link errors, missing references
 * and more. Depends on global data generated by `getDocumentation`.
 *
 * @param {boolean} strict - If `true`, the process exit code will be set if any warnings exist
 * @param {boolean} ignoreExternal - If `true`, any modules not scanned will be excluded from
 *	validation (i.e. standalone libraries will not warn for referencing core libraries)
 */
function postValidate (strict, ignoreExternal) {
	const moduleRegex = /^((\w+\/\w+)(\.\w+)?)/,
		exceptions = ['spotlight/Spotlight'];

	Object.keys(allRefs).forEach(ref => {
		const library = ref.split('/')[0],
			ignore = ignoreExternal && !allLibraries[library];
		if (!ignore && !allStatics.includes(ref)) {
			warn(`Invalid reference: ${ref}:`, strict);
			allRefs[ref].forEach(info => {
				warn(`    type: ${info.type} - ${docNameAndPosition(info)}`, strict);
			});
		}
	});

	Object.keys(allLinks).forEach(link => {
		const library = link.split('/')[0],
			ignore = ignoreExternal && !allLibraries[library];

		if (ignore) {
			return;
		}

		const match = moduleRegex.exec(link);

		if (match && !exceptions.includes(match[2])) {
			if (match[3]) {
				if (!allStatics.includes(match[0])) {
					warn(`Invalid link: ${link}:`, strict);
					allLinks[link].forEach(mod => {
						warn(`    Used in: ${mod}`, strict);
					});
				}
			} else if (!allModules.includes(match[0])) {
				warn(`Invalid link: ${link}:`, strict);
				allLinks[link].forEach(mod => {
					warn(`    Used in: ${mod}`, strict);
				});
			}
		}
	});
}

function parseTableOfContents (frontMatter, body) {
	let maxdepth = 2;
	const tocConfig = frontMatter.match(/^toc: ?(\d+)$/m);
	if (tocConfig) {
		maxdepth = Number.parseInt(tocConfig[1]);
	}

	const table = toc(body, {maxdepth});
	if (table.json.length < 3) {
		return '';
	}

	return `
<nav role="navigation" class="page-toc">

${table.content}

</nav>
`;
}

function prependTableOfContents (contents) {
	let table = '';
	let frontMatter = '';
	let body = contents;

	if (contents.startsWith('---')) {
		const endOfFrontMatter = contents.indexOf('---', 4) + 3;
		frontMatter = contents.substring(0, endOfFrontMatter);
		body = contents.substring(endOfFrontMatter);

		table = parseTableOfContents(frontMatter, body);
	}

	return `${frontMatter}${table}\n${body}`;
}

/**
 * Copies static (markdown) documentation from a library into the documentation site.
 *
 * @param {object} config
 * @param {string} config.source - Path to search for docs directory (parent of docs dir)
 * @param {string} config.outputTo - Path to copy static docs
 * @param {boolean} [config.getLibraryDescription=false] - Extract package description from
 *	`README.md`
 */
function copyStaticDocs ({source, outputTo: outputBase, getLibraryDescription = false}) {
	const findIgnores = '-type d -regex \'.*/(node_modules|build|sampler|samples|tests|coverage)\' -prune',
		findBase = 'find -E -L',
		findTarget = getLibraryDescription ? '-iname "readme.md"' : '-type f -path "*/docs/*"';

	const findCmd = `${findBase} ${source} ${findIgnores} -o ${findTarget} -print`;

	const docFiles = shelljs.exec(findCmd, {silent: true});
	const files = docFiles.stdout.trim().split('\n');

	if ((files.length < 1) || !files[0]) {	// Empty search has single empty string in array
		console.error('Unable to find docs in', source);	// eslint-disable-line no-console
		process.exit(2);
	}

	console.log(`Processing ${source}`);	// eslint-disable-line no-console

	files.forEach((file) => {
		let outputPath = outputBase;
		let currentLibrary = '';
		const relativeFile = pathModule.relative(source, file);
		const ext = pathModule.extname(relativeFile);
		const base = pathModule.basename(relativeFile);
		// Cheating, discard 'raw' and get directory name -- this will work with 'enact/packages'
		const packageName = source.replace(/raw\/([^/]*)\/(.*)?/, '$1/blob/develop/$2');
		let githubUrl = `github: https://github.com/enactjs/${packageName}${relativeFile}\n`;

		if (relativeFile.indexOf('docs') !== 0) {
			currentLibrary = getLibraryDescription ? pathModule.dirname(relativeFile) : currentLibrary;
			const librarypathModule = getLibraryDescription ? currentLibrary : pathModule.dirname(pathModule.relative('packages/', relativeFile)).replace('/docs', '');

			outputPath += librarypathModule + '/';
		} else {
			const pathPart = pathModule.dirname(pathModule.relative('docs/', relativeFile));

			outputPath += pathPart + '/';
		}

		// TODO: Filter links and fix them
		// Normalize path because './' in outputPath blows up mkdir
		shelljs.mkdir('-p', pathModule.normalize(outputPath));
		if (ext === '.md') {
			let contents = fs.readFileSync(file, 'utf8')
				.replace(/(---\ntitle:.*)\n/, '$1\n' + githubUrl)
				.replace(/(\((?!http)[^)]+)(\/index.md)/g, '$1/')		// index files become 'root' for new directory
				.replace(/(\((?!http)[^)]+)(.md)/g, '$1/');			// other .md files become new directory under root
			if (file.indexOf('index.md') === -1) {
				contents = contents.replace(/\]\(\.\//g, '](../');	// same level .md files are now relative to root
				if (getLibraryDescription) {
					// grabbing the description from the each library `README.MD` which is the sentence that starts with the character `>`. Adding each description into a js object.
					const description = contents.split('\n')[2].split('> ')[1];
					libraryDescription[currentLibrary] = description;
				}
			}
			if (!getLibraryDescription) {
				contents = prependTableOfContents(contents);
				fs.writeFileSync(outputPath + base, contents, {encoding: 'utf8'});
			}
		} else {
			shelljs.cp(file, outputPath);
		}
	});
}

/**
 * Generates an elasticlunr index from markdown files in `src/pages` and json files in
 * `src/pages/docs/modules`.
 *
 * @param {string} outputFilename - Filename for the generated index file
 */
function generateIndex (docIndexFile) {
	// Note: The $map($string) is needed because spotlight has a literal 'false' in a return type!
	const expression = `{
	  "title": name,
	  "description": $join(description.**.value, ' '),
	  "memberDescriptions": $join(members.**.value ~> $map($string), ' '),
	  "members": $join(**.members.*.name,' ')
	}`;

	const elasticlunrNoStem = function (config) {
		let idx = new elasticlunr.Index();

		idx.pipeline.add(
			elasticlunr.trimmer,
			elasticlunr.stopWordFilter
		);

		if (config) config.call(idx, idx);

		return idx;
	};

	let index = elasticlunrNoStem(function () {
		this.addField('title');
		this.addField('description');
		this.addField('members');
		this.addField('memberDescriptions');
		this.setRef('id');
		this.saveDocument(false);
	});

	console.log('Generating search index...');	// eslint-disable-line no-console

	readdirp({root: 'src/pages/docs/modules', fileFilter: '*.json'}, (err, res) => {
		if (!err) {
			res.files.forEach(result => {
				const filename = result.fullPath;
				const json = jsonfile.readFileSync(filename);
				try {
					const doc = jsonata(expression).evaluate(json);
					// Because we don't save the source data with the index, we only have access to
					// the ref (id). Include both the human-readable title and the path to the doc
					// in the ref so we can parse it later for display.
					doc.id = `${doc.title}|docs/modules/${doc.title}`;
					index.addDoc(doc);
				} catch (ex) {
					console.log(chalk.red(`Error parsing ${result.path}`));	// eslint-disable-line no-console
					console.log(chalk.red(ex));	// eslint-disable-line no-console
				}
			});
		} else {
			console.error(chalk.red('Unable to find parsed documentation!'));	// eslint-disable-line no-console
			process.exit(2);
		}

		readdirp({root: 'src/pages/', fileFilter: '*.md'}, (_err, _res) => {
			if (!_err) {
				_res.files.forEach(result => {
					const filename = result.fullPath;
					const data = matter.read(filename);
					const title = data.data.title || pathModule.parse(filename).name;
					const id = `${title}|${pathModule.relative('src/pages/', pathModule.dirname(filename))}`;

					try {
						index.addDoc({id, title, description: data.content});
					} catch (ex) {
						console.log(chalk.red(`Error parsing ${result.path}`));	// eslint-disable-line no-console
						console.log(chalk.red(ex));	// eslint-disable-line no-console
					}
				});
				makeDataDir();
				jsonfile.writeFileSync(docIndexFile, index.toJSON());
			} else {
				console.error(chalk.red('Unable to find parsed documentation!'));	// eslint-disable-line no-console
				process.exit(2);
			}
		});
	});
	generateLibraryDescription();
}

function makeDataDir () {
	mkdirp.sync(dataDir);
}

function generateLibraryDescription () {
	const exportContent = JSON.stringify(libraryDescription);
	makeDataDir();
	// generate a json file that contains the description to the corresponding libraries
	fs.writeFileSync(libraryDescriptionFile, exportContent, {encoding: 'utf8'});
}

/**
 * Generates a json file with the current Enact version number as read from raw/enact/package.json
 * TODO: Generate this for all scanned packages
 */
function generateDocVersion () {
	const packageInfo = jsonfile.readFileSync('raw/enact/package.json');
	const version = JSON.stringify({docVersion: packageInfo.version});
	makeDataDir(); // just in case
	fs.writeFileSync(docVersionFile, version, {encoding: 'utf8'});
}

/**
 * Check for standalone mode and process if so
 * @private
 */
function init () {
	const args = parseArgs(process.argv);
	const standalone = args.standalone,
		strict = args.strict,
		path = args.path || process.cwd(),
		pattern = args.pattern;

	if (standalone) {
		const files = getValidFiles([path], pattern);
		getDocumentation(files, strict, true)
			.then(() => postValidate(strict, true));
	}
}

init();

module.exports = {
	getValidFiles,
	getDocumentation,
	postValidate,
	copyStaticDocs,
	generateDocVersion,
	generateIndex
};

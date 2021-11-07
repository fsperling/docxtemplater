const { DOMParser, XMLSerializer } = require("@xmldom/xmldom");
const { throwXmlTagNotFound } = require("./errors.js");
const { last, first } = require("./utils.js");

function parser(tag) {
	return {
		get(scope) {
			if (tag === ".") {
				return scope;
			}
			return scope[tag];
		},
	};
}

function setSingleAttribute(partValue, attr, attrValue) {
	const regex = new RegExp(`(<.* ${attr}=")([^"]*)(".*)$`);
	if (regex.test(partValue)) {
		return partValue.replace(regex, `$1${attrValue}$3`);
	}
	let end = partValue.lastIndexOf("/>");
	if (end === -1) {
		end = partValue.lastIndexOf(">");
	}
	return (
		partValue.substr(0, end) + ` ${attr}="${attrValue}"` + partValue.substr(end)
	);
}

function getSingleAttribute(value, attributeName) {
	const index = value.indexOf(`${attributeName}="`);
	if (index === -1) {
		return null;
	}
	const startIndex = value.substr(index).search(/["']/) + index;
	const endIndex = value.substr(startIndex + 1).search(/["']/) + startIndex;
	return value.substr(startIndex + 1, endIndex - startIndex);
}

function endsWith(str, suffix) {
	return str.indexOf(suffix, str.length - suffix.length) !== -1;
}
function startsWith(str, prefix) {
	return str.substring(0, prefix.length) === prefix;
}

function uniq(arr) {
	const hash = {},
		result = [];
	for (let i = 0, l = arr.length; i < l; ++i) {
		if (!hash[arr[i]]) {
			hash[arr[i]] = true;
			result.push(arr[i]);
		}
	}
	return result;
}

function chunkBy(parsed, f) {
	return parsed
		.reduce(
			function (chunks, p) {
				const currentChunk = last(chunks);
				const res = f(p);
				if (res === "start") {
					chunks.push([p]);
				} else if (res === "end") {
					currentChunk.push(p);
					chunks.push([]);
				} else {
					currentChunk.push(p);
				}
				return chunks;
			},
			[[]]
		)
		.filter(function (p) {
			return p.length > 0;
		});
}

const defaults = {
	errorLogging: true,
	paragraphLoop: false,
	nullGetter(part) {
		return part.module ? "" : "undefined";
	},
	xmlFileNames: [],
	parser,
	linebreaks: false,
	fileTypeConfig: null,
	delimiters: {
		start: "{",
		end: "}",
	},
};

function mergeObjects() {
	const resObj = {};
	let obj, keys;
	for (let i = 0; i < arguments.length; i += 1) {
		obj = arguments[i];
		keys = Object.keys(obj);
		for (let j = 0; j < keys.length; j += 1) {
			resObj[keys[j]] = obj[keys[j]];
		}
	}
	return resObj;
}

function xml2str(xmlNode) {
	const a = new XMLSerializer();
	return a.serializeToString(xmlNode).replace(/xmlns(:[a-z0-9]+)?="" ?/g, "");
}

function str2xml(str) {
	if (str.charCodeAt(0) === 65279) {
		// BOM sequence
		str = str.substr(1);
	}
	const parser = new DOMParser();
	return parser.parseFromString(str, "text/xml");
}

const charMap = [
	["&", "&amp;"],
	["<", "&lt;"],
	[">", "&gt;"],
	['"', "&quot;"],
	["'", "&apos;"],
];

function escapeRegExp(str) {
	// to be able to use a string as a regex
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const charMapRegexes = charMap.map(function ([endChar, startChar]) {
	return {
		rstart: new RegExp(escapeRegExp(startChar), "g"),
		rend: new RegExp(escapeRegExp(endChar), "g"),
		start: startChar,
		end: endChar,
	};
});

function wordToUtf8(string) {
	let r;
	for (let i = charMapRegexes.length - 1; i >= 0; i--) {
		r = charMapRegexes[i];
		string = string.replace(r.rstart, r.end);
	}
	return string;
}

function utf8ToWord(string) {
	if (typeof string !== "string") {
		string = string.toString();
	}
	let r;
	for (let i = 0, l = charMapRegexes.length; i < l; i++) {
		r = charMapRegexes[i];
		string = string.replace(r.rend, r.start);
	}
	return string;
}

// This function is written with for loops for performance
function concatArrays(arrays) {
	const result = [];
	for (let i = 0; i < arrays.length; i++) {
		const array = arrays[i];
		for (let j = 0, len = array.length; j < len; j++) {
			result.push(array[j]);
		}
	}
	return result;
}

const spaceRegexp = new RegExp(String.fromCharCode(160), "g");
function convertSpaces(s) {
	return s.replace(spaceRegexp, " ");
}
function pregMatchAll(regex, content) {
	/* regex is a string, content is the content. It returns an array of all matches with their offset, for example:
		 regex=la
		 content=lolalolilala
returns: [{array: {0: 'la'},offset: 2},{array: {0: 'la'},offset: 8},{array: {0: 'la'} ,offset: 10}]
*/
	const matchArray = [];
	let match;
	while ((match = regex.exec(content)) != null) {
		matchArray.push({ array: match, offset: match.index });
	}
	return matchArray;
}

function isEnding(value, element) {
	return value === "</" + element + ">";
}

function isStarting(value, element) {
	return (
		value.indexOf("<" + element) === 0 &&
		[">", " "].indexOf(value[element.length + 1]) !== -1
	);
}

function getRight(parsed, element, index) {
	const val = getRightOrNull(parsed, element, index);
	if (val !== null) {
		return val;
	}
	throwXmlTagNotFound({ position: "right", element, parsed, index });
}

function getRightOrNull(parsed, elements, index) {
	if (typeof elements === "string") {
		elements = [elements];
	}
	let level = 1;
	for (let i = index, l = parsed.length; i < l; i++) {
		const part = parsed[i];
		for (let j = 0, len = elements.length; j < len; j++) {
			const element = elements[j];
			if (isEnding(part.value, element)) {
				level--;
			}
			if (isStarting(part.value, element)) {
				level++;
			}
			if (level === 0) {
				return i;
			}
		}
	}
	return null;
}

function getLeft(parsed, element, index) {
	const val = getLeftOrNull(parsed, element, index);
	if (val !== null) {
		return val;
	}
	throwXmlTagNotFound({ position: "left", element, parsed, index });
}

function getLeftOrNull(parsed, elements, index) {
	if (typeof elements === "string") {
		elements = [elements];
	}
	let level = 1;
	for (let i = index; i >= 0; i--) {
		const part = parsed[i];
		for (let j = 0, len = elements.length; j < len; j++) {
			const element = elements[j];
			if (isStarting(part.value, element)) {
				level--;
			}
			if (isEnding(part.value, element)) {
				level++;
			}
			if (level === 0) {
				return i;
			}
		}
	}
	return null;
}

function isTagStart(tagType, { type, tag, position }) {
	return type === "tag" && tag === tagType && position === "start";
}
function isTagEnd(tagType, { type, tag, position }) {
	return type === "tag" && tag === tagType && position === "end";
}
function isParagraphStart(part) {
	return isTagStart("w:p", part) || isTagStart("a:p", part);
}
function isParagraphEnd(part) {
	return isTagEnd("w:p", part) || isTagEnd("a:p", part);
}
function isTextStart(part) {
	return part.type === "tag" && part.position === "start" && part.text;
}
function isTextEnd(part) {
	return part.type === "tag" && part.position === "end" && part.text;
}

function isContent(p) {
	return (
		p.type === "placeholder" ||
		(p.type === "content" && p.position === "insidetag")
	);
}

const corruptCharacters = /[\x00-\x08\x0B\x0C\x0E-\x1F]/;
// 00    NUL '\0' (null character)
// 01    SOH (start of heading)
// 02    STX (start of text)
// 03    ETX (end of text)
// 04    EOT (end of transmission)
// 05    ENQ (enquiry)
// 06    ACK (acknowledge)
// 07    BEL '\a' (bell)
// 08    BS  '\b' (backspace)
// 0B    VT  '\v' (vertical tab)
// 0C    FF  '\f' (form feed)
// 0E    SO  (shift out)
// 0F    SI  (shift in)
// 10    DLE (data link escape)
// 11    DC1 (device control 1)
// 12    DC2 (device control 2)
// 13    DC3 (device control 3)
// 14    DC4 (device control 4)
// 15    NAK (negative ack.)
// 16    SYN (synchronous idle)
// 17    ETB (end of trans. blk)
// 18    CAN (cancel)
// 19    EM  (end of medium)
// 1A    SUB (substitute)
// 1B    ESC (escape)
// 1C    FS  (file separator)
// 1D    GS  (group separator)
// 1E    RS  (record separator)
// 1F    US  (unit separator)
function hasCorruptCharacters(string) {
	return corruptCharacters.test(string);
}

function invertMap(map) {
	return Object.keys(map).reduce(function (invertedMap, key) {
		const value = map[key];
		invertedMap[value] = invertedMap[value] || [];
		invertedMap[value].push(key);
		return invertedMap;
	}, {});
}

module.exports = {
	endsWith,
	startsWith,
	isContent,
	isParagraphStart,
	isParagraphEnd,
	isTagStart,
	isTagEnd,
	isTextStart,
	isTextEnd,
	uniq,
	chunkBy,
	last,
	first,
	mergeObjects,
	xml2str,
	str2xml,
	getRightOrNull,
	getRight,
	getLeftOrNull,
	getLeft,
	pregMatchAll,
	convertSpaces,
	escapeRegExp,
	charMapRegexes,
	hasCorruptCharacters,
	defaults,
	wordToUtf8,
	utf8ToWord,
	concatArrays,
	invertMap,
	charMap,
	getSingleAttribute,
	setSingleAttribute,
};

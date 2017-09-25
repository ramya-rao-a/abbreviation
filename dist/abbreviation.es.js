import Node from '@emmetio/node';
import StreamReader from '@emmetio/stream-reader';
import { eatPair, eatQuoted, isAlphaNumeric, isNumber, isQuote, isSpace, isWhiteSpace } from '@emmetio/stream-reader-utils';

const ASTERISK = 42; // *

/**
 * Consumes node repeat token from current stream position and returns its
 * parsed value
 * @param  {StringReader} stream
 * @return {Object}
 */
var consumeRepeat = function(stream) {
	if (stream.eat(ASTERISK)) {
		stream.start = stream.pos;

		// XXX think about extending repeat syntax with through numbering
		return { count: stream.eatWhile(isNumber) ? +stream.current() : null };
	}
};

const opt = { throws: true };

/**
 * Consumes quoted literal from current stream position and returns it’s inner,
 * unquoted, value
 * @param  {StringReader} stream
 * @return {String} Returns `null` if unable to consume quoted value from current
 * position
 */
var consumeQuoted = function(stream) {
	if (eatQuoted(stream, opt)) {
		return stream.current().slice(1, -1);
	}
};

const LCURLY = 123; // {
const RCURLY = 125; // }

const opt$1 = { throws: true };

/**
 * Consumes text node, e.g. contents of `{...}` and returns its inner value
 * @param  {StringReader} stream
 * @return {String} Consumed text content or `null` otherwise
 */
var consumeTextNode = function(stream) {
	return eatPair(stream, LCURLY, RCURLY, opt$1)
		? stream.current().slice(1, -1)
		: null;
};

const EXCL       = 33; // .
const DOT$1        = 46; // .
const EQUALS     = 61; // =
const ATTR_OPEN  = 91; // [
const ATTR_CLOSE = 93; // ]

const reAttributeName = /^\!?[\w\-:\$@]+\.?$|^\!?\[[\w\-:\$@]+\]\.?$/;

/**
 * Consumes attributes defined in square braces from given stream.
 * Example:
 * [attr col=3 title="Quoted string" selected. support={react}]
 * @param {StringReader} stream
 * @returns {Array} Array of consumed attributes
 */
var consumeAttributes = function(stream) {
	if (!stream.eat(ATTR_OPEN)) {
		return null;
	}

	const result = [];
	let token, attr;

	while (!stream.eof()) {
		stream.eatWhile(isWhiteSpace);

		if (stream.eat(ATTR_CLOSE)) {
			return result; // End of attribute set
		} else if ((token = consumeQuoted(stream)) != null) {
			// Consumed quoted value: anonymous attribute
			result.push({
				name: null,
				value: token
			});
		} else if (eatUnquoted(stream)) {
			// Consumed next word: could be either attribute name or unquoted default value
			token = stream.current();

			// In angular attribute names can be surrounded by []
			if (token[0] === '[' && stream.peek() === ATTR_CLOSE) {
				stream.next();
				token = stream.current();
			}
			
			if (!reAttributeName.test(token)) {
				// anonymous attribute
				result.push({ name: null, value: token });
			} else {
				// Looks like a regular attribute
				attr = parseAttributeName(token);
				result.push(attr);

				if (stream.eat(EQUALS)) {
					// Explicitly defined value. Could be a word, a quoted string
					// or React-like expression
					if ((token = consumeQuoted(stream)) != null) {
						attr.value = token;
					} else if ((token = consumeTextNode(stream)) != null) {
						attr.value = token;
						attr.options = {
							before: '{',
							after: '}'
						};
					} else if (eatUnquoted(stream)) {
						attr.value = stream.current();
					}
				}
			}
		} else {
			throw stream.error('Expected attribute name');
		}
	}

	throw stream.error('Expected closing "]" brace');
};

function parseAttributeName(name) {
	const options = {};

	// If a first character in attribute name is `!` — it’s an implied
	// default attribute
	if (name.charCodeAt(0) === EXCL) {
		name = name.slice(1);
		options.implied = true;
	}

	// Check for last character: if it’s a `.`, user wants boolean attribute
	if (name.charCodeAt(name.length - 1) === DOT$1) {
		name = name.slice(0, name.length - 1);
		options.boolean = true;
	}

	const attr = { name };
	if (Object.keys(options).length) {
		attr.options = options;
	}

	return attr;
}

/**
 * Eats token that can be an unquoted value from given stream
 * @param  {StreamReader} stream
 * @return {Boolean}
 */
function eatUnquoted(stream) {
	const start = stream.pos;
	if (stream.eatWhile(isUnquoted)) {
		stream.start = start;
		return true;
	}
}

function isUnquoted(code) {
	return !isSpace(code) && !isQuote(code)
		 && code !== ATTR_CLOSE && code !== EQUALS;
}

const HASH    = 35; // #
const DOT     = 46; // .
const SLASH   = 47; // /

/**
 * Consumes a single element node from current abbreviation stream
 * @param  {StringReader} stream
 * @return {Node}
 */
var consumeElement = function(stream) {
	// consume element name, if provided
	const start = stream.pos;
	const node = new Node(eatName(stream));
	let next;

	while (!stream.eof()) {
		if (stream.eat(DOT)) {
			node.addClass(eatName(stream));
		} else if (stream.eat(HASH)) {
			node.setAttribute('id', eatName(stream));
		} else if (stream.eat(SLASH)) {
			// A self-closing indicator must be at the end of non-grouping node
			if (node.isGroup) {
				stream.backUp(1);
				throw stream.error('Unexpected self-closing indicator');
			}
			node.selfClosing = true;
			if (next = consumeRepeat(stream)) {
				node.repeat = next;
			}
			break;
		} else if (next = consumeAttributes(stream)) {
			for (let i = 0, il = next.length; i < il; i++) {
				node.setAttribute(next[i]);
			}
		} else if ((next = consumeTextNode(stream)) !== null) {
			node.value = next;
		} else if (next = consumeRepeat(stream)) {
			node.repeat = next;
		} else {
			break;
		}
	}

	if (start === stream.pos) {
		throw stream.error(`Unable to consume abbreviation node, unexpected ${stream.peek()}`);
	}

	return node;
};

function eatName(stream) {
	stream.start = stream.pos;
	stream.eatWhile(isName);
	return stream.current();
}

function isName(code) {
	return isAlphaNumeric(code)
		|| code === 45 /* - */
		|| code === 58 /* : */
		|| code === 36 /* $ */
		|| code === 64 /* @ */
		|| code === 33 /* ! */
		|| code === 95 /* _ */
		|| code === 37 /* % */;
}

const GROUP_START = 40; // (
const GROUP_END   = 41; // )
const OP_SIBLING  = 43; // +
const OP_CHILD    = 62; // >
const OP_CLIMB    = 94; // ^

/**
 * Parses given string into a node tree
 * @param  {String} str Abbreviation to parse
 * @return {Node}
 */
function parse(str) {
	const stream = new StreamReader(str.trim());
	const root = new Node();
	let ctx = root, groupStack = [], ch;

	while (!stream.eof()) {
		ch = stream.peek();

		if (ch === GROUP_START) { // start of group
			// The grouping node should be detached to properly handle
			// out-of-bounds `^` operator. Node will be attached right on group end
			const node = new Node();
			groupStack.push([node, ctx, stream.pos]);
			ctx = node;
			stream.next();
			continue;
		} else if (ch === GROUP_END) { // end of group
			const lastGroup = groupStack.pop();
			if (!lastGroup) {
				throw stream.error('Unexpected ")" group end');
			}

			const node = lastGroup[0];
			ctx = lastGroup[1];
			stream.next();

			// a group can have a repeater
			if (node.repeat = consumeRepeat(stream)) {
				ctx.appendChild(node);
			} else {
				// move all children of group into parent node
				while (node.firstChild) {
					ctx.appendChild(node.firstChild);
				}
			}
			// for convenience, groups can be joined with optional `+` operator
			stream.eat(OP_SIBLING);

			continue;
		}

		const node = consumeElement(stream);
		ctx.appendChild(node);

		if (stream.eof()) {
			break;
		}

		switch (stream.peek()) {
			case OP_SIBLING:
				stream.next();
				continue;

			case OP_CHILD:
				stream.next();
				ctx = node;
				continue;

			case OP_CLIMB:
				// it’s perfectly valid to have multiple `^` operators
				while (stream.eat(OP_CLIMB)) {
					ctx = ctx.parent || ctx;
				}
				continue;
		}
	}

	if (groupStack.length) {
		stream.pos = groupStack.pop()[2];
		throw stream.error('Expected group close');
	}

	return root;
}

/**
 * Parses given abbreviation and un-rolls it into a full tree: recursively
 * replaces repeated elements with actual nodes
 * @param  {String} abbr
 * @return {Node}
 */
var index = function(abbr) {
	const tree = parse(abbr);
	tree.walk(unroll);
	return tree;
};

function unroll(node) {
	if (!node.repeat || !node.repeat.count) {
		return;
	}

	for (let i = 0; i < node.repeat.count; i++) {
		const clone = node.clone(true);
		clone.repeat.value = i+1;
		clone.walk(unroll);
		if (clone.isGroup) {
			while (clone.children.length > 0) {
				clone.firstChild.repeat = clone.repeat;
				node.parent.insertBefore(clone.firstChild, node);
			}
		} else {
			node.parent.insertBefore(clone, node);
		}
	}
	
	node.parent.removeChild(node);
}

export default index;

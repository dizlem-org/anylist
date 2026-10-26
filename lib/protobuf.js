/**
 * Compatibility layer exposing the protobufjs v5 builder API that this
 * library was written against, on top of protobufjs v7.
 *
 * Only the surface used by the library is provided: `new Message(props)`,
 * `message.setX(value)`, `message.toBuffer()` and `Message.decode(buffer)`.
 * Decoded messages mimic v5: unset optional fields are `null` (or their
 * declared default), repeated fields are arrays.
 */
const {Buffer} = require('node:buffer');
const protobuf = require('protobufjs');

const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1);

function convertField(f) {
	const out = {id: f.id, type: f.type};
	if (f.rule === 'map') {
		out.keyType = f.keytype;
	} else if (f.rule === 'repeated' || f.rule === 'required') {
		out.rule = f.rule;
	}

	if (f.options) {
		out.options = f.options;
	}

	return out;
}

function convertEnum(enumeration) {
	return {values: Object.fromEntries(enumeration.values.map(v => [v.name, v.id]))};
}

function convertMessage(m) {
	const out = {fields: Object.fromEntries((m.fields || []).map(f => [f.name, convertField(f)]))};
	if (m.enums && m.enums.length > 0) {
		out.nested = Object.fromEntries(m.enums.map(enumeration => [enumeration.name, convertEnum(enumeration)]));
	}

	return out;
}

function toJSONDescriptor(definitions) {
	const nested = {};
	for (const enumeration of definitions.enums || []) {
		nested[enumeration.name] = convertEnum(enumeration);
	}

	for (const m of definitions.messages) {
		nested[m.name] = convertMessage(m);
	}

	return {nested};
}

// Emulate protobufjs v5 decode output: null for unset optionals, declared
// defaults where present, and arrays/messages normalised recursively.
function normalise(type, object) {
	for (const field of type.fieldsArray) {
		field.resolve();
		const value = object[field.name];
		if (field.repeated || field.map) {
			if (value === undefined) {
				object[field.name] = field.map ? {} : [];
			}
		} else if (value === undefined) {
			const declared = field.options && field.options.default;
			object[field.name] = declared === undefined ? null : declared;
		}

		if (field.resolvedType instanceof protobuf.Type && object[field.name] !== null) {
			const child = field.resolvedType;
			if (field.map) {
				for (const key of Object.keys(object[field.name])) {
					normalise(child, object[field.name][key]);
				}
			} else if (field.repeated) {
				for (const item of object[field.name]) {
					normalise(child, item);
				}
			} else {
				normalise(child, object[field.name]);
			}
		}
	}

	return object;
}

// V5 accepts a single value for a repeated field and wraps it in an array.
function coerceRepeated(type, name, value) {
	const field = type.fields[name];
	if (field && field.repeated && value !== undefined && value !== null && !Array.isArray(value)) {
		return [value];
	}

	return value;
}

function buildMessageClass(type) {
	const Message = class {
		constructor(props = {}) {
			for (const [name, value] of Object.entries(props)) {
				this[name] = coerceRepeated(type, name, value);
			}
		}

		toBuffer() {
			return Buffer.from(type.encode(type.fromObject(this)).finish());
		}

		static decode(buffer) {
			const decoded = type.toObject(type.decode(buffer), {arrays: true, objects: true, defaults: false});
			return new Message(normalise(type, decoded));
		}
	};

	for (const field of type.fieldsArray) {
		Message.prototype[`set${capitalize(field.name)}`] = function (value) {
			this[field.name] = coerceRepeated(type, field.name, value);
		};
	}

	return Message;
}

function build(definitions) {
	const root = protobuf.Root.fromJSON(toJSONDescriptor(definitions));
	root.resolveAll();
	const messages = {};
	for (const m of definitions.messages) {
		messages[m.name] = buildMessageClass(root.lookupType(m.name));
	}

	return messages;
}

module.exports = {build};

const {expect} = require('chai');
const ProtoBuf5 = require('protobufjs5');
const definitions = require('../lib/definitions.json');
const protobuf = require('../lib/protobuf');

// Reference implementation: the protobufjs v5 builder the library originally used.
const v5 = ProtoBuf5.newBuilder({}).import(definitions).build('pcov.proto');
const v7 = protobuf.build(definitions);

const metadata = {operationId: 'abc123', handlerId: 'add-shopping-list-item', userId: 'user1'};
const listItem = {
	identifier: 'item1',
	listId: 'list1',
	name: 'Milk',
	details: 'semi-skimmed',
	deprecatedQuantity: '2',
	serverModTime: 1700000000.25,
	manualSortIndex: 3,
	checked: false,
	photoIds: ['p1', 'p2'],
	category: 'dairy',
	userId: 'user1',
};

describe('protobufjs v7 compatibility layer', () => {
	it('encodes list operations identically to protobufjs v5', () => {
		const build = P => {
			const op = new P.PBListOperation();
			op.setMetadata(metadata);
			op.setListId('list1');
			op.setListItemId('item1');
			op.setListItem(new P.ListItem(listItem));
			const ops = new P.PBListOperationList();
			ops.setOperations([op]);
			return ops.toBuffer();
		};

		expect(build(v7).toString('hex')).to.equal(build(v5).toString('hex'));
	});

	it('encodes update-value operations identically to protobufjs v5', () => {
		const build = P => {
			const op = new P.PBListOperation();
			op.setMetadata({...metadata, handlerId: 'set-list-item-checked'});
			op.setListId('list1');
			op.setListItemId('item1');
			op.setUpdatedValue('y');
			const ops = new P.PBListOperationList();
			ops.setOperations([op]);
			return ops.toBuffer();
		};

		expect(build(v7).toString('hex')).to.equal(build(v5).toString('hex'));
	});

	it('decodes a user data response produced by protobufjs v5', () => {
		const response = new v5.PBUserDataResponse({
			shoppingListsResponse: {
				newLists: [{
					identifier: 'list1',
					name: 'Groceries',
					timestamp: 1700000000.5,
					logicalClockTime: 1234567890123,
					items: [listItem],
				}],
			},
		});
		const buffer = response.toBuffer();

		const decoded = v7.PBUserDataResponse.decode(buffer);
		const reference = v5.PBUserDataResponse.decode(buffer);

		expect(decoded.shoppingListsResponse.newLists).to.have.length(1);
		const [list] = decoded.shoppingListsResponse.newLists;
		const [referenceList] = reference.shoppingListsResponse.newLists;
		expect(list.identifier).to.equal(referenceList.identifier);
		expect(list.name).to.equal(referenceList.name);
		expect(list.timestamp).to.equal(referenceList.timestamp);
		expect(list.logicalClockTime.toString()).to.equal(referenceList.logicalClockTime.toString());
		expect(list.items[0].name).to.equal(referenceList.items[0].name);
		expect(list.items[0].serverModTime).to.equal(referenceList.items[0].serverModTime);
		expect(list.items[0].manualSortIndex).to.equal(referenceList.items[0].manualSortIndex);
		expect(list.items[0].photoIds).to.deep.equal(referenceList.items[0].photoIds);
		// Unset optional message/repeated fields mirror v5 (null / empty array)
		expect(decoded.recipeDataResponse).to.equal(reference.recipeDataResponse);
		expect(decoded.mealPlanningCalendarResponse).to.equal(reference.mealPlanningCalendarResponse);
	});

	it('round-trips list items through decode, preserving v5 shape', () => {
		const ops = new v5.PBListOperationList();
		const op = new v5.PBListOperation();
		op.setMetadata(metadata);
		op.setListItem(new v5.ListItem(listItem));
		ops.setOperations([op]);

		const decoded = v7.PBListOperationList.decode(ops.toBuffer());
		const item = decoded.operations[0].listItem;
		expect(item.name).to.equal('Milk');
		expect(item.details).to.equal('semi-skimmed');
		expect(item.checked).to.equal(false);
		expect(item.photoIds).to.deep.equal(['p1', 'p2']);
		expect(item.storeIds).to.deep.equal([]);
		expect(item.recipeId).to.equal(null);
	});

	it('wraps single values set on repeated fields like v5', () => {
		const build = P => {
			const op = new P.PBRecipeOperation();
			op.setMetadata(metadata);
			op.setRecipeDataId('data1');
			op.setRecipeIds('recipe1');
			const ops = new P.PBRecipeOperationList();
			ops.setOperations(op);
			return ops.toBuffer();
		};

		expect(build(v7).toString('hex')).to.equal(build(v5).toString('hex'));
	});

	it('applies declared field defaults like v5', () => {
		const buffer = new v5.PBUserSubscriptionInfo({identifier: 'sub1'}).toBuffer();
		const reference = v5.PBUserSubscriptionInfo.decode(buffer);
		const decoded = v7.PBUserSubscriptionInfo.decode(buffer);
		expect(decoded.subuserLimit).to.equal(reference.subuserLimit);
	});

	it('exposes setters for every message type', () => {
		for (const m of definitions.messages) {
			expect(v7).to.have.property(m.name);
			for (const f of m.fields) {
				const setter = `set${f.name.charAt(0).toUpperCase()}${f.name.slice(1)}`;
				expect(v7[m.name].prototype, `${m.name}.${setter}`).to.have.property(setter);
				expect(v5[m.name].prototype, `v5 ${m.name}.${setter}`).to.have.property(setter);
			}
		}
	});
});

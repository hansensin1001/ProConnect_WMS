const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Run the real TypeScript helpers without an additional test dependency.
const filename = path.resolve(__dirname, '../lib/warehouse-ui.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const helperModule = new Module(filename, module);
helperModule._compile(compiled, filename);
const { appendSerials, serialTokens, receiptRemaining, shippableQuantity, binLabel, warehouseError } = helperModule.exports;

test('remaining receipts subtract accepted and dock-rejected stock', () => {
  assert.equal(receiptRemaining({ quantity_expected: 10, quantity_received: 4, rejected_qty: 2 }), 4);
  assert.equal(receiptRemaining({ quantity_expected: 10, quantity_received: 10 }), 0);
});
test('partial shipment is capped by allocated and requested quantities', () => {
  assert.equal(shippableQuantity({ quantity_requested: 10, quantity_reserved: 6, quantity_picked: 4 }), 2);
  assert.equal(shippableQuantity({ quantity_requested: 4, quantity_reserved: 6, quantity_picked: 1 }), 3);
  assert.equal(shippableQuantity({ quantity_requested: 10, quantity_picked: 0 }), 0);
});
test('scanner normalizes Enter, Tab and pasted delimiters', () => {
  assert.deepEqual(serialTokens(' a\r\nb\tc,d; e '), ['A', 'B', 'C', 'D', 'E']);
});
test('duplicate rejection is case-insensitive and atomic', () => {
  const current = ['A'];
  assert.throws(() => appendSerials(current, ['B', 'a'], 3), /Duplicate scan/);
  assert.deepEqual(current, ['A']);
  assert.throws(() => appendSerials([], ['a', 'A'], 2), /Duplicate scan/);
});
test('over-count batches never mutate the scanned list', () => {
  const current = ['A'];
  assert.throws(() => appendSerials(current, ['B', 'C'], 2), /Only 2/);
  assert.deepEqual(current, ['A']);
});
test('invalid quantities and malformed serials are rejected', () => {
  for (const count of [0, -1, NaN, 1.5]) assert.throws(() => appendSerials([], ['A'], count));
  for (const value of ['', ' ', 'a'.repeat(161)]) assert.throws(() => appendSerials([], [value], 1));
  assert.deepEqual(appendSerials(['A'], [' b '], 2), ['A', 'B']);
});
test('bin labels deduplicate codes and name missing associations', () => {
  assert.equal(binLabel({ display_code: ' LOC1 ', location_code: 'LOC1' }), 'LOC1');
  assert.equal(binLabel(null), '[Unassigned bin]');
  assert.equal(binLabel({ display_code: 'LOC1', location_code: 'A-01' }), 'LOC1 · A-01');
});
test('plain database errors retain readable messages', () => {
  assert.equal(warehouseError({ message: 'Source bin is inactive' }, 'Failed'), 'Source bin is inactive');
  assert.equal(warehouseError(null, 'Failed'), 'Failed');
});

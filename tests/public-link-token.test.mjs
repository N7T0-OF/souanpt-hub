import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../js/quote.js', import.meta.url), 'utf8');

test('new public request and estimate links use 128-bit cryptographic tokens', () => {
  let fills = 0;
  const context = {
    window: {},
    crypto: {
      getRandomValues(bytes) {
        assert.equal(bytes.length, 16);
        for (let index = 0; index < bytes.length; index++) bytes[index] = index + fills;
        fills++;
        return bytes;
      },
    },
  };
  vm.runInNewContext(source, context);
  const first = context.window.QuoteUI._newPublicToken();
  const second = context.window.QuoteUI._newPublicToken();
  assert.equal(first, '000102030405060708090A0B0C0D0E0F');
  assert.equal(second, '0102030405060708090A0B0C0D0E0F10');
  assert.match(first, /^[A-F0-9]{32}$/);
  assert.equal(fills, 2);
  assert.match(source, /const code = this\._fromRequest \|\| this\._newPublicToken\(\);/);
  assert.match(source, /const token = this\._newPublicToken\(\);/);
});

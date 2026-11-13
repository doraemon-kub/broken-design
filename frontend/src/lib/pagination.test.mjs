// Run: npm test  (Node's built-in runner; imports the TS source via type stripping)
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHref, parseParams, queryModels } from './pagination.ts';

const m = (id, o = {}) => ({
  id,
  title: `Model ${id}`,
  creator: 'Ada',
  tags: ['nature'],
  license: 'CC0',
  priceCents: 0,
  likeCount: 0,
  downloadCount: 0,
  ...o,
});

test('query sorts by likes then downloads without mutating the input', () => {
  const models = [m('a', { likeCount: 5 }), m('b', { likeCount: 9 }), m('c', { likeCount: 9, downloadCount: 3 })];
  assert.deepEqual(queryModels(models, {}).items.map((x) => x.id), ['c', 'b', 'a']);
  assert.deepEqual(models.map((x) => x.id), ['a', 'b', 'c']);
});

test('pagination slices and clamps the page', () => {
  const many = Array.from({ length: 25 }, (_, i) => m(`m${i}`, { likeCount: 100 - i }));
  const p2 = queryModels(many, { page: 2 }, 10);
  assert.equal(p2.page, 2);
  assert.equal(p2.items.length, 10);
  assert.equal(p2.total, 25);
  assert.equal(queryModels(many, { page: 99 }, 10).page, 3);
  assert.equal(queryModels(many, { page: 99 }, 10).items.length, 5);
  assert.equal(queryModels([], {}).page, 1);
});

test('parseParams validates search, filter, and page parameters', () => {
  assert.deepEqual(
    parseParams({ page: '3', q: '  drone ', tag: 'sci-fi', license: 'cc0', price: 'free' }),
    { page: 3, q: 'drone', tag: 'sci-fi', license: 'CC0', price: 'free' },
  );
  assert.deepEqual(parseParams({ tag: 'invalid-tag', license: 'INVALID', price: 'invalid' }), {});
  assert.equal(parseParams({ page: '-4' }).page, undefined);
  assert.equal(parseParams({ page: 'abc' }).page, undefined);
  assert.equal(parseParams({}).page, undefined);
});

test('buildHref carries filters and page', () => {
  assert.equal(buildHref({}), '/gallery');
  assert.equal(buildHref({ page: 1 }), '/gallery');
  assert.equal(buildHref({ page: 2 }), '/gallery?page=2');
  assert.equal(buildHref({ tag: 'vehicle', price: 'free', page: 2 }), '/gallery?tag=vehicle&price=free&page=2');
});

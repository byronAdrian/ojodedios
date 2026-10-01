import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = (name) => readFileSync(new URL(`../../src/styles/${name}`, import.meta.url), 'utf8');

test('no scanline overlay over the map (it read as a constant refresh)', () => {
  assert.doesNotMatch(css('matrix.css'), /repeating-linear-gradient/);
  assert.doesNotMatch(css('tokens.css'), /--scanlines/);
});

test('decorative animations are finite (the spinner is the only infinite one)', () => {
  for (const file of ['matrix.css', 'components.css', 'tokens.css']) {
    const infinite = [...css(file).matchAll(/animation:\s*([\w-]+)[^;]*\binfinite\b/g)].map((m) => m[1]);
    assert.deepEqual(infinite.filter((name) => name !== 'spin'), [], file);
  }
});

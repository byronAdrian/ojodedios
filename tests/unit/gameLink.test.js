import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGameUrl, DEFAULT_GAME_URL } from '../../src/ui/gameLink.js';

test('game link accepts only https URLs, else falls back to the default', () => {
  assert.equal(resolveGameUrl('https://example.com/zombies'), 'https://example.com/zombies');
  for (const bad of [undefined, '', 'http://example.com', 'javascript:alert(1)', 'https://u:p@example.com', 'not a url']) {
    assert.equal(resolveGameUrl(bad), DEFAULT_GAME_URL, String(bad));
  }
});

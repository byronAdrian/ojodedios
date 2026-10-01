import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLivestreams } from '../../server/sources/livestreams.js';
import entries from '../../server/sources/livestreams.data.js';
import { createCamera } from '../../src/domain/camera.js';

const ctx = { checkedAt: '2026-10-01T10:00:00.000Z' };

test('curated live streams become valid live-video cameras with muted privacy-enhanced embeds', () => {
  const cams = loadLivestreams(ctx).map(createCamera);
  assert.equal(cams.length, entries.length);
  for (const c of cams) {
    assert.ok(c, 'valid camera');
    assert.equal(c.mediaType, 'youtube');
    assert.equal(c.liveness, 'live');
    assert.match(c.mediaUrl, /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}\?autoplay=1&mute=1/);
    assert.match(c.thumbnailUrl, /^https:\/\/i\.ytimg\.com\/vi\//);
    assert.match(c.pageUrl, /^https:\/\/www\.youtube\.com\/watch\?v=/);
  }
  const lanzarote = cams.find((c) => c.id === 'livestream:lanzarote-puerto-del-carmen');
  assert.equal(lanzarote.provinceCode, 'ES-GC');
  assert.equal(lanzarote.communityCode, 'ES-CN');
});

test('malformed curated entries are skipped, never embedded', () => {
  const rows = loadLivestreams(ctx, [
    { id: 'Bad Id', youtubeId: 'YlRJXr4fCgM', name: 'x', lat: 40, lon: -3 },
    { id: 'ok', youtubeId: 'short', name: 'x', lat: 40, lon: -3 },
  ]);
  assert.equal(rows.length, 0);
});

test('only youtube-nocookie embeds are accepted for video, and page/thumbnail must be https', () => {
  const base = { id: 'livestream:x', name: 'x', lat: 40, lon: -3, mediaType: 'youtube' };
  assert.equal(createCamera({ ...base, mediaUrl: 'https://evil.example/embed/YlRJXr4fCgM' }), null);
  assert.equal(createCamera({ ...base, mediaUrl: 'https://www.youtube.com/embed/YlRJXr4fCgM' }), null);
  const ok = createCamera({ ...base, mediaUrl: 'https://www.youtube-nocookie.com/embed/YlRJXr4fCgM?autoplay=1&mute=1', pageUrl: 'http://insecure', thumbnailUrl: 'javascript:alert(1)' });
  assert.ok(ok);
  assert.equal(ok.pageUrl, null);
  assert.equal(ok.thumbnailUrl, null);
});

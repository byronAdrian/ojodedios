/**
 * Minimal, namespace-agnostic extraction helpers for the two XML dialects we
 * consume (DATEX II and KML). Deliberately not a general XML parser: it reads
 * flat leaf values by local element name inside a known record element, which
 * is all the adapters need, with no dependency and no entity expansion beyond
 * the five predefined XML entities and numeric references (no XXE surface).
 */
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PREFIX = '(?:[A-Za-z_][\\w.-]*:)?';

const ENTITY_MAP = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlEntities(text) {
  return String(text)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, ref) => {
      const key = ref.toLowerCase();
      if (key in ENTITY_MAP) return ENTITY_MAP[key];
      const code = key.startsWith('#x') ? parseInt(key.slice(2), 16) : parseInt(key.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    });
}

/** Inner XML of every `<prefix:localName ...>…</prefix:localName>` element. */
export function elements(xml, localName) {
  const name = escapeRegExp(localName);
  const pattern = new RegExp(`<${PREFIX}${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${PREFIX}${name}\\s*>`, 'g');
  return Array.from(String(xml).matchAll(pattern), (m) => m[1]);
}

/** Decoded, trimmed text of the first `localName` element, or ''. */
export function firstText(xml, localName) {
  const [inner] = elements(xml, localName);
  return inner === undefined ? '' : decodeXmlEntities(inner).trim();
}

/** Tag normalization map: browser-variant tags → semantic equivalents. */
export const TAG_NORMALIZE: Record<string, string> = {
  b: 'strong',
  i: 'em',
};

/** Attributes that contain URLs and need protocol validation. */
export const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction']);

/** Protocols that are always denied regardless of policy. */
export const DENIED_PROTOCOLS = new Set(['javascript', 'data']);

/**
 * Parse a URL-like string and extract the protocol.
 * Returns the lowercase protocol name (without colon), or null if none found.
 */
export function extractProtocol(value: string): string | null {
  let decoded = value.trim();
  decoded = decoded.replace(/&#x([0-9a-f]+);?/gi, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
  decoded = decoded.replace(/&#(\d+);?/g, (_, dec) =>
    String.fromCharCode(parseInt(dec, 10)),
  );
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // keep entity-decoded result
  }
  decoded = decoded.replace(/[\s\x00-\x1f\u00A0\u1680\u2000-\u200B\u2028\u2029\u202F\u205F\u3000\uFEFF]+/g, '');
  const match = decoded.match(/^([a-z][a-z0-9+\-.]*)\s*:/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Check if a URL value is allowed by the given protocol list.
 * javascript: and data: are always denied.
 */
export function isProtocolAllowed(value: string, allowedProtocols: string[]): boolean {
  const protocol = extractProtocol(value);
  if (protocol === null) return true;
  if (DENIED_PROTOCOLS.has(protocol)) return false;
  return allowedProtocols.includes(protocol);
}

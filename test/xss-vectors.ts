/**
 * OWASP XSS cheat sheet vectors for sanitizer testing.
 * Each entry has a payload and a description of the attack vector.
 *
 * These vectors MUST produce safe output (no executable scripts, no dangerous
 * attributes, no javascript:/data: URLs) after sanitization.
 */

export interface XSSVector {
  /** Human-readable description of the attack vector. */
  name: string;
  /** Raw HTML payload. */
  payload: string;
}

export const XSS_VECTORS: XSSVector[] = [
  // --- Script injection ---
  {
    name: 'basic script injection',
    payload: '<script>alert(1)</script>',
  },
  {
    name: 'script with src attribute',
    payload: '<script src="https://evil.com/xss.js"></script>',
  },
  {
    name: 'mixed case script tag',
    payload: '<ScRiPt>alert(1)</ScRiPt>',
  },
  {
    name: 'null byte in script tag',
    payload: '<scri\x00pt>alert(1)</script>',
  },

  // --- Event handler attributes ---
  {
    name: 'img onerror',
    payload: '<img src=x onerror=alert(1)>',
  },
  {
    name: 'img src and onerror with quotes',
    payload: '<img src="x" onerror="alert(1)" />',
  },
  {
    name: 'input onfocus with autofocus',
    payload: '<input onfocus=alert(1) autofocus>',
  },
  {
    name: 'details ontoggle',
    payload: '<details open ontoggle=alert(1)>',
  },
  {
    name: 'body onload',
    payload: '<body onload=alert(1)>',
  },
  {
    name: 'marquee onstart',
    payload: '<marquee onstart=alert(1)>',
  },
  {
    name: 'div onmouseover',
    payload: '<div onmouseover="alert(1)">hover</div>',
  },

  // --- javascript: protocol ---
  {
    name: 'anchor with javascript: href',
    payload: '<a href="javascript:alert(1)">click</a>',
  },
  {
    name: 'javascript: with HTML entity encoding',
    payload: '<a href="&#x6A;&#x61;&#x76;&#x61;&#x73;&#x63;&#x72;&#x69;&#x70;&#x74;:alert(1)">click</a>',
  },
  {
    name: 'javascript: with URL encoding',
    payload: '<a href="%6A%61%76%61%73%63%72%69%70%74:alert(1)">click</a>',
  },
  {
    name: 'javascript: with mixed case',
    payload: '<a href="JaVaScRiPt:alert(1)">click</a>',
  },
  {
    name: 'javascript: with extra whitespace',
    payload: '<a href=" java\tscript:alert(1)">click</a>',
  },
  {
    name: 'javascript: with leading newlines',
    payload: '<a href="\njavascript:alert(1)">click</a>',
  },
  {
    name: 'javascript: with decimal entities',
    payload: '<a href="&#106;&#97;&#118;&#97;&#115;&#99;&#114;&#105;&#112;&#116;:alert(1)">click</a>',
  },

  // --- data: protocol ---
  {
    name: 'anchor with data: href',
    payload: '<a href="data:text/html,<script>alert(1)</script>">click</a>',
  },
  {
    name: 'data: with base64',
    payload: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">click</a>',
  },

  // --- SVG/MathML namespace ---
  {
    name: 'SVG onload',
    payload: '<svg onload=alert(1)>',
  },
  {
    name: 'SVG script',
    payload: '<svg><script>alert(1)</script></svg>',
  },
  {
    name: 'MathML',
    payload: '<math><mi>x</mi></math>',
  },

  // --- CSS injection ---
  {
    name: 'style attribute with expression',
    payload: '<div style="background:url(javascript:alert(1))">text</div>',
  },
  {
    name: 'style tag',
    payload: '<style>body{background:url(javascript:alert(1))}</style>',
  },

  // --- iframe/object/embed ---
  {
    name: 'iframe with javascript: src',
    payload: '<iframe src="javascript:alert(1)"></iframe>',
  },
  {
    name: 'object with data',
    payload: '<object data="javascript:alert(1)"></object>',
  },
  {
    name: 'embed with src',
    payload: '<embed src="javascript:alert(1)">',
  },

  // --- Form-based ---
  {
    name: 'form action javascript:',
    payload: '<form action="javascript:alert(1)"><input type="submit"></form>',
  },
  {
    name: 'button formaction',
    payload: '<button formaction="javascript:alert(1)">click</button>',
  },

  // --- Depth/nesting attacks ---
  {
    name: 'deeply nested tags (50 levels)',
    payload: '<div>'.repeat(50) + 'deep' + '</div>'.repeat(50),
  },

  // --- Encoding tricks ---
  {
    name: 'double URL encoding javascript:',
    payload: '<a href="%256A%2561%2576%2561%2573%2563%2572%2569%2570%2574:alert(1)">click</a>',
  },
  {
    name: 'tab characters in javascript:',
    payload: '<a href="j\ta\tv\ta\ts\tc\tr\ti\tp\tt:alert(1)">click</a>',
  },
  {
    name: 'newlines in javascript:',
    payload: '<a href="j\na\nv\na\nscript:alert(1)">click</a>',
  },

  // --- Paste payloads (rich text) ---
  {
    name: 'Word-style paste with mso classes',
    payload: '<p class="MsoNormal" style="margin:0"><span style="font-family:Calibri">Hello <b>world</b></span></p>',
  },
  {
    name: 'Google Docs paste with spans',
    payload: '<span style="font-size:11pt;font-family:Arial" id="docs-internal-guid-abc">Hello <b>world</b></span>',
  },
  {
    name: 'paste with meta and link tags',
    payload: '<meta charset="utf-8"><link rel="stylesheet" href="evil.css"><p>text</p>',
  },
];

/**
 * Patterns that should NEVER appear in sanitized output.
 * Used to validate that sanitization was effective.
 */
export const DANGEROUS_PATTERNS = [
  /\bon\w+\s*=/i,           // event handler attributes (onclick=, onerror=, etc.)
  /<script[\s>]/i,           // script tags
  /javascript\s*:/i,         // javascript: protocol
  /data\s*:/i,               // data: protocol (in href/src context)
  /<iframe[\s>]/i,           // iframe tags
  /<object[\s>]/i,           // object tags
  /<embed[\s>]/i,            // embed tags
  /<svg[\s>]/i,              // svg tags
  /<math[\s>]/i,             // math tags
  /<form[\s>]/i,             // form tags
  /<style[\s>]/i,            // style tags
  /style\s*=/i,              // style attributes
];

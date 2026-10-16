import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contract = await readFile(new URL('../design.md', import.meta.url), 'utf8');
const legalClasses = new Set([...contract.matchAll(/#### Legal class set[^\n]*\n+([^#]+)/g)].flatMap((match) => match[1].match(/lp-[\w-]+/g) || []));
const tokenNames = new Set(contract.match(/--[\w-]+/g));

for (const page of ['login', 'signup', 'account']) {
  test(`${page}: documented classes, theme hooks, labels and assets`, async () => {
    const html = await readFile(new URL(`../src/pages/${page}.html`, import.meta.url), 'utf8');
    for (const match of html.matchAll(/class="([^"]+)"/g)) {
      for (const name of match[1].split(/\s+/)) if (name.startsWith('lp-')) assert.ok(legalClasses.has(name), `Undocumented class: ${name}`);
    }
    assert.match(html, /<html lang="en" data-theme="light">/);
    assert.match(html, /<main\b/);
    assert.match(html, /https:\/\/lepide-design-system.vercel.app\/v1\/lepidus.css/);
    assert.match(html, /https:\/\/lepide-design-system.vercel.app\/v1\/lepidus.js" defer/);
    assert.match(html, /data-lp-dropdown="single"/);
    assert.doesNotMatch(html, /<select\b|style=/);
    for (const input of html.matchAll(/<input\b[^>]*\sid="([^"]+)"[^>]*>/g)) {
      assert.equal([...html.matchAll(new RegExp(`<label\\b[^>]*for="${input[1]}"`, 'g'))].length, 1);
      assert.match(input[0], /aria-describedby=/);
    }
  });
}

test('layout uses existing tokens and never overrides component selectors', async () => {
  const css = await readFile(new URL('../src/public/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.lp-|#[\da-f]{3,8}\b|\b\d+px\b|rgba?\(/i);
  for (const match of css.matchAll(/var\((--[\w-]+)\)/g)) assert.ok(tokenNames.has(match[1]), `Unknown token: ${match[1]}`);
});
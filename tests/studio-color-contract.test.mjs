import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../central/studio-r3.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../central/index.html',import.meta.url),'utf8');
test('Horizon Studio chrome uses approved blue/violet and neutral black/gray, not Ronda red',()=>{
  assert.match(css,/--accent:#1F98FF;/);
  assert.match(css,/--violet:#8B5CF6;/);
  assert.match(css,/--accent-hover:#3BA7FF;/);
  assert.match(css,/--accent-soft:rgba\(31,152,255,\.12\)/);
  assert.doesNotMatch(css,/--red\b|#ec4047|#f24c54|rgba\(236\s*,\s*64\s*,\s*71/i);
  assert.doesNotMatch(html,/red-square/i);
  const allowed=new Set(['#1F98FF','#3BA7FF','#8B5CF6','#996DF7']);
  for(const token of css.match(/#[0-9A-Fa-f]{6}\b/g)||[]){
    const c=token.toUpperCase();
    assert.ok(allowed.has(c)||c.slice(1,3)===c.slice(3,5)&&c.slice(3,5)===c.slice(5,7),`Forbidden chromatic token: ${c}`);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const script=readFileSync(new URL('../central/wireframe.mjs',import.meta.url),'utf8');
const css=readFileSync(new URL('../central/wireframe.css',import.meta.url),'utf8');
test('wireframe positions elements via CSSOM under strict CSP',()=>{
 assert.doesNotMatch(script,/data-el=.*?style="left:/);
 for(const rule of ['node.style.left','node.style.top','node.style.width','node.style.height'])assert.ok(script.includes(rule),rule);
});
test('Studio does not hide operator chat when wireframe exists',()=>{
 assert.doesNotMatch(css,/body:has\(#wf-root\)\s+#help-open\s*\{\s*display:none/);
});
test('central avoids HTML inline styles under production CSP',()=>{
 const app=readFileSync(new URL('../central/app.js',import.meta.url),'utf8');
 assert.doesNotMatch(app,/style="/);
 assert.match(app,/data-progress-width/);
});

import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

// Local, versioned instructions: checkpoint/network content cannot replace them.
export const ENGINEERING_METHODS=readFileSync(new URL('./metodos-engenharia-may.md',import.meta.url),'utf8');
if(!ENGINEERING_METHODS.trim()||Buffer.byteLength(ENGINEERING_METHODS)>20000){
 throw Error('Metodos de engenharia ausentes ou invalidos');
}
export const ENGINEERING_CONTEXT=Object.freeze({
 version:1,source:'maestro/metodos-engenharia-may.md',
 sha256:createHash('sha256').update(ENGINEERING_METHODS).digest('hex'),
 bytes:Buffer.byteLength(ENGINEERING_METHODS),
 origin:'May Maestro plugin 1.3.9'
});

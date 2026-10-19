import test from 'node:test';
import assert from 'node:assert/strict';
import {consultWithFallback, paymentCircuitStatus} from '../maestro-worker.mjs';

test('DeepSeek HTTP 402 opens a payment circuit without retrying every supervisor cycle', async () => {
  const initial=new Date('2026-10-19T12:00:00Z');
  const logs=[];
  let geminiCalls=0, deepSeekCalls=0;
  const fetcher=async url=>{
    if(url.includes('generativelanguage.googleapis.com')){
      geminiCalls++;
      return {ok:false,status:503,json:async()=>({error:{status:'UNAVAILABLE'}})};
    }
    if(url.includes('api.deepseek.com')){
      deepSeekCalls++;
      return {ok:false,status:402};
    }
    throw new Error('Unexpected provider');
  };
  const options={fetcher,apiKey:'fake-gemini',deepSeekKey:'fake-deepseek',log:x=>logs.push(x)};
  await assert.rejects(consultWithFallback({...options,now:initial}), /DeepSeek HTTP 402/);
  assert.equal(deepSeekCalls,1);
  assert.equal(paymentCircuitStatus(initial.getTime()).blocked,true);

  const tenMinutes=new Date(initial.getTime()+10*60_000);
  await assert.rejects(consultWithFallback({...options,now:tenMinutes}), /payment_circuit_open/);
  assert.equal(geminiCalls,2);
  assert.equal(deepSeekCalls,1,'do not repeatedly charge a known empty account');
  assert.ok(logs.some(line=>line.includes('skipped_payment_circuit')));

  const later=new Date(initial.getTime()+61*60_000);
  await assert.rejects(consultWithFallback({...options,now:later}), /DeepSeek HTTP 402/);
  assert.equal(deepSeekCalls,2,'only retry after cooldown');
});

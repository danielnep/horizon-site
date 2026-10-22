import test from 'node:test';
import assert from 'node:assert/strict';
import {recordCentralUsage} from '../central/telemetry.mjs';

test('chat AI response is not lost when the web container has no shared worker queue',async()=>{
 const previous=process.env.HORIZON_DIRECT_INBOX_DIR;
 delete process.env.HORIZON_DIRECT_INBOX_DIR;
 try{
  const recorded=await recordCentralUsage('gemini-3.6-flash',{prompt_tokens:5,completion_tokens:7,total_tokens:12},'gemini');
  assert.equal(recorded,false);
 }finally{
  if(previous===undefined)delete process.env.HORIZON_DIRECT_INBOX_DIR;
  else process.env.HORIZON_DIRECT_INBOX_DIR=previous;
 }
});

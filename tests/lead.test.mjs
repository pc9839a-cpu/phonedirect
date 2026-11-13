import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { onRequestGet, onRequestPost } from '../functions/api/lead.js';

const receipt='test-receipt-1234567890';
const lead={ name:'Test Customer',phone:'01012345678',carrier:'SK',model:'s26',consent:true,receipt,source:'/',referrer:'',utm_source:'',utm_campaign:'' };
const env={ SHEETS_WEB_APP_URL:'https://script.google.com/macros/s/AKfycb_test/exec',SHEETS_INGEST_TOKEN:'test-only-secret' };
const makeRequest=(body,headers={})=>new Request('https://phonedirect.pages.dev/api/lead',{
  method:'POST',headers:{'Content-Type':'application/json','Origin':'https://phonedirect.pages.dev',...headers},
  body:JSON.stringify(body)
});
const call=(body,vars=env,headers={})=>onRequestPost({request:makeRequest(body,headers),env:vars});

test('GET does not submit a lead',async()=>{
  const response=await onRequestGet({env});
  assert.equal(response.status,405);
  assert.equal(response.headers.get('X-Lead-Bridge-Configured'),'yes');
  assert.equal((await onRequestGet({env:{}})).headers.get('X-Lead-Bridge-Configured'),'no');
  assert.equal((await onRequestGet({env:{SHEETS_INGEST_TOKEN:'test-only-secret'}})).headers.get('X-Lead-Bridge-Configured'),'yes');
  assert.equal((await response.json()).ok,false);
});
test('rejects malformed records and missing consent',async()=>{
  for(const input of [{...lead,phone:'010000'}, {...lead,consent:false}, {...lead,carrier:'N/A'}, {...lead,receipt:'tiny'}]){
    const response=await call(input);
    assert.equal(response.status,422);
    assert.equal((await response.json()).ok,false);
  }
});
test('rejects cross-site browser submissions',async()=>{
  const response=await call(lead,env,{'Origin':'https://evil.example'});
  assert.equal(response.status,403);
});
test('fails closed when Google Apps Script integration is not configured',async()=>{
  const response=await call(lead,{});
  assert.equal(response.status,503);
  assert.equal((await response.json()).ok,false);
});
test('only acknowledges a matching receipt after upstream confirms save',async t=>{
  let seen;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    seen={url,options};
    return new Response(JSON.stringify({ok:true,receipt}),{status:200,headers:{'Content-Type':'application/json'}});
  });
  const response=await call(lead);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,receipt,duplicate:false});
  assert.equal(seen.url,env.SHEETS_WEB_APP_URL);
  const data=JSON.parse(seen.options.body);
  assert.equal(data.token,env.SHEETS_INGEST_TOKEN);
  assert.equal(data.lead.phone,'01012345678');
  assert.equal(data.lead.carrier,'SKT');
  assert.equal(data.lead.receipt,receipt);
});
test('uses the verified deployed Apps Script URL when the optional URL variable is absent',async t=>{
  let target=null;
  t.mock.method(globalThis,'fetch',async(url)=>{
    target=url;
    return new Response(JSON.stringify({ok:true,receipt}),{status:200,headers:{'Content-Type':'application/json'}});
  });
  const response=await call(lead,{SHEETS_INGEST_TOKEN:'test-only-secret'});
  assert.equal(response.status,200);
  assert.equal(target,'https://script.google.com/macros/s/AKfycbxfyfm31B2XgMv5GywGbS4iFN3P8BGfAYbw-GRaBijL73pF_-tIBKMKXaPjYLx1XwDgHw/exec');
});
test('does not show success if Google Apps Script cannot confirm receipt',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({ok:true,receipt:'mismatch'}),{status:200}));
  const response=await call(lead);
  assert.equal(response.status,502);
  assert.equal((await response.json()).ok,false);
});
test('Apps Script writes 12 expected columns and preserves phone as text',()=>{
  const code=readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8');
  let saved=null, format=null, released=false;
  const sheet={
    getLastRow:()=>1,
    getRange:(row,col,rows,cols)=>({
      setNumberFormat:v=>{format={row,col,v};},
      setValues:v=>{saved={row,col,rows,cols,values:v};}
    })
  };
  const context={
    ContentService:{MimeType:{JSON:'application/json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>({INGEST_TOKEN:'test-token',SHEET_ID:'sheet-id'}[k]||'')})},
    SpreadsheetApp:{openById:id=>{assert.equal(id,'sheet-id');return {getSheetByName:name=>{assert.equal(name,'상담DB');return sheet;}}},flush(){}},
    LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{released=true;}})},
    console,
  };
  runInNewContext(code,context);
  const output=context.doPost({postData:{contents:JSON.stringify({token:'test-token',lead:{name:'Test Customer',phone:'01012345678',carrier:'SKT',model:'S26',consent:true,receipt}})}});
  const result=JSON.parse(output.text);
  assert.equal(result.ok,true);
  assert.equal(result.receipt,receipt);
  assert.deepEqual(format,{row:2,col:3,v:'@'});
  assert.equal(saved.values[0].length,12);
  assert.equal(saved.values[0][1],'Test Customer');
  assert.equal(saved.values[0][2],'01012345678');
  assert.equal(saved.values[0][5],'신규');
  assert.equal(saved.values[0][10],'동의');
  assert.equal(saved.values[0][11],receipt);
  assert.equal(released,true);
});

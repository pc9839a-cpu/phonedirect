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
  assert.equal(response.headers.get('X-Lead-Email-Configured'),'no');
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
  assert.deepEqual(await response.json(),{ok:true,receipt,duplicate:false,sheet_status:'saved',email_status:'not_configured'});
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
  assert.equal(target,'https://script.google.com/macros/s/AKfycbwYmSXOh_XQCp-RCK5WCGKqv5bboQB-nSkqXiJFEgqPiUhZQj7UIq1kNoFiCjuKg3sQhg/exec');
});
test('does not show success if Google Apps Script cannot confirm receipt',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({ok:true,receipt:'mismatch'}),{status:200}));
  const response=await call(lead);
  assert.equal(response.status,502);
  assert.equal((await response.json()).ok,false);
});
test('Apps Script writes 12 expected columns and preserves phone as text',()=>{
  const code=readFileSync(new URL('../google-apps-script/Code.gs',import.meta.url),'utf8');
  let saved=null, phoneFormat=null, dateTimeFormat=null, released=false;
  const sheet={
    getLastRow:()=>1,
    getRange:(row,col,rows,cols)=>({
      setNumberFormat:v=>{if(col===1)dateTimeFormat={row,col,v};else phoneFormat={row,col,v};},
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
  assert.deepEqual(phoneFormat,{row:2,col:3,v:'@'});
  assert.deepEqual(dateTimeFormat,{row:2,col:1,v:'yyyy-mm-dd hh:mm:ss'});
  assert.ok(saved.values[0][0] instanceof Date || Object.prototype.toString.call(saved.values[0][0])==='[object Date]');
  assert.equal(saved.values[0].length,12);
  assert.equal(saved.values[0][1],'Test Customer');
  assert.equal(saved.values[0][2],'01012345678');
  assert.equal(saved.values[0][5],'신규');
  assert.equal(saved.values[0][10],'동의');
  assert.equal(saved.values[0][11],receipt);
  assert.equal(released,true);
});

const sesEnv={...env,AWS_SES_ACCESS_KEY_ID:'AKIATESTKEY123',AWS_SES_SECRET_ACCESS_KEY:'unit-test-only-not-a-secret'};
const sesEndpoint='https://email.ap-northeast-2.amazonaws.com/v2/email/outbound-emails';

test('SES sends the same twelve sheet columns to the fixed recipient after confirmed Sheet save',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    calls.push({url,opts});
    return url===sesEndpoint
      ?new Response(JSON.stringify({MessageId:'ses-message-1'}),{status:200})
      :new Response(JSON.stringify({ok:true,receipt}),{status:200});
  });
  const response=await call(lead,sesEnv);
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,receipt,duplicate:false,sheet_status:'saved',email_status:'sent'});
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,env.SHEETS_WEB_APP_URL);
  assert.equal(calls[1].url,sesEndpoint);
  const mail=JSON.parse(calls[1].opts.body);
  assert.deepEqual(mail.Destination.ToAddresses,['jiyounicom@gmail.com']);
  assert.match(mail.FromEmailAddress,/support@pagero\.kr/);
  assert.match(mail.Content.Simple.Body.Text.Data,/성함: Test Customer/);
  assert.match(mail.Content.Simple.Body.Text.Data,/연락처: 01012345678/);
  assert.match(mail.Content.Simple.Body.Text.Data,/통신사: SKT/);
  assert.match(mail.Content.Simple.Body.Text.Data,/희망기종: S26/);
  assert.match(mail.Content.Simple.Body.Text.Data,/상태: 신규/);
  assert.match(mail.Content.Simple.Body.Text.Data,/개인정보 동의: 동의/);
  assert.match(mail.Content.Simple.Body.Text.Data,/접수ID: test-receipt-1234567890/);
  assert.equal((mail.Content.Simple.Body.Text.Data.match(/: /g)||[]).length,12);
});
test('falls back to SES mail when Sheet cannot confirm storage',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    calls.push({url,opts});
    return url===sesEndpoint
      ?new Response(JSON.stringify({MessageId:'ses-fallback'}),{status:200})
      :new Response(JSON.stringify({ok:false,code:'missing_sheet'}),{status:200});
  });
  const response=await call(lead,sesEnv);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.sheet_status,'failed');
  assert.equal(result.email_status,'sent');
  assert.match(result.message,/이메일로 접수/);
  assert.match(JSON.parse(calls[1].opts.body).Content.Simple.Subject.Data,/시트 저장 실패/);
});
test('does not email again for existing Sheet receipt',async t=>{
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    calls.push({url,opts});
    return new Response(JSON.stringify({ok:true,receipt,duplicate:true}),{status:200});
  });
  const response=await call(lead,sesEnv);
  assert.equal(response.status,200);
  assert.equal((await response.json()).email_status,'skipped_duplicate');
  assert.equal(calls.length,1);
});
test('preserves Sheet success if SES provider fails',async t=>{
  t.mock.method(globalThis,'fetch',async url=>{
    if(url===sesEndpoint)return new Response(JSON.stringify({message:'SES rejection'}),{status:403});
    return new Response(JSON.stringify({ok:true,receipt}),{status:200});
  });
  const response=await call(lead,sesEnv);
  assert.equal(response.status,200);
  assert.equal((await response.json()).email_status,'failed');
});
test('email HTML escapes user-provided values',async t=>{
  const htmlLead={...lead,name:'<img src=x onerror=alert(1)>'};
  let mailBody;
  t.mock.method(globalThis,'fetch',async (url,opts)=>{
    if(url===sesEndpoint){mailBody=JSON.parse(opts.body);return new Response(JSON.stringify({MessageId:'1'}),{status:200});}
    return new Response(JSON.stringify({ok:true,receipt}),{status:200});
  });
  assert.equal((await call(htmlLead,sesEnv)).status,200);
  const html=mailBody.Content.Simple.Body.Html.Data;
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img src=x/);
});
test('legacy Cloudflare Sheets URL override is migrated to the new endpoint',async t=>{
  let target='';
  t.mock.method(globalThis,'fetch',async url=>{target=url;return new Response(JSON.stringify({ok:true,receipt}),{status:200});});
  const response=await call(lead,{...env,SHEETS_WEB_APP_URL:'https://script.google.com/macros/s/AKfycbxazF_2GoLRzRt8ySITkcwS5ZFXXq-FpLYlkuZdvx68JpKoo4lLhHyw4QPvdkYxDK40sA/exec'});
  assert.equal(response.status,200);
  assert.match(target,/AKfycbwYmSXOh_XQCp-RCK5WCGKqv5bboQB-nSkqXiJFEgqPiUhZQj7UIq1kNoFiCjuKg3sQhg/);
});

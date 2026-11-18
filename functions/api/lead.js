import { sendSesEmail, sesReady } from './_ses.js';
// Cloudflare Pages Function. No customer data or API secrets are logged.
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const str=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const phones=/^01[016789]\d{8}$/;
const carriers={SK:'SKT',KT:'KT',LG:'LG U+'};
const models={s26:'S26',plus:'S26+',ultra:'S26 Ultra',flip:'Flip8',fold:'Fold8'};
// Public Apps Script deployment URL. Only the INGEST_TOKEN is confidential.
const DEFAULT_SHEETS_WEB_APP_URL='https://script.google.com/macros/s/AKfycbwYmSXOh_XQCp-RCK5WCGKqv5bboQB-nSkqXiJFEgqPiUhZQj7UIq1kNoFiCjuKg3sQhg/exec';
const LEGACY_SHEETS_WEB_APP_URL='https://script.google.com/macros/s/AKfycbxazF_2GoLRzRt8ySITkcwS5ZFXXq-FpLYlkuZdvx68JpKoo4lLhHyw4QPvdkYxDK40sA/exec';
const resolveWebAppUrl=env=>{
  const configured=typeof env?.SHEETS_WEB_APP_URL==='string'?env.SHEETS_WEB_APP_URL.trim():'';
  // Repair the former deployment URL even if Cloudflare still has the old override.
  return configured&&configured!==LEGACY_SHEETS_WEB_APP_URL?configured:DEFAULT_SHEETS_WEB_APP_URL;
};
// GET is never allowed to submit data. A non-sensitive header indicates only
// whether both Cloudflare Pages secrets are present; it does not check Sheet writes.
export async function onRequestGet({env}){
  const response=json(405,{ok:false,message:'POST 요청만 지원합니다.'});
  const hasUrl=Boolean(resolveWebAppUrl(env));
  const hasToken=typeof env?.SHEETS_INGEST_TOKEN==='string'&&env.SHEETS_INGEST_TOKEN.trim().length>0;
  response.headers.set('X-Lead-Bridge-Configured',hasUrl&&hasToken?'yes':'no');
  response.headers.set('X-Lead-Email-Configured',sesReady(env)?'yes':'no');
  response.headers.set('X-Lead-Bridge-Missing',hasUrl?(hasToken?'none':'token'):(hasToken?'url':'url,token'));
  return response;
}

// Same twelve columns as google-apps-script/Code.gs, in the same order.
// The timestamp here represents receipt time at the edge, not the Sheet cell's write timestamp.
const sanitizeCell=(v)=>{const s=String(v??'').trim();return /^[=+\\-@]/.test(s)?"'"+s:s;};
const escapeHtml=(v)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const LABELS=['접수일시','성함','연락처','통신사','희망기종','상태','메모','유입경로','UTM 출처','UTM 캠페인','개인정보 동의','접수ID'];
function sheetRow(lead, timestamp){
  const at=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(timestamp);
  return [at,sanitizeCell(lead.name),lead.phone,sanitizeCell(lead.carrier),sanitizeCell(lead.model),'신규','',
    sanitizeCell(lead.referrer||lead.source||'직접유입'),
    sanitizeCell(lead.utm_source),sanitizeCell(lead.utm_campaign),'동의',lead.receipt];
}
function emailContent(lead, timestamp, sheetSaved){
  const row=sheetRow(lead,timestamp);
  const status=sheetSaved?'구글시트 저장 확인':'구글시트 저장 실패 — 이메일로 접수';
  const subject=sheetSaved?'[폰다이렉트] 신규 상담 신청':'[폰다이렉트] 신규 상담 신청 (시트 저장 실패)';
  const text=[status,'',...LABELS.map((label,i)=>label+': '+(row[i]||''))].join('\n');
  const lines=LABELS.map((label,i)=>'<tr><th style="text-align:left;vertical-align:top;padding:10px 14px;border-bottom:1px solid #e5e7eb;background:#f8fafc;white-space:nowrap;">'+escapeHtml(label)+'</th><td style="padding:10px 14px;border-bottom:1px solid #e5e7eb;overflow-wrap:anywhere;">'+escapeHtml(row[i])+'</td></tr>').join('');
  const html='<!doctype html><html lang="ko"><body style="margin:0;padding:24px;background:#f4f6fa;font-family:Arial,\'Malgun Gothic\',sans-serif;color:#111827;"><div style="max-width:640px;margin:auto;background:white;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;"><div style="padding:22px 24px;background:#1e40af;color:#fff;font-size:21px;font-weight:700;">폰다이렉트 신규 상담 신청</div><p style="padding:0 24px;color:#374151;">'+escapeHtml(status)+'</p><table style="border-collapse:collapse;width:100%;font-size:14px;">'+lines+'</table></div></body></html>';
  return {subject,text,html};
}
async function notifyEmail(lead,timestamp,sheetSaved,env){
  if(!sesReady(env))return 'not_configured';
  const message=emailContent(lead,timestamp,sheetSaved);
  try{
    await sendSesEmail({to:'jiyounicom@gmail.com',from:String(env.PHONEDIRECT_SES_FROM_EMAIL||'폰다이렉트 <support@pagero.kr>'),...message},env);
    return 'sent';
  }catch(error){
    // Never include customer data, SES request/response, or credentials in server logs.
    console.warn('PhoneDirect SES send failed',String(error?.code||'EMAIL_SEND_FAILED'));
    return 'failed';
  }
}
async function saveSheet(lead,env){
  if(!env?.SHEETS_INGEST_TOKEN)return {ok:false,status:503,message:'현재 상담 접수 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.'};
  let endpoint;
  try{
    endpoint=new URL(resolveWebAppUrl(env));
    if(endpoint.protocol!=='https:'||endpoint.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname))
      throw Error('Invalid endpoint');
  }catch(_){return {ok:false,status:503,message:'접수 서버 설정을 확인 중입니다. 잠시 후 다시 시도해 주세요.'};}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const upstream=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'text/plain; charset=utf-8'},
      body:JSON.stringify({token:env.SHEETS_INGEST_TOKEN,lead}),redirect:'follow',signal:controller.signal});
    if(!upstream.ok)return {ok:false,status:502,message:'접수 서버 연결에 실패했습니다. 다시 시도해 주세요.'};
    const result=await upstream.json().catch(()=>null);
    if(!result||result.ok!==true||result.receipt!==lead.receipt){
      const allowed=new Set(['unauthorized','invalid_lead','missing_sheet','busy','server_error','bad_request']);
      return {ok:false,status:502,message:'접수 저장이 확인되지 않았습니다. 같은 내용으로 다시 시도해 주세요.',
        error_code:allowed.has(result?.code)?result.code:'unconfirmed_write'};
    }
    return {ok:true,duplicate:result.duplicate===true};
  }catch(_){return {ok:false,status:502,message:'접수 서버에 연결하지 못했습니다. 같은 내용으로 다시 시도해 주세요.'};}
  finally{clearTimeout(timer);}
}
export async function onRequestPost({request,env}){
  const host=new URL(request.url);
  const origin=request.headers.get('Origin');
  if(origin){try{if(new URL(origin).origin!==host.origin)return json(403,{ok:false,message:'허용되지 않는 요청입니다.'});}
    catch(_){return json(403,{ok:false,message:'허용되지 않는 요청입니다.'});}}
  if(!(request.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
    return json(415,{ok:false,message:'잘못된 요청 형식입니다.'});
  if(Number(request.headers.get('Content-Length')||0)>8192)
    return json(413,{ok:false,message:'입력 길이를 확인해 주세요.'});
  let b;
  try{const raw=await request.text();if(raw.length>8192)return json(413,{ok:false,message:'입력 길이를 확인해 주세요.'});b=JSON.parse(raw);}
  catch(_){return json(400,{ok:false,message:'잘못된 신청 정보입니다.'});}
  if(!b||typeof b!=='object'||Array.isArray(b))return json(400,{ok:false,message:'잘못된 신청 정보입니다.'});
  const name=str(b.name,30),phone=str(b.phone,20),carrier=str(b.carrier,10),model=str(b.model,20),receipt=str(b.receipt,128);
  if(!name||!phones.test(phone)||!Object.hasOwn(carriers,carrier)||!Object.hasOwn(models,model)
     ||b.consent!==true||!/^[A-Za-z0-9._-]{16,128}$/.test(receipt))
    return json(422,{ok:false,message:'필수 신청 정보를 다시 확인해 주세요.'});
  const lead={name,phone,carrier:carriers[carrier],model:models[model],consent:true,receipt,
    source:str(b.source,200),referrer:str(b.referrer,500),utm_source:str(b.utm_source,120),utm_campaign:str(b.utm_campaign,150)};
  const timestamp=new Date();
  const sheet=await saveSheet(lead,env);
  if(sheet.ok&&sheet.duplicate===true){
    // A previously saved receipt must not generate another notification on retry.
    return json(200,{ok:true,receipt,duplicate:true,sheet_status:'saved',email_status:'skipped_duplicate'});
  }
  // Independent fallback: notify even when Google Sheets fails.
  const emailStatus=await notifyEmail(lead,timestamp,sheet.ok,env);
  if(sheet.ok){
    return json(200,{ok:true,receipt,duplicate:false,sheet_status:'saved',email_status:emailStatus});
  }
  if(emailStatus==='sent'){
    return json(200,{ok:true,receipt,duplicate:false,sheet_status:'failed',email_status:'sent',
      message:'상담 신청이 이메일로 접수되었습니다. 구글시트 저장은 확인되지 않았습니다.'});
  }
  return json(sheet.status,{ok:false,message:sheet.message,error_code:sheet.error_code||'',
    email_status:emailStatus,sheet_status:'failed'});
}

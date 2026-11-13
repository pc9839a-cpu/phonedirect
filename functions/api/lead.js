// Cloudflare Pages Function. No customer data or API secrets are logged.
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const str=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const phones=/^01[016789]\d{8}$/;
const carriers={SK:'SKT',KT:'KT',LG:'LG U+'};
const models={s26:'S26',plus:'S26+',ultra:'S26 Ultra',flip:'Flip8',fold:'Fold8'};
// Non-mutating readiness check: only signals whether the two required secrets exist.
// No token, endpoint URL or customer data is returned.
export function onRequestHead({env}){
  const configured=Boolean(env?.SHEETS_WEB_APP_URL&&env?.SHEETS_INGEST_TOKEN);
  return new Response(null,{status:configured?204:503,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export async function onRequestGet(){return json(405,{ok:false,message:'POST 요청만 지원합니다.'})}
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
  if(!env||!env.SHEETS_WEB_APP_URL||!env.SHEETS_INGEST_TOKEN)
    return json(503,{ok:false,message:'현재 상담 접수 연결을 준비 중입니다. 잠시 후 다시 시도해 주세요.'});
  let endpoint;
  try{
    endpoint=new URL(env.SHEETS_WEB_APP_URL);
    if(endpoint.protocol!=='https:'||endpoint.hostname!=='script.google.com'||!/^\/macros\/s\/[^/]+\/exec$/.test(endpoint.pathname))
      throw Error('Invalid endpoint');
  }catch(_){return json(503,{ok:false,message:'접수 서버 설정을 확인 중입니다. 잠시 후 다시 시도해 주세요.'});}
  const lead={name,phone,carrier:carriers[carrier],model:models[model],consent:true,receipt,
    source:str(b.source,200),referrer:str(b.referrer,500),utm_source:str(b.utm_source,120),utm_campaign:str(b.utm_campaign,150)};
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
  try{
    const upstream=await fetch(endpoint.href,{method:'POST',headers:{'Content-Type':'text/plain; charset=utf-8'},
      body:JSON.stringify({token:env.SHEETS_INGEST_TOKEN,lead}),redirect:'follow',signal:controller.signal});
    if(!upstream.ok)return json(502,{ok:false,message:'접수 서버 연결에 실패했습니다. 다시 시도해 주세요.'});
    const result=await upstream.json().catch(()=>null);
    if(!result||result.ok!==true||result.receipt!==receipt)
      return json(502,{ok:false,message:'접수 저장이 확인되지 않았습니다. 같은 내용으로 다시 시도해 주세요.'});
    return json(200,{ok:true,receipt,duplicate:result.duplicate===true});
  }catch(_){return json(502,{ok:false,message:'접수 서버에 연결하지 못했습니다. 같은 내용으로 다시 시도해 주세요.'});}
  finally{clearTimeout(timer);}
}
// Google Apps Script Web App, run as the sheet owner.
// Script Properties: INGEST_TOKEN (private, same as Cloudflare SHEETS_INGEST_TOKEN).
var DEFAULT_SHEET_ID='1rZJryOyXkcCgRSXL4Dmfegul0I8ue-W65RUQxT3paXU';
var SHEET_TAB='상담DB';
function response_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
function literal_(value){
  var s=String(value===undefined||value===null?'':value).trim();
  return /^[=+\-@]/.test(s)?"'"+s:s;
}
function doPost(e){
  try{
    if(!e||!e.postData||!e.postData.contents)return response_({ok:false,code:'bad_request'});
    var input=JSON.parse(e.postData.contents),props=PropertiesService.getScriptProperties();
    var expected=props.getProperty('INGEST_TOKEN');
    if(!expected||!input||input.token!==expected)return response_({ok:false,code:'unauthorized'});
    var v=input.lead||{};
    var name=String(v.name||'').trim(),phone=String(v.phone||'').replace(/\D/g,'');
    var receipt=String(v.receipt||'').trim();
    if(!name||name.length>30||!/^01[016789]\d{8}$/.test(phone)
      ||['SKT','KT','LG U+'].indexOf(v.carrier)===-1
      ||['S26','S26+','S26 Ultra','Flip8','Fold8'].indexOf(v.model)===-1
      ||v.consent!==true||!/^[A-Za-z0-9._-]{16,128}$/.test(receipt))
      return response_({ok:false,code:'invalid_lead'});
    var lock=LockService.getScriptLock();
    if(!lock.tryLock(10000))return response_({ok:false,code:'busy'});
    try{
      var ss=SpreadsheetApp.openById(props.getProperty('SHEET_ID')||DEFAULT_SHEET_ID);
      var sheet=ss.getSheetByName(SHEET_TAB);
      if(!sheet)return response_({ok:false,code:'missing_sheet'});
      var last=sheet.getLastRow();
      if(last>=2){
        var existing=sheet.getRange(2,12,last-1,1).createTextFinder(receipt).matchEntireCell(true).findNext();
        if(existing)return response_({ok:true,receipt:receipt,duplicate:true});
      }
      var row=last+1;
      sheet.getRange(row,3).setNumberFormat('@');
      sheet.getRange(row,1,1,12).setValues([[
        new Date(),literal_(name),phone,literal_(v.carrier),literal_(v.model),'신규','',
        literal_(v.referrer||v.source||'직접유입'),
        literal_(v.utm_source||''),literal_(v.utm_campaign||''),'동의',receipt
      ]]);
      SpreadsheetApp.flush();
      return response_({ok:true,receipt:receipt,duplicate:false});
    }finally{lock.releaseLock();}
  }catch(error){
    console.error('Lead save failed: '+(error&&error.name?error.name:'unknown'));
    return response_({ok:false,code:'server_error'});
  }
}
function doGet(){return response_({ok:false,code:'method_not_allowed'});}

// Shared validation only. Never log or persist the object returned by validateW9.
export const W9_REVISION = '2024-03';
export const W9_CONSENT_VERSION = 'sdg-w9-v1';
export const W9_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const W9_CLASSIFICATIONS = [
  ['individual','Individual / sole proprietor'],['c_corporation','C corporation'],
  ['s_corporation','S corporation'],['partnership','Partnership'],['trust_estate','Trust / estate'],
  ['llc','LLC'],['other','Other'],
];
export const W9_CERTIFICATIONS = [
  'The number shown on this form is my correct taxpayer identification number (or I am waiting for a number to be issued to me); and',
  'I am not subject to backup withholding because (a) I am exempt from backup withholding, or (b) I have not been notified by the Internal Revenue Service (IRS) that I am subject to backup withholding as a result of a failure to report all interest or dividends, or (c) the IRS has notified me that I am no longer subject to backup withholding; and',
  'I am a U.S. citizen or other U.S. person (defined in the instructions); and',
  'The FATCA code(s) entered on this form (if any) indicating that I am exempt from FATCA reporting is correct.',
];
export const W9_SIGNING_NOTICE = 'By typing my name and clicking Submit, I electronically sign this Form W-9 under penalties of perjury. I am the person identified on this form or am authorized to sign for that person or entity. I consent to electronic records and signatures and can download a copy of my submitted form.';
const textFields = {
  legalName:120,businessName:120,otherClassification:80,address:160,cityStateZip:120,
  requester:160,accountNumbers:80,signature:100,exemptPayee:2,fatca:1,llcClassification:1,
};
export function validateW9(body) {
  const fail=error=>({ok:false,error});
  if (!body || typeof body!=='object' || Array.isArray(body)) return fail('Complete the W-9 form.');
  const allowed=[...Object.keys(textFields),'id','classification','tinType','tin','foreignOwners','backupWithholding','certified','usPerson','consentVersion'];
  if (Object.keys(body).some(k=>!allowed.includes(k))) return fail('Unexpected form fields. Reload the form.');
  const data={};
  for (const [key,max] of Object.entries(textFields)) {
    if (body[key]!==undefined && typeof body[key]!=='string') return fail('Invalid text field.');
    data[key]=(body[key]||'').trim();
    if(data[key].length>max || /[\u0000-\u001f\u007f]/.test(data[key])) return fail('A text field is too long or contains unsupported control characters.');
  }
  if(!W9_UUID.test(body.id||''))return fail('Reload the form before submitting.');
  if(!data.legalName || !data.address || !data.cityStateZip) return fail('Legal name and complete mailing address are required.');
  if(!W9_CLASSIFICATIONS.some(([v])=>v===body.classification))return fail('Select your federal tax classification.');
  if(body.classification==='llc'&&!['C','S','P'].includes(data.llcClassification))return fail('Select the LLC tax classification.');
  if(body.classification==='other'&&!data.otherClassification)return fail('Specify the other tax classification.');
  if(data.exemptPayee&&!/^(?:[1-9]|1[0-3])$/.test(data.exemptPayee))return fail('Enter a valid exempt payee code from the instructions.');
  if(data.fatca&&!/^[A-M]$/.test(data.fatca))return fail('Enter a valid FATCA exemption code from the instructions.');
  if(body.classification==='individual'&&(data.exemptPayee||data.fatca))return fail('Exemption codes apply only to certain entities, not individuals.');
  if(!['ssn','ein','itin'].includes(body.tinType))return fail('Select SSN, ITIN, or EIN.');
  if(typeof body.tin!=='string'||!/^[\d -]+$/.test(body.tin))return fail('Enter your nine-digit taxpayer identification number.');
  const tin=body.tin.replace(/[ -]/g,'');
  if(!/^\d{9}$/.test(tin)||/^(\d)\1{8}$/.test(tin))return fail('Enter your nine-digit taxpayer identification number.');
  for (const key of ['foreignOwners','backupWithholding','certified','usPerson']) {
    if(typeof body[key]!=='boolean')return fail('Complete all certification selections.');
  }
  if(body.foreignOwners&&!['partnership','trust_estate'].includes(body.classification)&&!(body.classification==='llc'&&data.llcClassification==='P'))
    return fail('Line 3b does not apply to this tax classification.');
  if(!body.usPerson)return fail('Form W-9 is for U.S. persons. Contact Stardust Garage for the appropriate foreign-person tax documentation.');
  if(!body.certified||!data.signature||body.consentVersion!==W9_CONSENT_VERSION)return fail('Read the certification, consent to electronic signing, and enter your signature.');
  return {ok:true,data:{...data,id:body.id,classification:body.classification,tinType:body.tinType,tin,
    foreignOwners:body.foreignOwners,backupWithholding:body.backupWithholding}};
}

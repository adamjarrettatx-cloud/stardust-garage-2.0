import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { W9_SIGNING_NOTICE } from './form.js';

export async function renderW9Pdf(data, { userId, signedAt, submissionId }) {
  const source=await readFile(path.join(process.cwd(),'lib/w9/assets/fw9.pdf'));
  const pdf=await PDFDocument.load(source);
  const form=pdf.getForm();
  const font=await pdf.embedFont(StandardFonts.Helvetica);
  const prefix='topmostSubform[0].Page1[0].';
  const set=(name,value)=>{
    const f=form.getTextField(prefix+name);
    const width=f.acroField.getWidgets()[0].getRectangle().width-8;
    const size=Math.min(9,width/Math.max(1,font.widthOfTextAtSize(value||'',1)));
    // Never archive clipped or illegibly tiny tax information.
    if(size<6)throw new Error('field_does_not_fit');
    f.setText(value||'');f.setFontSize(size);
  };
  // Never transliterate or silently drop characters from a signed tax record.
  for(const value of Object.values(data))if(typeof value==='string')font.encodeText(value);
  set('f1_01[0]',data.legalName);set('f1_02[0]',data.businessName);
  const kinds=['individual','c_corporation','s_corporation','partnership','trust_estate','llc','other'];
  form.getCheckBox(prefix+`Boxes3a-b_ReadOrder[0].c1_1[${kinds.indexOf(data.classification)}]`).check();
  set('Boxes3a-b_ReadOrder[0].f1_03[0]',data.classification==='llc'?data.llcClassification:'');
  set('Boxes3a-b_ReadOrder[0].f1_04[0]',data.classification==='other'?data.otherClassification:'');
  if(data.foreignOwners)form.getCheckBox(prefix+'Boxes3a-b_ReadOrder[0].c1_2[0]').check();
  set('f1_05[0]',data.exemptPayee);set('f1_06[0]',data.fatca);
  set('Address_ReadOrder[0].f1_07[0]',data.address);set('Address_ReadOrder[0].f1_08[0]',data.cityStateZip);
  set('f1_09[0]',data.requester);set('f1_10[0]',data.accountNumbers);
  if(data.tinType==='ein'){set('f1_14[0]',data.tin.slice(0,2));set('f1_15[0]',data.tin.slice(2))}
  else{set('f1_11[0]',data.tin.slice(0,3));set('f1_12[0]',data.tin.slice(3,5));set('f1_13[0]',data.tin.slice(5))}
  form.updateFieldAppearances(font);form.flatten();
  const page=pdf.getPages()[0];
  const signatureSize=Math.min(10,245/font.widthOfTextAtSize(data.signature,1));
  page.drawText(data.signature,{x:128,y:196,size:signatureSize,font});
  page.drawText(new Date(signedAt).toISOString().slice(0,10),{x:414,y:196,size:10,font});
  if(data.backupWithholding){
    // Cross out certification item 2, preserving the other certifications.
    for(const [y,end] of [[306.5,576],[296.9,576],[287.3,208]])page.drawLine({start:{x:36,y},end:{x:end,y},thickness:.7,color:rgb(0,0,0)});
  }
  const receipt=pdf.addPage([612,792]);
  let y=742;
  const line=(text,size=10)=>{receipt.drawText(text,{x:40,y,size,font,maxWidth:530,lineHeight:15});y-=size===10?26:34};
  line('Stardust Garage | Electronic W-9 submission',16);
  line(`Submission: ${submissionId}`);line(`Authenticated account: ${userId}`);line(`Signed at (UTC): ${signedAt}`);
  line('Form: IRS W-9, March 2024 | Consent: sdg-w9-v1');
  line(`Electronic signature: ${data.signature}`);y-=10;
  receipt.drawText(W9_SIGNING_NOTICE,{x:40,y,size:10,font,maxWidth:530,lineHeight:15});
  pdf.setTitle('Signed Form W-9');pdf.setAuthor('Stardust Garage');pdf.setSubject('Confidential taxpayer information');
  return Buffer.from(await pdf.save());
}

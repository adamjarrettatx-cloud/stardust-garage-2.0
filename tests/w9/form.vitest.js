import { describe,it,expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { validateW9,W9_CONSENT_VERSION } from '@/lib/w9/form';
import { renderW9Pdf } from '@/lib/w9/pdf';
export const sample={
  id:'77777777-7777-4777-8777-777777777777',legalName:'TEST ARTIST ONLY',businessName:'Example Music',
  classification:'individual',address:'123 Example Street',cityStateZip:'Austin, TX 78701',
  tinType:'ssn',tin:'123-45-6789',foreignOwners:false,backupWithholding:false,usPerson:true,
  certified:true,signature:'TEST ARTIST ONLY',consentVersion:W9_CONSENT_VERSION,
};
describe('W-9 form validation and PDF',()=>{
  it('normalizes TIN without persisting it separately',()=>{
    expect(validateW9(sample)).toMatchObject({ok:true,data:{tin:'123456789'}});
  });
  it.each(['legalName','address','cityStateZip','signature','classification','tin','tinType','id','consentVersion'])('rejects missing %s',key=>{
    expect(validateW9({...sample,[key]:''}).ok).toBe(false);
  });
  it.each(['certified','usPerson'])('requires affirmative %s',key=>expect(validateW9({...sample,[key]:false}).ok).toBe(false));
  it('rejects unknown fields, altered consent, malformed and incomplete identifiers',()=>{
    for(const change of [{user_id:'forged'},{tin:'12345678'},{tin:'111111111'},{tin:123456789},{certified:'true'},{consentVersion:'old'}])
      expect(validateW9({...sample,...change}).ok).toBe(false);
  });
  it('requires conditional entity fields and valid codes',()=>{
    for(const change of [{classification:'llc'},{classification:'other'},{foreignOwners:true},{exemptPayee:'14'},{fatca:'Z'},{exemptPayee:'1'}])
      expect(validateW9({...sample,...change}).ok).toBe(false);
    expect(validateW9({...sample,classification:'llc',llcClassification:'P',foreignOwners:true,tinType:'ein'}).ok).toBe(true);
  });
  it('generates a flattened official form, original instructions, and signing receipt',async()=>{
    const bytes=await renderW9Pdf(validateW9(sample).data,{userId:'test-user',signedAt:'2026-09-24T15:00:00Z',submissionId:sample.id});
    const pdf=await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(7);
    expect(pdf.getForm().getFields()).toHaveLength(0);
    expect(bytes.length).toBeGreaterThan(10000);
  });
  it('never silently alters unsupported legal-name glyphs',async()=>{
    await expect(renderW9Pdf(validateW9({...sample,legalName:'Test 漢'}).data,{userId:'test',signedAt:'2026-09-24T15:00:00Z',submissionId:sample.id})).rejects.toThrow();
  });
});

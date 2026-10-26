// Missing-year suggestions are proposals; callers must ask for confirmation.
export function suggestedImportYear(now=new Date()){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:'America/Nuuk',year:'numeric',month:'numeric'}).formatToParts(now).filter(p=>p.type!=='literal').map(p=>[p.type,Number(p.value)]));
 return parts.year+(parts.month===12?1:0);
}
export function prepareImportYears(result,source,now=new Date()){
 const proposed=suggestedImportYear(now),copy=structuredClone(result),flat=String(source||'').replace(/\s+/g,' ');
 const types={flights:['departure','arrival'],hotels:['checkIn','checkOut'],tours:['start','end'],cars:['pickup','dropoff']};
 for(const [type,fields] of Object.entries(types))for(const row of Array.isArray(copy?.[type])?copy[type]:[]){
  row.yearConfirmation={};
  fields.forEach((field,i)=>{
   const raw=String(row[field]||''),match=raw.match(/^(?:(\d{4})-|--)(\d{2}-\d{2})(T\d{2}:\d{2})?$/);if(!match)return;
   const phase=i?'end':'start',proof=String(row[phase+'YearEvidence']||'').replace(/\s+/g,' '),flag=row[phase+'YearMissing']===true||row.yearMissing===true;
   // A model-supplied year absent from the original cannot be accepted.
   const printed=match[1]&&new RegExp('\\b'+match[1]+'\\b').test(flat);
   const dateInProof=/(?:\d{1,2}[./-]\d{1,2}[./-](?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2}|\d{1,2}\.?\s+[A-Za-zÀ-ÿ]+\.?\s+\d{4}|[A-Za-z]+\.?\s+\d{1,2},?\s+\d{4})/.test(proof);
   const supported=printed&&proof&&flat.includes(proof)&&proof.includes(match[1])&&dateInProof;
   if(!flag&&supported)return;
   row[field]=proposed+'-'+match[2]+(match[3]||'');row.yearConfirmation[phase]=true;
  });
  // An undated-year December-to-January booking spans two calendar years.
  if(row.yearConfirmation.start&&row.yearConfirmation.end&&row[fields[1]].slice(5,10)<row[fields[0]].slice(5,10))row[fields[1]]=(proposed+1)+row[fields[1]].slice(4);
 }
 return copy;
}

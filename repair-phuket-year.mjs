// Temporary, narrowly scoped correction requested by the owner. Removed after use.
import {validateEvent,validateHoliday,hashToken} from './portal-server.js';
const repairId='phuket-year-2027-20261024';
const targetEmailHash='01ff7dd6c03d5932a2e9d8f55f67c02eb8c2bbe335cc90391695505f67cb2439';
const targetYear=2027;
export function withYear(value,year){if(!value)return value;return String(year)+value.slice(4)}
export async function repairPhuketYear(db,config={emailHash:targetEmailHash,year:targetYear,id:repairId}){
 await db.prepare('CREATE TABLE IF NOT EXISTS holiday_year_repairs (id TEXT PRIMARY KEY,holiday_id TEXT NOT NULL,backup_json TEXT NOT NULL,result_json TEXT NOT NULL,guard INTEGER NOT NULL CHECK(guard=1),created INTEGER NOT NULL)').run();
 const already=await db.prepare('SELECT result_json FROM holiday_year_repairs WHERE id=?').bind(config.id).first();if(already)return{state:'complete',...JSON.parse(already.result_json)};
 const accounts=(await db.prepare('SELECT id,email FROM holiday_accounts').all()).results;let owner=null;for(const account of accounts)if(await hashToken(account.email.toLowerCase())===config.emailHash)owner=account;
 if(!owner)return{state:'account-not-found'};
 const owned=(await db.prepare('SELECT * FROM holidays WHERE owner_id=?').bind(owner.id).all()).results;
 const keyword=v=>/\bphuket\b/i.test(v||'');
 let matches=owned.filter(h=>keyword(JSON.parse(h.data).name));
 if(!matches.length)matches=owned.filter(h=>keyword(JSON.parse(h.data).destination));
 if(!matches.length){for(const h of owned){const list=(await db.prepare('SELECT data FROM holiday_events WHERE holiday_id=?').bind(h.id).all()).results;if(list.some(row=>{const e=JSON.parse(row.data);return[e.from,e.to,e.title].some(v=>keyword(v)||/\bHKT\b/i.test(v||''))}))matches.push(h)}}
 if(matches.length!==1)return{state:matches.length?'ambiguous':'holiday-not-found'};
 const holiday=matches[0],original=JSON.parse(holiday.data),next={...original,start:withYear(original.start,config.year),end:withYear(original.end,config.year)};
 validateHoliday(next);
 const rows=(await db.prepare('SELECT id,data,version,updated FROM holiday_events WHERE holiday_id=?').bind(holiday.id).all()).results;
 const changed=[];for(const row of rows){const data=JSON.parse(row.data),updated={...data,start:withYear(data.start,config.year),end:withYear(data.end,config.year)};validateEvent(updated);if(JSON.stringify(updated)!==JSON.stringify(data))changed.push({id:row.id,data:JSON.stringify(updated)})}
 const expected=JSON.stringify(rows.map(row=>({id:row.id,version:row.version}))),changesHoliday=JSON.stringify(next)!==JSON.stringify(original),now=Date.now();
 const result={year:config.year,bookings:rows.length,changed:changed.length,holidayChanged:changesHoliday};
 const backup=JSON.stringify({holiday,events:rows});
 // The CHECK guard aborts the entire transaction if any booking or the holiday
 // changed after the snapshot. The original JSON and versions are retained.
 const statements=[db.prepare(`INSERT INTO holiday_year_repairs(id,holiday_id,backup_json,result_json,guard,created) VALUES(?,?,?,?,CASE WHEN
 (SELECT version FROM holidays WHERE id=?)=? AND
 (SELECT COUNT(*) FROM holiday_events WHERE holiday_id=?)=? AND
 NOT EXISTS(SELECT 1 FROM json_each(?) expected LEFT JOIN holiday_events e ON e.id=json_extract(expected.value,'$.id') AND e.holiday_id=? WHERE e.id IS NULL OR e.version<>json_extract(expected.value,'$.version'))
 THEN 1 ELSE 0 END,?)`).bind(config.id,holiday.id,backup,JSON.stringify(result),holiday.id,holiday.version,holiday.id,rows.length,expected,holiday.id,now)];
 if(changesHoliday)statements.push(db.prepare('UPDATE holidays SET data=?,version=version+1,updated=? WHERE id=?').bind(JSON.stringify(next),now,holiday.id));
 if(changed.length)statements.push(db.prepare(`UPDATE holiday_events SET data=(SELECT json_extract(value,'$.data') FROM json_each(?) WHERE json_extract(value,'$.id')=holiday_events.id),version=version+1,updated=? WHERE holiday_id=? AND id IN (SELECT json_extract(value,'$.id') FROM json_each(?))`).bind(JSON.stringify(changed),now,holiday.id,JSON.stringify(changed)));
 await db.batch(statements);
 const verify=(await db.prepare('SELECT data FROM holiday_events WHERE holiday_id=?').bind(holiday.id).all()).results;
 if(verify.some(row=>{const e=JSON.parse(row.data);return[e.start,e.end].filter(Boolean).some(value=>value.slice(0,4)!==String(config.year))}))throw Error('Årstalsrettelsen kunne ikke verificeres');
 return{state:'complete',...result};
}

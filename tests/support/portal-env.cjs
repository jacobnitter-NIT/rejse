const {DatabaseSync}=require('node:sqlite');
function environment(){
 const raw=new DatabaseSync(':memory:');
 const DB={prepare(sql){let args=[];return{bind(...values){args=values;return this},async first(){return raw.prepare(sql).get(...args)||null},async all(){return{results:raw.prepare(sql).all(...args)}},async run(){const result=raw.prepare(sql).run(...args);return{meta:{changes:result.changes}}}}},async batch(statements){raw.exec('BEGIN');try{const values=[];for(const s of statements)values.push(await s.run());raw.exec('COMMIT');return values}catch(e){raw.exec('ROLLBACK');throw e}}};
 const objects=new Map(),BUCKET={async put(key,value){objects.set(key,new Uint8Array(value));return{etag:'test-etag'}},async get(key){const value=objects.get(key);return value?{body:value}:null},async delete(key){objects.delete(key)}};
 return{DB,BUCKET,SYNC_KEY:'owner-secret',raw,objects};
}
module.exports={environment};

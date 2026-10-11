const test=require('node:test'),assert=require('node:assert/strict'),E=require('../trip-engine.js');
const people=['person-a','person-b','person-c'].map(id=>({id,name:id}));
test('currency precision and Danish decimal inputs',()=>{assert.equal(E.units('10,25'),1025);assert.equal(E.units('101','JPY'),101);assert.equal(E.units('1.234','KWD'),1234)});
test('rounding 100 kroner among three conserves every øre',()=>{assert.deepEqual(E.shares(10000,'equal',people,'DKK').map(p=>p.units),[3334,3333,3333])});
test('percent, fixed amount and weighted participant subsets',()=>{
 assert.deepEqual(E.shares(101,'percent',[{id:'a',value:25},{id:'b',value:75}],'DKK').map(p=>p.units),[25,76]);
 assert.deepEqual(E.shares(3000,'amount',[{id:'a',value:10},{id:'b',value:20}],'DKK').map(p=>p.units),[1000,2000]);
 assert.deepEqual(E.shares(3000,'weight',[{id:'a',value:2},{id:'c',value:1}],'DKK').map(p=>p.units),[2000,1000]);
});
test('reject invalid shares before accounting',()=>{for(const [mode,rows] of [['percent',[{id:'a',value:99}]],['amount',[{id:'a',value:2}]],['weight',[{id:'a',value:-1}]],['equal',[]],['equal',[{id:'a'},{id:'a'}]]])assert.throws(()=>E.shares(100,mode,rows,'DKK'))});
test('multiple payers, repayment and transfer conservation',()=>{
 const trip={people,expenses:[{paid:[{id:'person-a',units:7000},{id:'person-b',units:3000}],shares:E.shares(10000,'equal',people,'DKK')}],settlements:[]};
 assert.deepEqual(E.balances(trip),{'person-a':3666,'person-b':-333,'person-c':-3333});
 const transfers=E.transfers(trip);assert.equal(transfers.reduce((n,s)=>n+s.units,0),3666);
 trip.settlements=transfers;assert.deepEqual(Object.values(E.balances(trip)),[0,0,0]);assert.deepEqual(E.transfers(trip),[]);
});
test('randomized allocations always conserve and settle',()=>{
 for(let total=1;total<10000;total+=137){const shares=E.shares(total,'weight',people.map((p,i)=>({...p,value:i+1})),'DKK'),trip={people,expenses:[{paid:[{id:people[0].id,units:total}],shares}],settlements:[]};assert.equal(shares.reduce((n,p)=>n+p.units,0),total);trip.settlements=E.transfers(trip);assert.ok(Object.values(E.balances(trip)).every(n=>n===0))}
});

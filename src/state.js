export const EngineCfg = {
  windowMs: 25000,
  lowSplit: 52,
  sustainExtendMs: 120,
  minIOI: 40,
  maxIOI: 1000,
  defaultBpm: 110,
  smoothTempo: 0.2,
  minGapMs: {bass:120, mid:90, treb:80},
  ranges: {bass:{min:28,max:50}, mid:{min:55,max:72}, treb:{min:72,max:88}},
  human:{latency:22,jitter:10,swingDefault:0.54,vel:{bass:[58,86],mid:[56,82],treb:[56,82]},restBase:0.14}
};

export const AppState = {
  record:false,
  path:"—",
  stats:{frames:0,pb:0,taps:0},
  players:new Map(),
  dedupe:new Set(),
  midi:{access:null,out:null}
};

export function getPlayer(id){
  let p=AppState.players.get(id);
  if(p) return p;
  p={
    t0:null, recStart:null, events:[], active:new Map(), seen:0, last:0,
    analysis:null,
    accomp:{enabled:false,role:"bass",prevNote:null,prevDeg:null,refrac:0,active:new Set(),tempo:110,rhythm:{swing:0.54,grid8:Array(8).fill(0)}},
    model:{degLog:[],maxLog:64,ngram:new Map(),pcCooldown:new Array(12).fill(0)},
    vis:{pcw:new Array(12).fill(0),lastOuts:[],lastDeg:null,planned:[]}
  };
  AppState.players.set(id,p);
  return p;
}

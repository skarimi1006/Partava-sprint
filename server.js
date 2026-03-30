const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const PORT     = process.env.PORT || 3003;
const DATA_DIR = path.join(__dirname, 'data');
const PUB_DIR  = path.join(__dirname, 'public');

// ── ATOMIC DB LAYER ──────────────────────────────────────────────────────
// Write-then-rename = crash safe on Linux (atomic on same filesystem)
function readDB(name) {
  var f = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(f)) return [];
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) { return []; }
}
function writeDB(name, data) {
  var f   = path.join(DATA_DIR, name + '.json');
  var tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f); // atomic on Linux
}
function readObj(name) {
  var f = path.join(DATA_DIR, name + '.json');
  if (!fs.existsSync(f)) return {};
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch(e) { return {}; }
}
function writeObj(name, data) {
  var f   = path.join(DATA_DIR, name + '.json');
  var tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, f);
}

function hashPin(pin) { return crypto.createHash('sha256').update(pin + 'peava_salt_2024').digest('hex'); }
function genId()  { return crypto.randomBytes(8).toString('hex'); }
function genSid() { return crypto.randomBytes(32).toString('hex'); }

// ── SEED ─────────────────────────────────────────────────────────────────
function seed() {
  var users = readDB('users');
  if (!users.find(function(u){ return u.username === 'saeed'; })) {
    users.push({ id:genId(), username:'saeed', name:'Saeed', pin:hashPin('1234'), role:'admin', teamId:null, createdAt:new Date().toISOString() });
    writeDB('users', users);
    console.log('Admin created — username: saeed  PIN: 1234');
  }
  if (!readDB('teams').length) {
    writeDB('teams', [
      { id:genId(), name:'QC & Customer Support', color:'#00928A', createdAt:new Date().toISOString() },
      { id:genId(), name:'Development',            color:'#4A90D9', createdAt:new Date().toISOString() }
    ]);
  }
  if (!fs.existsSync(path.join(DATA_DIR,'tasks.json')))    writeDB('tasks',[]);
  if (!fs.existsSync(path.join(DATA_DIR,'archive.json')))  writeDB('archive',[]);
  if (!fs.existsSync(path.join(DATA_DIR,'comments.json'))) writeObj('comments',{});
  if (!fs.existsSync(path.join(DATA_DIR,'sessions.json'))) writeObj('sessions',{});
}

// ── AUTO-ARCHIVE: Done tasks older than 7 days ────────────────────────────
function runAutoArchive() {
  var tasks   = readDB('tasks');
  var archive = readDB('archive');
  var now     = Date.now();
  var keep    = [];
  tasks.forEach(function(t) {
    if (t.status === 'Done' && now - new Date(t.updatedAt).getTime() >= 7*24*60*60*1000) {
      t.archivedAt = new Date().toISOString();
      archive.push(t);
    } else {
      keep.push(t);
    }
  });
  if (keep.length !== tasks.length) {
    writeDB('tasks', keep);
    writeDB('archive', archive);
  }
}

// ── WEEKLY SPRINT RESET (Saturday) ───────────────────────────────────────
function checkWeeklyReset() {
  var meta   = readObj('meta');
  var now    = new Date();
  var day    = now.getDay(); // 6 = Saturday
  if (day !== 6) return;
  var todayStr = now.toISOString().split('T')[0];
  if (meta.lastReset === todayStr) return;

  // Archive all current tasks
  var tasks   = readDB('tasks');
  var archive = readDB('archive');
  tasks.forEach(function(t) {
    t.archivedAt = new Date().toISOString();
    t.resetArchived = true;
    archive.push(t);
  });
  writeDB('tasks', []);
  writeDB('archive', archive);
  meta.lastReset = todayStr;
  writeObj('meta', meta);
  console.log('Weekly sprint reset completed:', todayStr);
}

// Run checks on startup and hourly
runAutoArchive();
checkWeeklyReset();
setInterval(function() { runAutoArchive(); checkWeeklyReset(); }, 60*60*1000);

// ── SESSION ───────────────────────────────────────────────────────────────
function getSession(req) {
  var m = (req.headers.cookie||'').match(/sid=([a-f0-9]{64})/);
  if (!m) return null;
  var sessions = readObj('sessions');
  var s = sessions[m[1]];
  if (!s) return null;
  if (Date.now() - s.at > 86400000*7) return null;
  return s;
}
function requireAuth(req, res) {
  var s = getSession(req);
  if (!s) { send(res,401,{error:'Unauthorized'}); return null; }
  return s;
}
function requireAdmin(req, res) {
  var s = requireAuth(req, res);
  if (!s) return null;
  if (s.role !== 'admin') { send(res,403,{error:'Forbidden'}); return null; }
  return s;
}

// ── HTTP UTILS ────────────────────────────────────────────────────────────
function send(res, status, data) {
  var b = JSON.stringify(data);
  res.writeHead(status, {'Content-Type':'application/json','Content-Length':Buffer.byteLength(b)});
  res.end(b);
}
function serveFile(res, fp) {
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end('Not found'); return; }
  var ext  = path.extname(fp);
  var mime = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf'}[ext]||'text/plain';
  res.writeHead(200,{'Content-Type':mime});
  res.end(fs.readFileSync(fp));
}
function getBody(req) {
  return new Promise(function(resolve, reject) {
    var b = '';
    req.on('data', function(c){ b+=c; if(b.length>2e6) reject(new Error('too large')); });
    req.on('end',  function(){ try{ resolve(JSON.parse(b||'{}')); }catch(e){ resolve({}); } });
    req.on('error', reject);
  });
}

// ── EXCEL EXPORT (pure Node.js, no dependencies) ─────────────────────────
function buildXlsx(tasks, teams) {
  // Minimal XLSX: XML-based SpreadsheetML
  var teamMap = {};
  teams.forEach(function(t){ teamMap[t.id]=t.name; });

  var headers = ['#','Team','Assigned To','Role','Task Description','Customer','Version/Model','Category','Priority','Status','Done Date','% Done','Notes','Created At'];

  function escXml(v) {
    return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  var rows = tasks.map(function(t, i) {
    return [
      i+1,
      teamMap[t.teamId]||'—',
      t.member||'',
      t.role||'',
      t.desc||'',
      t.customer||'',
      t.version||'',
      t.category||'',
      t.priority||'',
      t.status||'',
      t.donedate||'',
      t.pct||'0%',
      t.notes||'',
      t.createdAt?t.createdAt.split('T')[0]:'',
    ];
  });

  var sharedStrings = [];
  var strIndex = {};
  function si(v) {
    var s = String(v);
    if (strIndex[s] === undefined) { strIndex[s] = sharedStrings.length; sharedStrings.push(s); }
    return strIndex[s];
  }

  // Build cell rows
  var colLetters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'];
  var sheetRows = '';

  // Header row
  sheetRows += '<row r="1">';
  headers.forEach(function(h, ci) {
    sheetRows += '<c r="'+colLetters[ci]+'1" t="s" s="1"><v>'+si(h)+'</v></c>';
  });
  sheetRows += '</row>';

  rows.forEach(function(row, ri) {
    sheetRows += '<row r="'+(ri+2)+'">';
    row.forEach(function(v, ci) {
      var rn = colLetters[ci]+(ri+2);
      if (ci === 0) {
        sheetRows += '<c r="'+rn+'"><v>'+v+'</v></c>';
      } else {
        sheetRows += '<c r="'+rn+'" t="s"><v>'+si(v)+'</v></c>';
      }
    });
    sheetRows += '</row>';
  });

  var ssXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="'+sharedStrings.length+'" uniqueCount="'+sharedStrings.length+'">'
    +sharedStrings.map(function(s){ return '<si><t xml:space="preserve">'+escXml(s)+'</t></si>'; }).join('')
    +'</sst>';

  var sheetXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    +'<sheetViews><sheetView workbookViewId="0" showGridLines="1"/></sheetViews>'
    +'<cols>'
    +'<col min="1" max="1" width="5"/>'
    +'<col min="2" max="2" width="20"/>'
    +'<col min="3" max="3" width="15"/>'
    +'<col min="4" max="4" width="15"/>'
    +'<col min="5" max="5" width="40"/>'
    +'<col min="6" max="6" width="12"/>'
    +'<col min="7" max="7" width="14"/>'
    +'<col min="8" max="8" width="14"/>'
    +'<col min="9" max="9" width="12"/>'
    +'<col min="10" max="10" width="14"/>'
    +'<col min="11" max="11" width="12"/>'
    +'<col min="12" max="12" width="8"/>'
    +'<col min="13" max="13" width="25"/>'
    +'<col min="14" max="14" width="14"/>'
    +'</cols>'
    +'<sheetData>'+sheetRows+'</sheetData>'
    +'</worksheet>';

  var stylesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    +'<fonts><font><sz val="11"/><name val="Arial"/></font><font><sz val="11"/><b/><name val="Arial"/></font></fonts>'
    +'<fills><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    +'<fill><patternFill patternType="solid"><fgColor rgb="FF00928A"/></patternFill></fill></fills>'
    +'<borders><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    +'<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    +'<cellXfs>'
    +'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    +'<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"><alignment horizontal="center"/></xf>'
    +'</cellXfs>'
    +'</styleSheet>';

  var wbXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    +'<sheets><sheet name="Sprint Tasks" sheetId="1" r:id="rId1"/></sheets>'
    +'</workbook>';

  var wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    +'<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    +'<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    +'</Relationships>';

  var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    +'<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    +'</Relationships>';

  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    +'<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    +'<Default Extension="xml" ContentType="application/xml"/>'
    +'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    +'<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    +'<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    +'<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    +'</Types>';

  // Build ZIP manually using a minimal ZIP builder
  function crc32(buf) {
    var table = crc32.table || (function(){
      var t = new Uint32Array(256);
      for(var i=0;i<256;i++){var c=i;for(var j=0;j<8;j++)c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c;}
      return crc32.table=t;
    })();
    var crc=0xFFFFFFFF;
    for(var i=0;i<buf.length;i++) crc=table[(crc^buf[i])&0xFF]^(crc>>>8);
    return (crc^0xFFFFFFFF)>>>0;
  }

  function zipEntry(filename, data) {
    var nameBuf  = Buffer.from(filename,'utf8');
    var dataBuf  = Buffer.isBuffer(data)?data:Buffer.from(data,'utf8');
    var crc      = crc32(dataBuf);
    var local    = Buffer.alloc(30+nameBuf.length);
    local.writeUInt32LE(0x04034b50,0);  // sig
    local.writeUInt16LE(20,4);           // version needed
    local.writeUInt16LE(0,6);            // flags
    local.writeUInt16LE(0,8);            // compression (store)
    local.writeUInt16LE(0,10);           // mod time
    local.writeUInt16LE(0,12);           // mod date
    local.writeUInt32LE(crc,14);
    local.writeUInt32LE(dataBuf.length,18);
    local.writeUInt32LE(dataBuf.length,22);
    local.writeUInt16LE(nameBuf.length,26);
    local.writeUInt16LE(0,28);
    nameBuf.copy(local,30);
    return { local:Buffer.concat([local,dataBuf]), crc:crc, size:dataBuf.length, name:nameBuf };
  }

  function buildZip(entries) {
    var parts=[], offset=0, centralDir=[];
    entries.forEach(function(e){
      var {local,crc,size,name}=e;
      centralDir.push({offset:offset,crc:crc,size:size,name:name});
      parts.push(local);
      offset+=local.length;
    });
    var cdStart=offset;
    centralDir.forEach(function(cd){
      var rec=Buffer.alloc(46+cd.name.length);
      rec.writeUInt32LE(0x02014b50,0);
      rec.writeUInt16LE(20,4);rec.writeUInt16LE(20,6);
      rec.writeUInt16LE(0,8);rec.writeUInt16LE(0,10);rec.writeUInt16LE(0,12);
      rec.writeUInt32LE(cd.crc,16);rec.writeUInt32LE(cd.size,20);rec.writeUInt32LE(cd.size,24);
      rec.writeUInt16LE(cd.name.length,28);rec.writeUInt16LE(0,30);rec.writeUInt16LE(0,32);
      rec.writeUInt16LE(0,34);rec.writeUInt16LE(0,36);rec.writeUInt32LE(0,38);
      rec.writeUInt32LE(cd.offset,42);
      cd.name.copy(rec,46);
      parts.push(rec);offset+=rec.length;
    });
    var eocd=Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50,0);eocd.writeUInt16LE(0,4);eocd.writeUInt16LE(0,6);
    eocd.writeUInt16LE(centralDir.length,8);eocd.writeUInt16LE(centralDir.length,10);
    eocd.writeUInt32LE(offset-cdStart,12);eocd.writeUInt32LE(cdStart,16);eocd.writeUInt16LE(0,20);
    parts.push(eocd);
    return Buffer.concat(parts);
  }

  var entries=[
    zipEntry('[Content_Types].xml', contentTypes),
    zipEntry('_rels/.rels', rootRels),
    zipEntry('xl/workbook.xml', wbXml),
    zipEntry('xl/_rels/workbook.xml.rels', wbRels),
    zipEntry('xl/worksheets/sheet1.xml', sheetXml),
    zipEntry('xl/sharedStrings.xml', ssXml),
    zipEntry('xl/styles.xml', stylesXml),
  ];
  return buildZip(entries);
}

// ── ROUTER ────────────────────────────────────────────────────────────────
async function router(req, res) {
  var url = new URL(req.url, 'http://x');
  var M = req.method, P = url.pathname;

  // Static
  if (M==='GET' && !P.startsWith('/api')) {
    if (P==='/'||P==='/index.html') return serveFile(res,path.join(PUB_DIR,'index.html'));
    if (P==='/dashboard')           return serveFile(res,path.join(PUB_DIR,'dashboard.html'));
    if (P==='/admin')               return serveFile(res,path.join(PUB_DIR,'admin.html'));
    return serveFile(res,path.join(PUB_DIR,P.slice(1)));
  }

  // Login
  if (M==='POST' && P==='/api/auth/login') {
    var b=await getBody(req);
    var user=readDB('users').find(function(u){return u.username===(b.username||'').toLowerCase().trim();});
    if(!user||user.pin!==hashPin(String(b.pin||''))) return send(res,401,{error:'Invalid credentials'});
    var sid=genSid(), sessions=readObj('sessions');
    sessions[sid]={userId:user.id,role:user.role,teamId:user.teamId,name:user.name,username:user.username,at:Date.now()};
    writeObj('sessions',sessions);
    res.writeHead(200,{'Set-Cookie':'sid='+sid+'; HttpOnly; Path=/; Max-Age='+86400*7,'Content-Type':'application/json'});
    return res.end(JSON.stringify({role:user.role,name:user.name}));
  }

  // Logout
  if (M==='POST' && P==='/api/auth/logout') {
    var m=(req.headers.cookie||'').match(/sid=([a-f0-9]{64})/);
    if(m){var s2=readObj('sessions');delete s2[m[1]];writeObj('sessions',s2);}
    res.writeHead(200,{'Set-Cookie':'sid=; Max-Age=0; Path=/'});return res.end('{}');
  }

  // Me
  if (M==='GET' && P==='/api/me') {
    var s=getSession(req);if(!s)return send(res,401,{error:'Not logged in'});
    var u=readDB('users').find(function(u){return u.id===s.userId;});
    if(!u)return send(res,401,{error:'Not found'});
    return send(res,200,{id:u.id,name:u.name,username:u.username,role:u.role,teamId:u.teamId});
  }

  // Change PIN
  if (M==='POST' && P==='/api/auth/change-pin') {
    var s=requireAuth(req,res);if(!s)return;
    var b=await getBody(req);
    var users=readDB('users'),idx=users.findIndex(function(u){return u.id===s.userId;});
    if(idx===-1)return send(res,404,{error:'Not found'});
    if(users[idx].pin!==hashPin(String(b.oldPin||'')))return send(res,400,{error:'Wrong current PIN'});
    if(!b.newPin||String(b.newPin).length<4)return send(res,400,{error:'PIN must be 4+ digits'});
    users[idx].pin=hashPin(String(b.newPin));writeDB('users',users);
    return send(res,200,{ok:true});
  }

  // Teams
  if (P==='/api/teams') {
    if(M==='GET'){var s=requireAuth(req,res);if(!s)return;return send(res,200,readDB('teams'));}
    if(M==='POST'){
      var s=requireAdmin(req,res);if(!s)return;
      var b=await getBody(req);if(!b.name)return send(res,400,{error:'Name required'});
      var teams=readDB('teams'),t={id:genId(),name:b.name,color:b.color||'#00928A',createdAt:new Date().toISOString()};
      teams.push(t);writeDB('teams',teams);return send(res,200,t);
    }
  }
  var tm=P.match(/^\/api\/teams\/([^/]+)$/);
  if(tm){
    if(M==='PUT'){var s=requireAdmin(req,res);if(!s)return;var b=await getBody(req);var teams=readDB('teams'),i=teams.findIndex(function(t){return t.id===tm[1];});if(i===-1)return send(res,404,{error:'Not found'});teams[i]=Object.assign({},teams[i],b,{id:teams[i].id});writeDB('teams',teams);return send(res,200,teams[i]);}
    if(M==='DELETE'){var s=requireAdmin(req,res);if(!s)return;writeDB('teams',readDB('teams').filter(function(t){return t.id!==tm[1];}));return send(res,200,{ok:true});}
  }

  // Users
  if(P==='/api/users'){
    if(M==='GET'){
      var s=requireAuth(req,res);if(!s)return;
      var users=readDB('users').map(function(u){return Object.assign({},u,{pin:undefined});});
      return send(res,200,s.role==='admin'?users:users.filter(function(u){return u.teamId===s.teamId;}));
    }
    if(M==='POST'){
      var s=requireAdmin(req,res);if(!s)return;
      var b=await getBody(req);if(!b.username||!b.pin||!b.name)return send(res,400,{error:'username, name, pin required'});
      var users=readDB('users');
      if(users.find(function(u){return u.username===b.username.toLowerCase();}))return send(res,400,{error:'Username taken'});
      var u={id:genId(),username:b.username.toLowerCase().trim(),name:b.name,pin:hashPin(String(b.pin)),role:b.role||'member',teamId:b.teamId||null,createdAt:new Date().toISOString()};
      users.push(u);writeDB('users',users);return send(res,200,Object.assign({},u,{pin:undefined}));
    }
  }
  var um=P.match(/^\/api\/users\/([^/]+)$/);
  if(um){
    if(M==='PUT'){
      var s=requireAdmin(req,res);if(!s)return;
      var b=await getBody(req);var users=readDB('users'),i=users.findIndex(function(u){return u.id===um[1];});
      if(i===-1)return send(res,404,{error:'Not found'});
      if(b.pin)b.pin=hashPin(String(b.pin));
      users[i]=Object.assign({},users[i],b,{id:users[i].id});writeDB('users',users);return send(res,200,Object.assign({},users[i],{pin:undefined}));
    }
    if(M==='DELETE'){
      var s=requireAdmin(req,res);if(!s)return;
      var users=readDB('users'),toDelete=users.find(function(u){return u.id===um[1];});
      if(toDelete&&toDelete.role==='admin')return send(res,400,{error:'Cannot delete admin'});
      writeDB('users',users.filter(function(u){return u.id!==um[1];}));return send(res,200,{ok:true});
    }
  }

  // Tasks
  if(P==='/api/tasks'){
    if(M==='GET'){
      var s=requireAuth(req,res);if(!s)return;
      runAutoArchive();
      var tasks=readDB('tasks');
      if(s.role!=='admin')tasks=tasks.filter(function(t){return t.teamId===s.teamId;});
      var ft=url.searchParams.get('teamId');
      if(s.role==='admin'&&ft)tasks=tasks.filter(function(t){return t.teamId===ft;});
      return send(res,200,tasks);
    }
    if(M==='POST'){
      var s=requireAuth(req,res);if(!s)return;
      var b=await getBody(req);if(!b.desc)return send(res,400,{error:'Description required'});
      var tasks=readDB('tasks');
      var t={id:genId(),teamId:s.role==='admin'?(b.teamId||null):s.teamId,member:b.member||'',role:b.role||'',desc:b.desc,customer:b.customer||'',version:b.version||'—',category:b.category||'',priority:b.priority||'Medium',status:b.status||'To Do',pct:b.pct||'0%',donedate:b.donedate||'',notes:b.notes||'',timeSpend:parseFloat(b.timeSpend)||0,createdBy:s.userId,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
      tasks.push(t);writeDB('tasks',tasks);return send(res,200,t);
    }
  }
  var tkm=P.match(/^\/api\/tasks\/([^/]+)$/);
  if(tkm){
    if(M==='PUT'){
      var s=requireAuth(req,res);if(!s)return;
      var b=await getBody(req);var tasks=readDB('tasks'),i=tasks.findIndex(function(t){return t.id===tkm[1];});
      if(i===-1)return send(res,404,{error:'Not found'});
      if(s.role!=='admin'&&tasks[i].teamId!==s.teamId)return send(res,403,{error:'Forbidden'});
      tasks[i]=Object.assign({},tasks[i],b,{id:tasks[i].id,teamId:tasks[i].teamId,updatedAt:new Date().toISOString()});
      writeDB('tasks',tasks);return send(res,200,tasks[i]);
    }
    if(M==='DELETE'){
      var s=requireAuth(req,res);if(!s)return;
      var tasks=readDB('tasks'),t=tasks.find(function(t){return t.id===tkm[1];});
      if(!t)return send(res,404,{error:'Not found'});
      if(s.role!=='admin'&&t.teamId!==s.teamId)return send(res,403,{error:'Forbidden'});
      writeDB('tasks',tasks.filter(function(t){return t.id!==tkm[1];}));return send(res,200,{ok:true});
    }
  }

  // Duplicate task
  if(M==='POST'&&P.match(/^\/api\/tasks\/([^/]+)\/duplicate$/)){
    var id=P.match(/^\/api\/tasks\/([^/]+)\/duplicate$/)[1];
    var s=requireAuth(req,res);if(!s)return;
    var tasks=readDB('tasks'),t=tasks.find(function(t){return t.id===id;});
    if(!t)return send(res,404,{error:'Not found'});
    if(s.role!=='admin'&&t.teamId!==s.teamId)return send(res,403,{error:'Forbidden'});
    var dup=Object.assign({},t,{id:genId(),status:'To Do',pct:'0%',donedate:'',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()});
    tasks.push(dup);writeDB('tasks',tasks);return send(res,200,dup);
  }

  // Bulk actions
  if(M==='POST'&&P==='/api/tasks/bulk'){
    var s=requireAuth(req,res);if(!s)return;
    var b=await getBody(req);
    var tasks=readDB('tasks');
    var ids=b.ids||[];
    var now=new Date().toISOString();
    tasks=tasks.map(function(t){
      if(ids.indexOf(t.id)===-1)return t;
      if(s.role!=='admin'&&t.teamId!==s.teamId)return t;
      var upd=Object.assign({},t,{updatedAt:now});
      if(b.status)  upd.status=b.status;
      if(b.priority)upd.priority=b.priority;
      if(b.member)  upd.member=b.member;
      if(b.status==='Done'&&!upd.donedate) upd.donedate=toShamsiServer(new Date());
      if(b.status==='Done') upd.pct='100%';
      return upd;
    });
    writeDB('tasks',tasks);return send(res,200,{ok:true,updated:ids.length});
  }

  // Search
  if(M==='GET'&&P==='/api/tasks/search'){
    var s=requireAuth(req,res);if(!s)return;
    var q=(url.searchParams.get('q')||'').toLowerCase().trim();
    if(!q)return send(res,200,[]);
    var tasks=readDB('tasks');
    if(s.role!=='admin')tasks=tasks.filter(function(t){return t.teamId===s.teamId;});
    var results=tasks.filter(function(t){
      return (t.desc||'').toLowerCase().indexOf(q)!==-1||
             (t.customer||'').toLowerCase().indexOf(q)!==-1||
             (t.notes||'').toLowerCase().indexOf(q)!==-1||
             (t.member||'').toLowerCase().indexOf(q)!==-1||
             (t.version||'').toLowerCase().indexOf(q)!==-1;
    });
    return send(res,200,results);
  }

  // Archive
  if(M==='GET'&&P==='/api/archive'){
    var s=requireAuth(req,res);if(!s)return;
    var archive=readDB('archive');
    if(s.role!=='admin')archive=archive.filter(function(t){return t.teamId===s.teamId;});
    return send(res,200,archive);
  }

  // Force-archive (admin)
  if(M==='POST'&&P.match(/^\/api\/tasks\/([^/]+)\/archive$/)){
    var id=P.match(/^\/api\/tasks\/([^/]+)\/archive$/)[1];
    var s=requireAdmin(req,res);if(!s)return;
    var tasks=readDB('tasks'),archive=readDB('archive');
    var t=tasks.find(function(t){return t.id===id;});
    if(!t)return send(res,404,{error:'Not found'});
    t.archivedAt=new Date().toISOString();
    archive.push(t);
    writeDB('tasks',tasks.filter(function(t){return t.id!==id;}));
    writeDB('archive',archive);
    return send(res,200,{ok:true});
  }

  // Manual sprint reset (admin)
  if(M==='POST'&&P==='/api/admin/sprint-reset'){
    var s=requireAdmin(req,res);if(!s)return;
    var tasks=readDB('tasks'),archive=readDB('archive');
    tasks.forEach(function(t){t.archivedAt=new Date().toISOString();t.resetArchived=true;archive.push(t);});
    writeDB('tasks',[]);writeDB('archive',archive);
    var meta=readObj('meta');meta.lastReset=new Date().toISOString().split('T')[0];writeObj('meta',meta);
    return send(res,200,{ok:true,archived:tasks.length});
  }

  // Excel export
  if(M==='GET'&&P==='/api/export/tasks'){
    var s=requireAuth(req,res);if(!s)return;
    var tasks=readDB('tasks');
    if(s.role!=='admin')tasks=tasks.filter(function(t){return t.teamId===s.teamId;});
    var teams=readDB('teams');
    var buf=buildXlsx(tasks,teams);
    var fname='sprint_tasks_'+new Date().toISOString().split('T')[0]+'.xlsx';
    res.writeHead(200,{
      'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition':'attachment; filename="'+fname+'"',
      'Content-Length':buf.length
    });
    return res.end(buf);
  }

  // Comments
  if(P.match(/^\/api\/tasks\/([^/]+)\/comments$/)){
    var taskId=P.match(/^\/api\/tasks\/([^/]+)\/comments$/)[1];
    if(M==='GET'){
      var s=requireAuth(req,res);if(!s)return;
      var comments=readObj('comments');
      return send(res,200,comments[taskId]||[]);
    }
    if(M==='POST'){
      var s=requireAuth(req,res);if(!s)return;
      var b=await getBody(req);if(!b.text||!b.text.trim())return send(res,400,{error:'Text required'});
      var comments=readObj('comments');
      if(!comments[taskId])comments[taskId]=[];
      var c={id:genId(),userId:s.userId,name:s.name,text:b.text.trim(),createdAt:new Date().toISOString()};
      comments[taskId].push(c);writeObj('comments',comments);
      return send(res,200,c);
    }
  }

  // Delete comment
  var cmtDel=P.match(/^\/api\/tasks\/([^/]+)\/comments\/([^/]+)$/);
  if(cmtDel&&M==='DELETE'){
    var s=requireAuth(req,res);if(!s)return;
    var comments=readObj('comments');
    var taskId=cmtDel[1],cmtId=cmtDel[2];
    if(!comments[taskId])return send(res,404,{error:'Not found'});
    comments[taskId]=comments[taskId].filter(function(c){return c.id!==cmtId;});
    writeObj('comments',comments);return send(res,200,{ok:true});
  }

  // Analytics
  if(M==='GET'&&P==='/api/analytics'){
    var s=requireAdmin(req,res);if(!s)return;
    var tasks=readDB('tasks'),teams=readDB('teams'),users=readDB('users'),archive=readDB('archive');
    return send(res,200,{
      totalTasks:tasks.length,totalArchived:archive.length,
      totalUsers:users.filter(function(u){return u.role!=='admin';}).length,
      teams:teams.map(function(team){
        var tt=tasks.filter(function(t){return t.teamId===team.id;});
        return {team:team.name,color:team.color,id:team.id,total:tt.length,
          todo:tt.filter(function(t){return t.status==='To Do';}).length,
          inProgress:tt.filter(function(t){return t.status==='In Progress';}).length,
          done:tt.filter(function(t){return t.status==='Done';}).length,
          critical:tt.filter(function(t){return t.priority==='Critical';}).length};
      })
    });
  }


  // Today hours — accessible to all authenticated users
  if(M==='GET'&&P==='/api/today-hours'){
    var sh=requireAuth(req,res);if(!sh)return;
    var tasksTH=readDB('tasks');
    if(sh.role!=='admin') tasksTH=tasksTH.filter(function(t){return t.teamId===sh.teamId;});
    var todayStr=new Date().toISOString().split('T')[0];
    var memberMap={};
    tasksTH.forEach(function(t){
      if(!t.member||!t.timeSpend) return;
      var updDate=(t.updatedAt||'').split('T')[0];
      if(updDate!==todayStr) return;
      memberMap[t.member]=(memberMap[t.member]||0)+parseFloat(t.timeSpend||0);
    });
    var resultTH=Object.keys(memberMap).map(function(name){
      return {member:name,hours:Math.round(memberMap[name]*100)/100};
    }).sort(function(a,b){return b.hours-a.hours;});
    return send(res,200,{date:todayStr,members:resultTH});
  }

  res.writeHead(404);res.end('Not found');
}

function toShamsiServer(date){
  var g=date||new Date(),gy=g.getFullYear(),gm=g.getMonth()+1,gd=g.getDate();
  var gd_=[31,28,31,30,31,30,31,31,30,31,30,31],jd_=[31,31,31,31,31,31,30,30,30,30,30,29];
  var i,g_d_no,j_d_no,jy,jm,jd,j_np;
  gy-=1600;gm-=1;gd-=1;
  g_d_no=365*gy+Math.floor((gy+3)/4)-Math.floor((gy+99)/100)+Math.floor((gy+399)/400);
  for(i=0;i<gm;i++)g_d_no+=gd_[i];
  if(gm>1&&((gy+1600)%4===0&&((gy+1600)%100!==0||(gy+1600)%400===0)))g_d_no++;
  g_d_no+=gd;j_d_no=g_d_no-79;
  j_np=Math.floor(j_d_no/12053);j_d_no%=12053;
  jy=979+33*j_np+4*Math.floor(j_d_no/1461);j_d_no%=1461;
  if(j_d_no>=366){jy+=Math.floor((j_d_no-1)/365);j_d_no=(j_d_no-1)%365;}
  for(i=0;i<11&&j_d_no>=jd_[i];i++)j_d_no-=jd_[i];
  jm=i+1;jd=j_d_no+1;
  return jy+'/'+(jm<10?'0'+jm:jm)+'/'+(jd<10?'0'+jd:jd);
}

if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});
seed();
http.createServer(async function(req,res){
  try{await router(req,res);}catch(e){console.error(e);if(!res.headersSent)send(res,500,{error:'Server error'});}
}).listen(PORT,function(){console.log('Part Ava Sprint Tracker V4 → http://localhost:'+PORT);});

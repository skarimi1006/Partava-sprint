'use strict';

// XLSX builder — ported from Partava-sprint/server.js
// Adapted to use new SQLite task shape (assigned_name, customer_name, etc.)

function buildXlsx(tasks, teams) {
  var teamMap = {};
  (teams || []).forEach(function(t) { teamMap[t.id] = t.name; });

  var headers = ['#','Team','Assigned To','Role','Task Description','Customer','Version/Model',
                 'Category','Priority','Status','Done Date','% Done','Notes','Created At'];

  function escXml(v) {
    return String(v||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  var rows = tasks.map(function(t, i) {
    return [
      i + 1,
      teamMap[t.team_id] || '—',
      t.assigned_name  || '',
      t.role           || '',
      t.title          || '',
      t.customer_name  || '',
      t.version        || '',
      t.category       || '',
      t.priority       || '',
      t.status         || '',
      t.done_date_shamsi || '',
      t.pct            || '0%',
      t.notes          || '',
      t.created_at ? new Date(t.created_at).toISOString().split('T')[0] : '',
    ];
  });

  var sharedStrings = [];
  var strIndex = {};
  function si(v) {
    var s = String(v);
    if (strIndex[s] === undefined) { strIndex[s] = sharedStrings.length; sharedStrings.push(s); }
    return strIndex[s];
  }

  var colLetters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N'];
  var sheetRows = '';

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
    +'<col min="1" max="1" width="5"/><col min="2" max="2" width="20"/>'
    +'<col min="3" max="3" width="15"/><col min="4" max="4" width="15"/>'
    +'<col min="5" max="5" width="40"/><col min="6" max="6" width="12"/>'
    +'<col min="7" max="7" width="14"/><col min="8" max="8" width="14"/>'
    +'<col min="9" max="9" width="12"/><col min="10" max="10" width="14"/>'
    +'<col min="11" max="11" width="12"/><col min="12" max="12" width="8"/>'
    +'<col min="13" max="13" width="25"/><col min="14" max="14" width="14"/>'
    +'</cols>'
    +'<sheetData>'+sheetRows+'</sheetData></worksheet>';

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
    +'</cellXfs></styleSheet>';

  var wbXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    +'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    +'<sheets><sheet name="Sprint Tasks" sheetId="1" r:id="rId1"/></sheets></workbook>';

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

  function crc32(buf) {
    var table = crc32.table || (function(){
      var t = new Uint32Array(256);
      for(var i=0;i<256;i++){var c=i;for(var j=0;j<8;j++)c=c&1?(0xEDB88320^(c>>>1)):(c>>>1);t[i]=c;}
      return (crc32.table=t);
    })();
    var crc=0xFFFFFFFF;
    for(var i=0;i<buf.length;i++) crc=table[(crc^buf[i])&0xFF]^(crc>>>8);
    return (crc^0xFFFFFFFF)>>>0;
  }

  function zipEntry(filename, data) {
    var nameBuf = Buffer.from(filename,'utf8');
    var dataBuf = Buffer.isBuffer(data) ? data : Buffer.from(data,'utf8');
    var crc     = crc32(dataBuf);
    var local   = Buffer.alloc(30+nameBuf.length);
    local.writeUInt32LE(0x04034b50,0); local.writeUInt16LE(20,4); local.writeUInt16LE(0,6);
    local.writeUInt16LE(0,8); local.writeUInt16LE(0,10); local.writeUInt16LE(0,12);
    local.writeUInt32LE(crc,14); local.writeUInt32LE(dataBuf.length,18); local.writeUInt32LE(dataBuf.length,22);
    local.writeUInt16LE(nameBuf.length,26); local.writeUInt16LE(0,28);
    nameBuf.copy(local,30);
    return { local: Buffer.concat([local,dataBuf]), crc, size: dataBuf.length, name: nameBuf };
  }

  function buildZip(entries) {
    var parts=[],offset=0,centralDir=[];
    entries.forEach(function(e){
      var {local,crc,size,name}=e;
      centralDir.push({offset,crc,size,name});
      parts.push(local); offset+=local.length;
    });
    var cdStart=offset;
    centralDir.forEach(function(cd){
      var rec=Buffer.alloc(46+cd.name.length);
      rec.writeUInt32LE(0x02014b50,0); rec.writeUInt16LE(20,4); rec.writeUInt16LE(20,6);
      rec.writeUInt16LE(0,8); rec.writeUInt16LE(0,10); rec.writeUInt16LE(0,12);
      rec.writeUInt32LE(cd.crc,16); rec.writeUInt32LE(cd.size,20); rec.writeUInt32LE(cd.size,24);
      rec.writeUInt16LE(cd.name.length,28); rec.writeUInt16LE(0,30); rec.writeUInt16LE(0,32);
      rec.writeUInt16LE(0,34); rec.writeUInt16LE(0,36); rec.writeUInt32LE(0,38);
      rec.writeUInt32LE(cd.offset,42); cd.name.copy(rec,46);
      parts.push(rec); offset+=rec.length;
    });
    var eocd=Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50,0); eocd.writeUInt16LE(0,4); eocd.writeUInt16LE(0,6);
    eocd.writeUInt16LE(centralDir.length,8); eocd.writeUInt16LE(centralDir.length,10);
    eocd.writeUInt32LE(offset-cdStart,12); eocd.writeUInt32LE(cdStart,16); eocd.writeUInt16LE(0,20);
    parts.push(eocd);
    return Buffer.concat(parts);
  }

  return buildZip([
    zipEntry('[Content_Types].xml',          contentTypes),
    zipEntry('_rels/.rels',                  rootRels),
    zipEntry('xl/workbook.xml',              wbXml),
    zipEntry('xl/_rels/workbook.xml.rels',   wbRels),
    zipEntry('xl/worksheets/sheet1.xml',     sheetXml),
    zipEntry('xl/sharedStrings.xml',         ssXml),
    zipEntry('xl/styles.xml',                stylesXml),
  ]);
}

module.exports = { buildXlsx };

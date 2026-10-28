'use strict';
// Pure browser/Node-compatible helpers. No dependencies and no server.
(function(root){
  const PRESETS = {
    luftbild:{label:'Luftbild',layers:['ch.swisstopo.swissimage'],opaque:true},
    gewaesser:{label:'Gewässer (präzise)',layers:['ch.swisstopo.swisstlm3d-gewaessernetz']},
    verkehr:{label:'Verkehrswege',layers:['ch.swisstopo.swisstlm3d-strassen','ch.swisstopo.swisstlm3d-eisenbahnnetz','ch.swisstopo.swisstlm3d-uebrigerverkehr']},
    gemeinden:{label:'Gemeindegrenzen',layers:['ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill']},
    siedlungen:{label:'Siedlungsflächen',layers:['ch.are.siedlung']},
    orte:{label:'Ortschaften',layers:['ch.swisstopo.vec200-names-namedlocation']},
    bauten:{label:'Bauten',layers:['ch.swisstopo.vec25-gebaeude','ch.swisstopo.vec25-anlagen','ch.swisstopo.vec25-einzelobjekte']},
    uebersicht:{label:'Landeskarte',layers:['ch.swisstopo.swisstlm3d-karte-farbe'],opaque:true},
    wald:{label:'Wald',layers:['ch.swisstopo.swisstlm3d-wald']},
    historisch:{label:'Historische Karte (Zeitreise)',layers:['ch.swisstopo.zeitreihen'],opaque:true}
  };
  // Quoted CSV fields, CRLF, embedded separators, escaped double quotes.
  function csvRows(text, delimiter){
    const rows=[];let row=[],cell='',q=false;
    for(let i=0;i<text.length;i++){
      const ch=text[i];
      if(ch==='"'){if(q&&text[i+1]==='"'){cell+='"';i++;}else q=!q;}
      else if(ch===delimiter&&!q){row.push(cell);cell='';}
      else if((ch==='\n'||ch==='\r')&&!q){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()!==''))rows.push(row);row=[];cell='';}
      else cell+=ch;
    }
    if(q)throw Error('CSV enthält ein nicht geschlossenes Anführungszeichen.');
    row.push(cell);if(row.some(v=>v.trim()!==''))rows.push(row);
    return rows;
  }
  function parseLayoutCsv(input){
    if(typeof input!=='string'||!input.trim())throw Error('Bitte eine nichtleere layout.csv wählen.');
    if(input.length>256000)throw Error('layout.csv ist zu gross (maximal 256 KB).');
    const text=input.replace(/^\uFEFF/,'');
    const header=text.split(/\r?\n/,1)[0];
    const delimiter=(header.match(/;/g)||[]).length>=(header.match(/,/g)||[]).length?';':',';
    const data=csvRows(text,delimiter);
    const cols=data.shift()?.map(s=>s.trim())||[];
    const req=['row','col','filename','width_mm','depth_mm','minX_LV95','maxX_LV95','minY_LV95','maxY_LV95'];
    const absent=req.filter(s=>!cols.includes(s));
    if(absent.length)throw Error('CSV-Spalten fehlen: '+absent.join(', '));
    const cells=new Map();let rows=0,columns=0;
    function number(obj,key,line){const s=(obj[key]||'').trim();if(!s||!Number.isFinite(Number(s)))throw Error(`Ungültige Zahl ${key} in CSV-Zeile ${line}.`);return Number(s);}
    data.forEach((arr,index)=>{
      const o=Object.fromEntries(cols.map((key,i)=>[key,arr[i]??'']));const line=index+2;
      const row=number(o,'row',line),col=number(o,'col',line);
      const width=number(o,'width_mm',line),depth=number(o,'depth_mm',line);
      const west=number(o,'minX_LV95',line),east=number(o,'maxX_LV95',line);
      const south=number(o,'minY_LV95',line),north=number(o,'maxY_LV95',line);
      if(!Number.isInteger(row)||!Number.isInteger(col)||row<1||col<1||row>1000||col>1000)throw Error(`Ungültige Rasterposition in Zeile ${line}.`);
      if(width<=0||depth<=0||east<=west||north<=south)throw Error(`Ungültige Segmentabmessung in Zeile ${line}.`);
      const key=`${row}:${col}`;if(cells.has(key))throw Error(`Doppelte Position R${row}/C${col}.`);
      cells.set(key,{row,col,width,depth,west,east,south,north});rows=Math.max(rows,row);columns=Math.max(columns,col);
      if(cells.size>500)throw Error('Maximal 500 Segmente erlaubt.');
    });
    if(!cells.size)throw Error('CSV enthält keine Segmente.');
    const get=(r,c)=>cells.get(`${r}:${c}`);
    if(cells.size!==rows*columns)throw Error('Segmentraster ist unvollständig.');
    for(let r=1;r<=rows;r++)for(let c=1;c<=columns;c++)if(!get(r,c))throw Error(`Segment R${r}/C${c} fehlt.`);
    const close=(a,b,tol)=>Math.abs(a-b)<=tol;
    for(let r=1;r<=rows;r++)for(let c=1;c<=columns;c++){
      const v=get(r,c),rr=get(r,1),cc=get(1,c);
      if(!close(v.south,rr.south,.025)||!close(v.north,rr.north,.025)||!close(v.depth,rr.depth,.05))throw Error(`Uneinheitliche Reihendaten R${r}.`);
      if(!close(v.west,cc.west,.025)||!close(v.east,cc.east,.025)||!close(v.width,cc.width,.05))throw Error(`Uneinheitliche Spaltendaten C${c}.`);
      if(c>1&&!close(v.west,get(r,c-1).east,.025))throw Error(`Lücke/Überlappung bei R${r}/C${c}.`);
      if(r>1&&!close(v.north,get(r-1,c).south,.025))throw Error(`Lücke/Überlappung bei R${r}/C${c}.`);
    }
    const west=get(1,1).west,east=get(1,columns).east,south=get(rows,1).south,north=get(1,1).north;
    if(west<2400000||east>2900000||south<1000000||north>1350000)throw Error('LV95-Koordinaten ausserhalb des plausiblen Schweizer Bereichs.');
    const modelWidth=Array.from({length:columns},(_,i)=>get(1,i+1).width).reduce((a,b)=>a+b,0);
    const modelDepth=Array.from({length:rows},(_,i)=>get(i+1,1).depth).reduce((a,b)=>a+b,0);
    if(Math.abs(((east-west)/(north-south))/(modelWidth/modelDepth)-1)>.02)throw Error('Seitenverhältnis von LV95 und Reliefmassen weicht um über 2 % ab.');
    return {schema:'grossrelief-layout-v1',epsg:2056,bbox_lv95:[west,south,east,north],
      model_width_mm:Math.round(modelWidth*1000)/1000,model_depth_mm:Math.round(modelDepth*1000)/1000,
      rows,columns,segments:cells.size,geo_width_m:Math.round((east-west)*1000)/1000,
      geo_depth_m:Math.round((north-south)*1000)/1000,orientation:'Nord oben; Reihe 1 Nord, Spalte 1 West'};
  }
  function dimensions(layout,maxLong){
    const rw=layout.geo_width_m,rh=layout.geo_depth_m;
    if(!Number.isFinite(maxLong)||maxLong<100||maxLong>4096)throw Error('Ungültige Auflösung.');
    const scale=maxLong/Math.max(rw,rh);
    const w=Math.max(1,Math.round(rw*scale)),h=Math.max(1,Math.round(rh*scale));
    if(w*h>16000000)throw Error('Bildgrösse überschreitet 16 Millionen Pixel.');
    return [w,h];
  }
  function tiles(layout,width,height,tileSize=1024){
    const [west,south,east,north]=layout.bbox_lv95;
    const out=[];
    for(let y=0;y<height;y+=tileSize)for(let x=0;x<width;x+=tileSize){
      const w=Math.min(tileSize,width-x),h=Math.min(tileSize,height-y);
      out.push({x,y,w,h,bbox:[west+(x/width)*(east-west),north-((y+h)/height)*(north-south),west+((x+w)/width)*(east-west),north-(y/height)*(north-south)]});
    }
    return out;
  }
  function wmsUrl(id,tile, options={}){
    if(id==='gewaesser'||id==='gewaesser_alle')throw Error('Gewässer nur aus der expliziten amtlichen Positivliste, niemals per ungefiltertem WMS.');
    if(!Object.hasOwn(PRESETS,id))throw Error('Unbekannte Kartenebene: '+id);
    const layer=PRESETS[id];const p=new URLSearchParams({SERVICE:'WMS',REQUEST:'GetMap',VERSION:'1.3.0',
      LAYERS:layer.layers.join(','),STYLES:'',CRS:'EPSG:2056',BBOX:tile.bbox.map(n=>n.toFixed(5)).join(','),
      WIDTH:String(tile.w),HEIGHT:String(tile.h),FORMAT:'image/png',TRANSPARENT:layer.opaque?'FALSE':'TRUE',LANG:'de'});
    if(id==='historisch'){
      const y=Number(options.year);
      if(!Number.isInteger(y)||y<1844||y>2026)throw Error('Historisches Jahr muss zwischen 1844 und 2026 liegen.');
      p.set('TIME',`${y}-12-31`);
    }
    return 'https://wms.geo.admin.ch/?'+p.toString();
  }
  function solve8(rows,vector){
    const a=rows.map((r,i)=>[...r,vector[i]]);
    for(let k=0;k<8;k++){
      let p=k;for(let i=k+1;i<8;i++)if(Math.abs(a[i][k])>Math.abs(a[p][k]))p=i;
      if(Math.abs(a[p][k])<1e-11)throw Error('Die vier Ecken ergeben kein gültiges Viereck.');
      [a[k],a[p]]=[a[p],a[k]];
      const s=a[k][k];for(let j=k;j<=8;j++)a[k][j]/=s;
      for(let i=0;i<8;i++)if(i!==k){const d=a[i][k];for(let j=k;j<=8;j++)a[i][j]-=d*a[k][j];}
    }
    return a.map(v=>v[8]);
  }
  function homography(corners){
    const from=[[0,0],[1,0],[1,1],[0,1]],a=[],b=[];
    for(let i=0;i<4;i++){
      const [x,y]=from[i],{x:u,y:v}=corners[i];
      a.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);
      a.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);
    }
    return [...solve8(a,b),1];
  }
  function cssPerspective(corners,sw,sh,vw,vh){
    const H=homography(corners);
    const [a,b,c,d,e,f,g,h]=H;
    const A=vw*a/sw,B=vw*b/sh,C=vw*c,D=vh*d/sw,E=vh*e/sh,F=vh*f,G=g/sw,I=h/sh;
    return `matrix3d(${[A,D,0,G,B,E,0,I,0,0,1,0,C,F,0,1].map(v=>Number(v.toPrecision(14))).join(',')})`;
  }
  // The physical projector is landscape. Rotate the source map 90 degrees
  // clockwise *together with the height geometry*, before four-corner calibration.
  // Source (u,v) is north-up; projector landscape (qX,qY)=(1-v,u).
  // Corners are the LANDSCAPE rectangle: TL, TR, BR, BL.
  function cssPerspectiveLandscape(corners,sw,sh,vw,vh){
    const [a,b,c,d,e,f,g,h]=homography(corners);
    // Homography H composed with clockwise rotation matrix:
    // [ 0 -1 1 ]
    // [ 1  0 0 ]
    // [ 0  0 1 ]
    const A=vw*b/sw, B=-vw*a/sh, C=vw*(a+c);
    const D=vh*e/sw, E=-vh*d/sh, F=vh*(d+f);
    const G=h/sw, I=-g/sh, J=1+g;
    return `matrix3d(${[A,D,0,G,B,E,0,I,0,0,1,0,C,F,0,J].map(v=>Number(v.toPrecision(14))).join(',')})`;
  }
  function crc32(bytes){
    let crc=0xffffffff;
    for(const x of bytes){crc^=x;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0);}
    return (crc^0xffffffff)>>>0;
  }
  // ZIP format, STORE (no compression; PNG is compressed already).
  function storeZip(files){
    const enc=new TextEncoder(),out=[],central=[];let offset=0;
    function header(n){return new Uint8Array(n);}
    function write16(v,n,x){v[n]=x&255;v[n+1]=(x>>>8)&255;}
    function write32(v,n,x){write16(v,n,x);write16(v,n+2,x>>>16);}
    function push(bytes){out.push(bytes);offset+=bytes.length;}
    for(const item of files){
      const name=enc.encode(item.name),bytes=item.data instanceof Uint8Array?item.data:enc.encode(item.data);
      const crc=crc32(bytes),at=offset;
      const local=header(30);write32(local,0,0x04034b50);write16(local,4,20);write16(local,6,0x0800);write16(local,8,0);
      write32(local,14,crc);write32(local,18,bytes.length);write32(local,22,bytes.length);write16(local,26,name.length);
      push(local);push(name);push(bytes);
      const cd=header(46);write32(cd,0,0x02014b50);write16(cd,4,20);write16(cd,6,20);write16(cd,8,0x0800);
      write32(cd,16,crc);write32(cd,20,bytes.length);write32(cd,24,bytes.length);write16(cd,28,name.length);write32(cd,42,at);
      central.push(cd,name);
    }
    const centralStart=offset;
    for(const b of central)push(b);
    const end=header(22);write32(end,0,0x06054b50);write16(end,8,files.length);write16(end,10,files.length);
    write32(end,12,offset-centralStart);write32(end,16,centralStart);push(end);
    return new Blob(out,{type:'application/zip'});
  }
  function whiteReliefBackground(ids){
    return !ids.includes('luftbild') && !ids.includes('uebersicht') && !ids.includes('historisch');
  }
  // Render a municipality Polygon/MultiPolygon as an objectBoundingBox SVG clipping path.
  // LV95 coordinates are transformed to north-up normalised image coordinates.
  function geojsonClipPath(geometry,bbox){
    if(!geometry || !['Polygon','MultiPolygon'].includes(geometry.type))throw Error('Gemeindegrenze hat kein Polygonformat.');
    const [west,south,east,north]=bbox;
    const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates;
    let count=0;
    const commands=[];
    for(const poly of polygons){
      for(const ring of poly){
        if(!Array.isArray(ring)||ring.length<4)continue;
        const path=ring.map((point,i)=>{
          if(!Array.isArray(point)||!Number.isFinite(point[0])||!Number.isFinite(point[1]))throw Error('Ungültige LV95-Grenzkoordinate.');
          const x=(point[0]-west)/(east-west), y=(north-point[1])/(north-south);
          return `${i===0?'M':'L'}${x.toFixed(7)} ${y.toFixed(7)}`;
        }).join(' ')+' Z';
        commands.push(path);count++;
      }
    }
    if(!count)throw Error('Die Gemeindegrenze ist leer.');
    return commands.join(' ');
  }
  const exported={version:'5.10',PRESETS,parseLayoutCsv,dimensions,tiles,wmsUrl,homography,cssPerspective,cssPerspectiveLandscape,crc32,storeZip,whiteReliefBackground,geojsonClipPath};
  root.GrossreliefCore=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof globalThis!=='undefined'?globalThis:this);

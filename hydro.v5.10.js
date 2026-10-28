'use strict';
/* Open data of Canton Zurich (GIS-ZH 45). Geometry always comes from official
   LV95 GeoJSON. Rivers / lakes are never sketched, interpolated or guessed. */
(function(root){
  const VERSION='5.10';
  const SOURCE='https://maps.zh.ch/wfs/OGDZHWFS';
  const STREAM_CATALOG=[
    {name:'Zopfbach',aliases:['Zopfbach']},
    {name:'Gulmenbach',aliases:['Gulmenbach']},
    {name:'Töbelibach',aliases:['Töbelibach','Toebelibach']},
    {name:'Untermosenbach',aliases:['Untermosenbach']},
    {name:'Reidbach/Wildbach',aliases:['Reidbach','Riedbach','Wildbach']},
    {name:'Teufenbach',aliases:['Teufenbach']},
    {name:'Sihl',aliases:['Sihl']},
    {name:'Krebsbach',aliases:['Krebsbach']}, // NOT Chrebsbach!
    {name:'Schlossbach',aliases:['Schlossbach']},
    {name:'Sagenbach',aliases:['Sagenbach','Hüttener Sagenbach','Huettener Sagenbach']},
    {name:'Miesbach',aliases:['Miesbach']},
    // Previously supported named watercourses stay available.
    {name:'Aabach',aliases:['Aabach']},
    {name:'Meilibach',aliases:['Meilibach']},
    // Richterswil, Gewaessernummer laut amtlichem Gewaesserraumplan: 2512.
    {name:'Mülibach Richterswil',aliases:['Mülibach','Muelibach','Mühlibach','Muehlibach','Mülibach Richterswil'],ids:['2512']}
  ];
  const POND_CATALOG=[
    {name:'Sternenweiher',aliases:['Sternenweiher','Sternenweier']},
    {name:'Reidbachweiher',aliases:['Reidbachweiher','Riedbachweiher']},
    {name:'Teufenbachweiher',aliases:['Teufenbachweiher','Teufenbachweier']},
    {name:'Aabachweiher',aliases:['Aabachweiher','Aabachweier']}
  ];
  // Vier ausschliesslich vom Nutzer genannte Weiher aus dem 51.1-Datensatz, kein weiterer.
  const NEW_PONDS=new Set(['Teufenbachweiher','Aabachweiher','Sternenweiher','Reidbachweiher']);
  const LAKE_ALIASES={'Zürichsee':['Zürichsee','Zuerichsee','Zurichsee'],'Hüttenersee':['Hüttenersee','Hüttnersee'],'Ausee':['Ausee']};
  const ALLOWED_STREAMS=new Set(STREAM_CATALOG.map(item=>item.name));
  const ALLOWED_PONDS=new Set(POND_CATALOG.map(item=>item.name));
  const ALLOWED_WATERBODIES=new Set(['Zürichsee','Hüttenersee','Ausee',...ALLOWED_PONDS]);
  const DESIRED=STREAM_CATALOG.slice(0,4).map(x=>x.name);
  const OTHER=STREAM_CATALOG.slice(4).map(x=>x.name);
  const clean=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const nameKeys=['gewaessername','gewname','name','name_de','bezeichnung','objektname','gewassername'];
  const idKeys=['gewaessernummer','gewaesser_nr','gewaessernr','gewaessernummer_aktuell','gewaesserid','gwnr'];
  function lookup(p,keys){
    const values=[];
    for(const [key,value] of Object.entries(p||{})){
      if(keys.some(w=>clean(key)===clean(w)) && value!==null && value!==undefined)values.push(value);
    }
    return values;
  }
  function names(f){return lookup(f?.properties,nameKeys).filter(v=>typeof v==='string'&&v.trim());}
  function canonicalId(f){
    const values=lookup(f?.properties,idKeys);
    for(const raw of values){const n=Number(String(raw).replace(',','.'));if(Number.isFinite(n)&&n>0)return String(n);}
    return null;
  }
  function classify(f,catalog){
    for(const raw of names(f)){
      const parts=raw.split(/[,;/]|\s+\(.*?\)\s*/).map(clean).filter(Boolean);
      for(const item of catalog){
        if(item.aliases.some(a=>parts.includes(clean(a))))return item.name;
      }
    }
    return null;
  }
  function nameFor(f){
    const id=canonicalId(f);
    // Unter verschiedenen lokalen Schreibungen derselbe amtliche Bach,
    // aber keine anderen Muelibaeche ausserhalb von Richterswil hinzunehmen.
    if(id==='2512')return 'Mülibach Richterswil';
    const match=classify(f,STREAM_CATALOG);
    if(match==='Mülibach Richterswil' && id!=='2512')return null;
    return match;
  }
  function pondNameFor(f){return classify(f,POND_CATALOG);}
  function lakeNameFor(f){
    for(const v of names(f)){
      const k=clean(v);
      for(const [label,aliases] of Object.entries(LAKE_ALIASES)){
        if(aliases.some(s=>clean(s)===k))return label;
      }
    }
    return null;
  }
  function layerTypes(xml){
    // Explicit 45.x layer names; substring searches previously confused 45.1
    // WB_FLIESSGEWAESSER_L with 45.2 WB_FLIESSGEWAESSER_L_M.
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw Error('WFS GetCapabilities liefert kein gültiges XML.');
    const found=[];
    for(const node of doc.getElementsByTagName('*')){
      if(node.localName!=='FeatureType')continue;
      for(const child of node.children){if(child.localName==='Name'){found.push(child.textContent.trim());break;}}
    }
    if(!found.length)throw Error('Der kantonale WFS nennt keine FeatureTypes.');
    // Der reale OGD-ZH-WFS verwendet Namen der Form
    // ms:ogd-0045_giszhpub_wb_gewaesserbezeichnung_l statt bloss WB_... .
    // Exaktes Tabellenende: 45.1 (_L) darf NICHT mit 45.2 (_L_M) verwechselt werden.
    const exact=table=>{
      const tail=clean('giszhpub_'+table);
      return found.find(s=>clean(s.split(':').at(-1)).endsWith(tail))||null;
    };
    return {
      lakes:exact('WB_STEHGEWAESSER_F'),          // 45.10: lake/pond filled geometries
      pondRights:exact('WB_WASSERRECHTE_F'),     // GIS-ZH 51.1: Wasserrechtsweiher (nur Positivliste)
      shore:exact('WB_ZUERICHSEEUFER_L')||exact('WB_ZUERICHSEE_L')||found.find(s=>/zuerichsee.*(ufer|linie)/.test(clean(s)))||null, // 45.13
      streams:exact('WB_GEWAESSERBEZEICHNUNG_L'), // 45.3: naming events
      streamAxes:exact('WB_FLIESSGEWAESSER_L_M'), // 45.2: connected stream routes
      available:found.length
    };
  }
  function firstCoord(g){
    return g.type==='Polygon'?g.coordinates?.[0]?.[0]:g.type==='MultiPolygon'?g.coordinates?.[0]?.[0]?.[0]:g.type==='MultiLineString'?g.coordinates?.[0]?.[0]:g.coordinates?.[0];
  }
  function validLV95(g){
    if(!g||!['Polygon','MultiPolygon','LineString','MultiLineString'].includes(g.type))return false;
    const p=firstCoord(g);return Array.isArray(p)&&p.length>=2&&Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[0]>2e6&&p[0]<3.1e6&&p[1]>700000&&p[1]<1.5e6;
  }
  function empty(){return {lakes:[],shores:[],pondShore:[],streams:[],streamAxes:[],found:[],pondsFound:[],totalFeatures:0};}
  function fromGeojson(json,role){
    const features=json?.type==='FeatureCollection'?json.features:json?.type==='Feature'?[json]:Array.isArray(json?.features)?json.features:[];
    if(!Array.isArray(features))throw Error('Ungültiges GeoJSON.');
    const result=empty();result.totalFeatures=features.length;
    for(const f of features){
      const g=f?.geometry;if(!validLV95(g))continue;
      if(g.type==='Polygon'||g.type==='MultiPolygon'){
        const pond=pondNameFor(f);
        // 45.16 contains *all* legally designated water bodies including stream
        // polygons. Accept only the three explicitly requested ponds as extras.
        const approvedName=pond||lakeNameFor(f);
        if((!role||role==='lakes')&&approvedName&&ALLOWED_WATERBODIES.has(approvedName))result.lakes.push({geometry:g,name:approvedName,id:canonicalId(f),source:'45.10'});
        if(role==='pondRights'&&pond&&NEW_PONDS.has(pond))result.lakes.push({geometry:g,name:pond,id:canonicalId(f),source:'51.1'});

      }else if(g.type==='LineString'||g.type==='MultiLineString'){
        if(role==='shore'){
          if(!names(f).length || lakeNameFor(f)==='Zürichsee')result.shores.push(g);
          continue;
        }
        if(role==='pondShore'||(!role&&pondNameFor(f))){
          const name=pondNameFor(f);
          if(name)result.pondShore.push({geometry:g,name,id:canonicalId(f),source:role==='pondShore'?'45.11':'geojson'});
          continue;
        }
        if(!role && names(f).some(n=>clean(n)==='zurichsee'||clean(n)==='zuerichsee')){
          result.shores.push(g);continue;
        }
        if(role==='streamAxes'){
          result.streamAxes.push({geometry:g,id:canonicalId(f),name:nameFor(f)});continue;
        }
        // 45.1 = actual public watercourse axes already carrying the names.
        // 45.3 = potentially incomplete text-labelled sections.
        const name=nameFor(f);
        if(name)result.streams.push({name,geometry:g,id:canonicalId(f),source:role==='publicStreams'?'45.1':'45.3'});
      }
    }
    result.found=STREAM_CATALOG.filter(x=>result.streams.some(s=>s.name===x.name)).map(x=>x.name);
    result.pondsFound=POND_CATALOG.filter(x=>result.lakes.some(l=>l.name===x.name)||result.pondShore.some(l=>l.name===x.name)).map(x=>x.name);
    return result;
  }
  // SICHERHEITSGRENZE: Bachachsen enden an amtlich benannten See-/Weiherflächen.
  // Keine Linien auf/quer durch Zürichsee, Hüttenersee, Ausee oder die drei
  // ausgewählten Weiher. Die Roh-Geometrie wird NICHT neu gezeichnet/verlängert:
  // wir behalten ausschliesslich die vorhandenen Teilstrecken an Land.
  // Dieselbe gekürzte Geometrie wird sowohl als SVG als auch PNG verwendet.
  function equalPoint(a,b,epsilon=0.000001){
    return Math.abs(a[0]-b[0])<=epsilon&&Math.abs(a[1]-b[1])<=epsilon;
  }
  function ringEnvelope(points){
    let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;
    for(const p of points){if(!p||!Number.isFinite(p[0])||!Number.isFinite(p[1]))continue;
      xmin=Math.min(xmin,p[0]);ymin=Math.min(ymin,p[1]);xmax=Math.max(xmax,p[0]);ymax=Math.max(ymax,p[1]);}
    return [xmin,ymin,xmax,ymax];
  }
  function bboxOverlaps(a,b){return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];}
  function pointOnSegment(p,a,b,tol=0.000001){
    const dx=b[0]-a[0],dy=b[1]-a[1], qx=p[0]-a[0], qy=p[1]-a[1];
    const sq=dx*dx+dy*dy;
    if(!sq)return Math.hypot(qx,qy)<=tol;
    const t=(qx*dx+qy*dy)/sq;
    if(t<0||t>1)return false;
    return Math.hypot(qx-t*dx,qy-t*dy)<=tol;
  }
  function insideRing(p,points){
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[j],b=points[i];
      if(pointOnSegment(p,a,b))return true;
      if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }
    return inside;
  }
  function waterPolygons(lakes){
    const out=[];
    for(const item of lakes||[]){
      if(!ALLOWED_WATERBODIES.has(item.name))continue;
      const g=geomOf(item);
      if(!g||!['Polygon','MultiPolygon'].includes(g.type))continue;
      const polys=g.type==='Polygon'?[g.coordinates]:g.coordinates;
      for(const poly of polys){
        const rings=poly.filter(r=>Array.isArray(r)&&r.length>=4).map(r=>r.map(p=>[p[0],p[1]]));
        if(!rings.length)continue;
        out.push({rings,bbox:ringEnvelope(rings[0]),edges:rings.flatMap(ring=>{
          const edges=[];
          for(let i=0;i<ring.length;i++){
            const a=ring[i],b=ring[(i+1)%ring.length];
            if(equalPoint(a,b))continue;
            edges.push({a,b,bbox:[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])]});
          }
          return edges;
        })});
      }
    }
    return out;
  }
  function pointInWater(point,polygons){
    return polygons.some(poly=>{
      const box=poly.bbox;
      if(point[0]<box[0]||point[0]>box[2]||point[1]<box[1]||point[1]>box[3])return false;
      // An der Wassergrenze gilt der Punkt als Landabschluss. Innere Ringe sind Löcher.
      if(!insideRing(point,poly.rings[0]))return false;
      return !poly.rings.slice(1).some(r=>insideRing(point,r));
    });
  }
  function crossingParameter(a,b,c,d){
    const rx=b[0]-a[0], ry=b[1]-a[1], sx=d[0]-c[0], sy=d[1]-c[1];
    const den=rx*sy-ry*sx;
    if(Math.abs(den)<1e-10)return null; // parallel/kongruent; no invented connector
    const qx=c[0]-a[0], qy=c[1]-a[1];
    const t=(qx*sy-qy*sx)/den,u=(qx*ry-qy*rx)/den;
    return t>=0&&t<=1&&u>=0&&u<=1?t:null;
  }
  function cutLineOutsideWater(coords,polygons){
    if(coords.length<2||!polygons.length)return [coords];
    const parts=[];let current=[];
    function flush(){if(current.length>=2&&current.some(p=>!equalPoint(p,current[0])))parts.push(current);current=[];}
    function append(a,b){
      if(equalPoint(a,b))return;
      if(current.length&&!equalPoint(current.at(-1),a))flush();
      if(!current.length)current.push(a);
      current.push(b);
    }
    for(let i=1;i<coords.length;i++){
      const a=coords[i-1],b=coords[i],segmentBox=[Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.max(a[0],b[0]),Math.max(a[1],b[1])];
      const candidates=polygons.filter(poly=>bboxOverlaps(segmentBox,poly.bbox));
      if(!candidates.length){append(a,b);continue;}
      const ts=[0,1];
      for(const poly of candidates)for(const edge of poly.edges){
        if(!bboxOverlaps(segmentBox,edge.bbox))continue;
        const t=crossingParameter(a,b,edge.a,edge.b);
        if(t!==null)ts.push(t);
      }
      ts.sort((x,y)=>x-y);
      const unique=[];for(const t of ts)if(!unique.length||Math.abs(t-unique.at(-1))>1e-9)unique.push(t);
      function lerp(t){return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];}
      for(let j=1;j<unique.length;j++){
        const t0=unique[j-1],t1=unique[j];if(t1-t0<1e-9)continue;
        if(pointInWater(lerp((t0+t1)/2),candidates))flush();
        else append(lerp(t0),lerp(t1));
      }
    }
    flush();return parts;
  }
  function trimStreamGeometry(geom,polygons){
    if(!polygons.length)return geom;
    const lines=geom.type==='LineString'?[geom.coordinates]:geom.type==='MultiLineString'?geom.coordinates:[];
    const kept=[];
    for(const line of lines){kept.push(...cutLineOutsideWater(line,polygons));}
    if(!kept.length)return null;
    if(kept.length===1)return {type:'LineString',coordinates:kept[0]};
    return {type:'MultiLineString',coordinates:kept};
  }
  function trimStreamsAtWater(data){
    const polygons=waterPolygons(data.lakes);
    let trimmed=0;
    data.streams=data.streams.flatMap(item=>{
      const geom=trimStreamGeometry(item.geometry,polygons);
      if(!geom){trimmed++;return [];}
      if(JSON.stringify(geom)!==JSON.stringify(item.geometry))trimmed++;
      return [{...item,geometry:geom}];
    });
    data.lakeClippedStreamPieces=trimmed;
    return data;
  }
  // 45.3 liefert haeufig nur Abschnitte der Namensbezeichnung (Events).
  // 45.2 enthaelt die vollstaendigen Gewaesserachsen. Die offizielle
  // Gewaessernummer ist der einzige zulaessige Join-Schluessel.
  // Keine direkte Punkt-zu-Punkt-Verbindung und KEINE ungepruefte
  // Nachbarschafts- oder Aehnlichkeitssuche entlang fremder Baeche.
  function combine(parts){
    const out=empty(), seen={lakes:new Set(),shores:new Set(),pondShore:new Set(),streams:new Set(),streamAxes:new Set()};
    for(const data of parts){
      if(!data)continue;
      out.totalFeatures+=data.totalFeatures||0;
      for(const key of Object.keys(seen))for(const item of data[key]||[]){
        const geom=key==='shores'?item:item.geometry;
        if(!geom?.coordinates)continue;
        const identity=JSON.stringify([key==='streams'?item.name:'',key==='lakes'||key==='pondShore'?item.name:'',key==='streamAxes'?item.id:'',geom.coordinates]);
        if(seen[key].has(identity))continue;
        seen[key].add(identity);out[key].push(item);
      }
    }
    const namesById=new Map();
    for(const item of out.streams){
      if(item.id && item.name && !namesById.has(item.id))namesById.set(item.id,item.name);
    }
    for(const item of out.streamAxes){
      if(item.id && item.name && !namesById.has(item.id))namesById.set(item.id,item.name);
    }
    // Der amtliche Richterswiler Muelibach wird auch gefunden, wenn seine
    // Bezeichnungsabschnitte fehlen oder anders geschrieben sind.
    namesById.set('2512','Mülibach Richterswil');
    for(const item of STREAM_CATALOG)for(const id of item.ids||[]){
      if(!namesById.has(id))namesById.set(id,item.name);
    }
    const matchedAxes=out.streamAxes.filter(a=>a.id&&namesById.has(a.id));
    const geometryKey=g=>JSON.stringify(g.coordinates);
    const routeGeometries=new Set(matchedAxes.map(a=>geometryKey(a.geometry)));
    // Route-Chunks werden bei vorhandenem ID-Join bevorzugt; unverknuepfbare
    // Namensabschnitte bleiben erhalten (z.B. kantonsuebergreifende Teile).
    const augmented=[];
    const seenFinal=new Set();
    const add=s=>{
      const key=JSON.stringify([s.name,s.geometry.coordinates]);
      if(!seenFinal.has(key)){seenFinal.add(key);augmented.push(s);}
    };
    // Prefer complete 45.2 route geometries where the IDs match, but retain
    // 45.1 public-stream geometry on waterways lacking a matching route ID.
    // 45.3 name events serve as backup, not a reason to omit longer axes.
    for(const s of [...out.streams].sort((a,b)=>({'45.1':0,'45.3':1}[a.source]??2)-({'45.1':0,'45.3':1}[b.source]??2))){
      if(!routeGeometries.has(geometryKey(s.geometry)))add(s);
    }
    for(const a of matchedAxes){
      add({name:namesById.get(a.id),geometry:a.geometry,id:a.id,source:'full-route'});
    }
    // Named but not numbered datasets continue to be usable.
    out.streams=augmented;
    trimStreamsAtWater(out);
    out.routeIds=[...new Set(matchedAxes.map(a=>a.id))];
    out.namedIds=[...new Set(out.streams.filter(s=>s.id).map(s=>s.id))];
    out.fullRoutes=STREAM_CATALOG.filter(item=>out.streams.some(s=>s.name===item.name&&s.source==='full-route')).map(item=>item.name);
    out.muelibachRouteParts=out.streams.filter(s=>s.name==='Mülibach Richterswil'&&s.source==='full-route').length;
    out.muelibachMouth=assessMuelibachMouth(out);
    out.sihlSegments=out.streams.filter(s=>s.name==='Sihl').length;
    out.sihlRouteSegments=out.streams.filter(s=>s.name==='Sihl'&&s.source==='full-route').length;
    out.found=STREAM_CATALOG.filter(item=>out.streams.some(s=>s.name===item.name)).map(item=>item.name);
    // A named 45.11 outline is useful even when 45.10 does not include the
    // water body. Fill it ONLY if the official shoreline is already a closed
    // ring (<= 1 m endpoint difference); never invent a connecting section.
    const outlinesById=new Set(out.lakes.filter(l=>l.id).map(l=>l.id));
    const outlinesByName=new Set(out.lakes.filter(l=>l.name).map(l=>l.name));
    for(const pond of out.pondShore){
      if((pond.id && outlinesById.has(pond.id)) || outlinesByName.has(pond.name))continue;
      const coords=pond.geometry.type==='LineString'?[pond.geometry.coordinates]:pond.geometry.coordinates;
      const rings=coords.filter(line=>line.length>=4&&Math.hypot(line[0][0]-line.at(-1)[0],line[0][1]-line.at(-1)[1])<=1);
      if(rings.length){
        out.lakes.push({name:pond.name,id:pond.id,source:'45.11-closed-shore',geometry:{type:'Polygon',coordinates:[rings[0]]}});
        if(pond.id)outlinesById.add(pond.id);outlinesByName.add(pond.name);
      }
    }
    out.pondsFound=POND_CATALOG.filter(item=>out.lakes.some(l=>l.name===item.name)||out.pondShore.some(l=>l.name===item.name)).map(item=>item.name);
    out.pondsFilled=POND_CATALOG.filter(item=>out.lakes.some(l=>l.name===item.name)).map(item=>item.name);
    out.pondsOutlined=POND_CATALOG.filter(item=>out.pondShore.some(l=>l.name===item.name)).map(item=>item.name);
    out.unresolvedStreams=STREAM_CATALOG.filter(item=>!out.found.includes(item.name)).map(item=>item.name);
    out.unresolvedPonds=POND_CATALOG.filter(item=>!out.pondsFound.includes(item.name)).map(item=>item.name);
    return out;
  }
  // Nur Diagnose – keine kuenstliche Verbindung zum See ziehen.
  // Der groesste stehende Wasserkörper im Reliefausschnitt ist der Zürichsee.
  function assessMuelibachMouth(data, toleranceMetres=60){
    const parts=(data?.streams||[]).filter(s=>s.name==='Mülibach Richterswil'&&s.source==='full-route');
    if(!parts.length)return {state:'missing',parts:0,distanceMetres:null};
    const lakes=(data?.lakes||[]).map(l=>l.geometry||l).filter(g=>['Polygon','MultiPolygon'].includes(g?.type));
    if(!lakes.length)return {state:'unverifiable',parts:parts.length,distanceMetres:null};
    const outerRings=g=>g.type==='Polygon'?[g.coordinates[0]]:g.coordinates.map(poly=>poly[0]);
    function area(ring){let a=0;for(let i=1;i<ring.length;i++)a+=ring[i-1][0]*ring[i][1]-ring[i][0]*ring[i-1][1];return Math.abs(a/2);}
    const lake=lakes.map(g=>({g,area:outerRings(g).reduce((v,r)=>v+area(r),0)})).sort((a,b)=>b.area-a.area)[0].g;
    const rings=outerRings(lake);
    function distanceToSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],dd=dx*dx+dy*dy;const t=dd?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/dd)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
    let closest=Infinity;
    for(const item of parts){
      const paths=item.geometry.type==='LineString'?[item.geometry.coordinates]:item.geometry.coordinates;
      for(const line of paths){
        if(!line?.length)continue;
        for(const p of [line[0],line.at(-1)])for(const ring of rings){
          for(let i=1;i<ring.length;i++)closest=Math.min(closest,distanceToSegment(p,ring[i-1],ring[i]));
        }
      }
    }
    return {state:closest<=toleranceMetres?'atLake':'gap',parts:parts.length,distanceMetres:Math.round(closest)};
  }
  async function getText(url,limit=25000000){
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),12000);
    try{
      const res=await fetch(url,{mode:'cors',signal:abort.signal});
      if(!res.ok)throw Error(`HTTP ${res.status}`);
      if(Number(res.headers.get('Content-Length')||0)>limit)throw Error('WFS-Antwort zu gross.');
      const body=await res.text();if(body.length>limit)throw Error('WFS-Antwort zu gross.');return body;
    }finally{clearTimeout(timer);}
  }
  function bboxQuery(bbox){return bbox.map(n=>Number(n.toFixed(2))).join(',')+',EPSG:2056';}
  async function fetchRole(role,type,bbox){
    if(!type)return empty();
    const perPage=1200,maxPages=15,parts=[];
    const options=[
      {VERSION:'2.0.0',TYPENAMES:type,OUTPUTFORMAT:'application/json',COUNT:String(perPage)},
      {VERSION:'2.0.0',TYPENAMES:type,OUTPUTFORMAT:'geojson',COUNT:String(perPage)},
      {VERSION:'1.0.0',TYPENAME:type,OUTPUTFORMAT:'application/json',MAXFEATURES:String(perPage)}
    ];
    let lastError=null;
    for(const choice of options){
      const loaded=[];let previousSignature='';try{
        for(let page=0;page<maxPages;page++){
          const query=new URLSearchParams({SERVICE:'WFS',REQUEST:'GetFeature',SRSNAME:'EPSG:2056',BBOX:bboxQuery(bbox),...choice});
          if(choice.VERSION==='2.0.0')query.set('STARTINDEX',String(page*perPage));
          const raw=await getText(`${SOURCE}?${query.toString()}`);
          const json=JSON.parse(raw);
          if(json.type!=='FeatureCollection'||!Array.isArray(json.features))throw Error('Kein gültiges GeoJSON-FeatureCollection.');
          // Some servers ignore STARTINDEX; stop instead of issuing repeated pages.
          const signature=JSON.stringify([json.features.length,json.features[0]?.id,json.features[0]?.geometry?.coordinates?.[0],json.features.at(-1)?.id]);
          if(page>0 && signature===previousSignature)break;
          previousSignature=signature;
          if(role==='shore')for(const f of json.features){f.properties={...f.properties,__source_layer:'zuerichseeufer'};}
          loaded.push(fromGeojson(json,role));
          const numberMatched=Number(json.numberMatched);
          if(choice.VERSION!=='2.0.0'||json.features.length<perPage||(Number.isFinite(numberMatched)&&(page+1)*perPage>=numberMatched))break;
          if(page===maxPages-1)throw Error(`WFS-Limit ${perPage*maxPages} Objekte für ${role} überschritten.`);
        }
        return combine(loaded);
      }catch(e){lastError=e;}
    }
    throw Error(`${role}: ${lastError?.message||'WFS-Abfrage fehlgeschlagen'}`);
  }
  // Der Krebsbach fliesst vom Hüttnerseeli durch den Kanton Schwyz nach
  // Bäch in den Zürichsee. Ein Zürcher WFS allein kann ihn NICHT vollständig
  // darstellen. Ausschliesslich die EXAKT als Krebsbach bezeichneten Linien
  // werden aus landesweiten Geodaten bzw. dem Schwyzer WFS ausgewählt.
  // Unbenannte Nebenbäche werden nicht angehängt, auch wenn sie nah liegen.
  const KREBS_SWISS_LAYER='ch.swisstopo.swisstlm3d-gewaessernetz';
  const KREBS_SCHWYZ_LAYER='ch.sz.a041b.gewaessernetz.mwert';
  const KREBS_SCHWYZ_WFS='https://wfs.geo.sz.ch/';
  function geometryBbox(g){
    const lines=g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
    let minx=Infinity,miny=Infinity,maxx=-Infinity,maxy=-Infinity;
    for(const line of lines)for(const p of line){minx=Math.min(minx,p[0]);miny=Math.min(miny,p[1]);maxx=Math.max(maxx,p[0]);maxy=Math.max(maxy,p[1]);}
    return [minx,miny,maxx,maxy];
  }
  function namedKrebsbachFeatures(data,bbox,source){
    const features=data?.type==='FeatureCollection'?data.features:data?.results||data?.features||[];
    if(!Array.isArray(features))return [];
    const out=[];
    for(const f of features){
      const geom=f?.geometry;
      if(!validLV95(geom)||!['LineString','MultiLineString'].includes(geom.type))continue;
      const props={...(f?.attributes||{}),...(f?.properties||{})};
      // Only the actual stream by EXACT name; in particular not Chrebsbach.
      const vals=lookup(props,[...nameKeys,'bachname','bachnamen','gewaesser','gewaesser_name','gewässer']);
      if(!vals.some(v=>clean(v)==='krebsbach'))continue;
      // swissTLM3D code 6 is a fictional water-body axis, not a real creek.
      const types=lookup(props,['objektart','objecttype']);
      if(types.some(v=>String(v)==='6'||clean(v)==='seeachse'))continue;
      if(!bboxOverlaps(geometryBbox(geom),bbox))continue;
      out.push({name:'Krebsbach',geometry:geom,id:null,source});
    }
    return out;
  }
  async function swissKrebsbach(bbox){
    const query=new URLSearchParams({layer:KREBS_SWISS_LAYER,searchText:'Krebsbach',searchField:'NAME',contains:'false',geometryFormat:'geojson',returnGeometry:'true',sr:'2056'});
    const raw=await getText(`https://api3.geo.admin.ch/rest/services/ech/MapServer/find?${query.toString()}`,5000000);
    return namedKrebsbachFeatures(JSON.parse(raw),bbox,'swisstopo Krebsbach');
  }
  async function schwyzKrebsbach(bbox){
    const q=new URLSearchParams({SERVICE:'WFS',VERSION:'2.0.0',REQUEST:'GetFeature',TYPENAMES:KREBS_SCHWYZ_LAYER,OUTPUTFORMAT:'application/json',SRSNAME:'EPSG:2056',BBOX:bboxQuery(bbox),COUNT:'8000'});
    const raw=await getText(`${KREBS_SCHWYZ_WFS}?${q.toString()}`,20000000);
    return namedKrebsbachFeatures(JSON.parse(raw),bbox,'SZ Krebsbach');
  }
  async function fetchKrebsbachTranscantonal(bbox){
    // Beide unabhängigen amtlichen Quellen auswerten, damit fehlende
    // kantonsübergreifende Teilstücke nicht verschluckt werden.
    const sources=await Promise.allSettled([swissKrebsbach(bbox),schwyzKrebsbach(bbox)]);
    const accepted=[],seen=new Set(),errors=[];
    for(const result of sources){
      if(result.status==='rejected'){errors.push(result.reason?.message||'Quellabfrage fehlgeschlagen');continue;}
      for(const feature of result.value){
        if(feature.name!=='Krebsbach')continue;
        const key=JSON.stringify(feature.geometry.coordinates);
        if(!seen.has(key)){seen.add(key);accepted.push(feature);}
      }
    }
    if(!accepted.length && errors.length)throw Error(errors.join(' / '));
    return accepted;
  }
  async function fetchOfficial(bbox,mapBbox=bbox){
    const capabilities=new URLSearchParams({SERVICE:'WFS',VERSION:'2.0.0',REQUEST:'GetCapabilities'});
    const types=layerTypes(await getText(`${SOURCE}?${capabilities.toString()}`));
    if(!types.lakes&&!types.shore&&!types.streams)throw Error('WFS enthält keine passenden Gewässergeometrien.');
    // Bach-/Seequellen aus v5.9.2 bleiben unveraendert. Zusaetzlich genau
    // GIS-ZH 51.1 fuer die drei benannten Weiher; niemals andere Weiher uebernehmen.
    // Keine 45.1-, 45.11- oder 45.16-Massenabfragen.
    const roles=['lakes','shore','streams','streamAxes','pondRights'];
    const jobs=roles.filter(role=>types[role]).map(async role=>({role,data:await fetchRole(role,types[role],bbox)}));
    const settled=await Promise.allSettled(jobs),data=[],errors=[],loadedRoles=[];
    for(let i=0;i<settled.length;i++){
      const row=settled[i],role=roles.filter(key=>types[key])[i];
      if(row.status==='fulfilled'){data.push(row.value.data);loadedRoles.push(role);}
      else errors.push(`${role}: ${row.reason?.message||'keine WFS-Antwort'}`);
    }
    const combined=combine(data);
    // KRITISCH: Grundkarte (Zürichsee, Sihl, alle bisherigen Gewässer) darf
    // NIEMALS auf die separate Krebsbach-Validierung oder deren Netzabfrage warten.
    // Die Einzelfallprüfung wird erst NACH dem sichtbaren Kartenaufbau durchgeführt.
    combined.errors=errors;combined.types=types;combined.loadedRoles=loadedRoles;
    combined.krebsbachRoute={state:'Separate Prüfung läuft',complete:false,pieces:0};
    certifySihlAcrossMap(combined,mapBbox);
    if(!types.streamAxes)errors.push('Kantonaler Layer der vollständigen Gewässerachsen (45.2) fehlt.');
    if(!combined.lakes.length&&!combined.shores.length&&!combined.streams.length&&!combined.pondShore.length)
      throw Error('Amtliche Gewässergeometrie nicht verfügbar: '+errors.join('; '));
    return combined;
  }
  // Weder der Ausfall noch ein Programmfehler einer Nachlieferung darf die
  // bereits vollständig geladene Grundkarte ersetzen, leeren oder blockieren.
  async function fetchSupplemental(data,bbox,mapBbox=bbox){
    const [w,s,e,n]=mapBbox;
    const sihlSearchBox=[w-2500,s-2500,e+2500,n+2500];
    // Zuerst landesweit nur benannte Sihl-Geometrien abrufen. Sie dienen
    // danach zusätzlich als bestätigte Anker für unbeschriftete SZ-Abschnitte.
    const jobs=await Promise.allSettled([fetchKrebsbachTranscantonal(bbox),
      fetchSwissSihl(mapBbox,data.streams.filter(s=>s.name==='Sihl'))]);
    const errors=[];
    const supplemental=(result,label)=>{
      if(result.status==='fulfilled')return result.value;
      errors.push(`${label}: ${result.reason?.message||'Abfrage fehlgeschlagen'}`);
      return [];
    };
    const krebsExtra=supplemental(jobs[0],'Krebsbach ausserhalb Zürich');
    const nationalSihl=supplemental(jobs[1],'Sihl national');
    // Nur EIN landesweiter swisstopo-Gewässerdatensatz für die Sihl.
    const sihlExtra=nationalSihl;
    const verified=krebsExtra.filter(v=>v.name==='Krebsbach');
    // Prüfung nur auf einem separaten Minimalobjekt. Niemals alle anderen Bäche
    // oder die Seen durch das Zertifizierungsprogramm laufen lassen.
    const candidate={lakes:data.lakes,streams:[...data.streams.filter(v=>v.name==='Krebsbach'),...verified]};
    try{certifyKrebsbachRoute(candidate,mapBbox);}
    catch(e){
      candidate.streams=[];
      candidate.krebsbachRoute={state:'Krebsbach-Prüfung fehlgeschlagen: '+e.message,complete:false,pieces:0};
      errors.push(candidate.krebsbachRoute.state);
    }
    const retained=data.streams.filter(v=>v.name!=='Krebsbach');
    const duplicate=new Set(retained.filter(v=>v.name==='Sihl').map(v=>JSON.stringify(v.geometry.coordinates)));
    let sihlAdded=0;
    for(const feature of sihlExtra){
      if(feature.name!=='Sihl')continue;
      const cleanGeom=trimStreamGeometry(feature.geometry,waterPolygons(data.lakes));
      if(!cleanGeom)continue;
      const key=JSON.stringify(cleanGeom.coordinates);
      if(duplicate.has(key))continue;
      retained.push({...feature,geometry:cleanGeom});duplicate.add(key);sihlAdded++;
    }
    const out={...data,streams:[...retained,...candidate.streams.filter(v=>v.name==='Krebsbach')],
      krebsbachRoute:candidate.krebsbachRoute,
      krebsbachExtra:verified.length,sihlNationalParts:sihlAdded,
      errors:[...(data.errors||[]),...errors]};
    out.found=STREAM_CATALOG.filter(item=>out.streams.some(s=>s.name===item.name)).map(item=>item.name);
    out.unresolvedStreams=STREAM_CATALOG.filter(item=>!out.found.includes(item.name)).map(item=>item.name);
    out.fullRoutes=STREAM_CATALOG.filter(item=>out.streams.some(s=>s.name===item.name&&s.source==='full-route')).map(item=>item.name);
    out.sihlSegments=out.streams.filter(s=>s.name==='Sihl').length;
    out.sihlRouteSegments=out.streams.filter(s=>s.name==='Sihl'&&s.source==='full-route').length;
    certifySihlAcrossMap(out,mapBbox);
    return out;
  }
  // Schweizer Landesdatensatz swissTLM3D: Ein Bach hat eine Gewässernummer
  // (gwl_nr), auch wenn bei einzelnen Segmenten name=null ist. Die Identifikation
  // ist schweizweit und endet NICHT an einer Kantons-/Gemeindegrenze.
  // GeoAdmin MapServer Metadaten: Felder name / gwl_nr, EPSG:2056.
  const NATIONAL_SIHL_LAYER='ch.swisstopo.swisstlm3d-gewaessernetz';
  const NATIONAL_SIHL_SERVER='https://api3.geo.admin.ch/rest/services/ech/MapServer/';
  function swisstopoResultFeatures(json){
    const list=Array.isArray(json?.results)?json.results:
      Array.isArray(json?.features)?json.features:[];
    return list.map(row=>{
      const props={...(row?.attributes||{}),...(row?.properties||{})};
      let geometry=row?.geometry;
      if(geometry?.paths && !geometry.type){geometry={type:'MultiLineString',coordinates:geometry.paths};}
      else if(geometry?.path && !geometry.type){geometry={type:'LineString',coordinates:geometry.path};}
      return {geometry,properties:props,id:row?.featureId??row?.id??null};
    }).filter(f=>validLV95(f.geometry)&&['LineString','MultiLineString'].includes(f.geometry.type));
  }
  function normalizedGwlNumber(f){
    const v=lookup(f?.properties,['gwl_nr']);
    return v.length && v[0]!=null && String(v[0]).trim() ? String(v[0]).trim() : null;
  }
  function explicitlySihl(f){
    return lookup(f?.properties,['name']).some(v=>clean(v)==='sihl');
  }
  async function nationwideSihlNames(){
    const q=new URLSearchParams({layer:NATIONAL_SIHL_LAYER,searchText:'Sihl',
      searchField:'name',contains:'false',geometryFormat:'geojson',returnGeometry:'true',sr:'2056'});
    const raw=await getText(`${NATIONAL_SIHL_SERVER}find?${q}`,12000000);
    return swisstopoResultFeatures(JSON.parse(raw)).filter(explicitlySihl);
  }
  async function nationwideSihlIdentify(bbox,offset=0,limit=200){
    const q=new URLSearchParams({geometryType:'esriGeometryEnvelope',
      geometry:bbox.map(x=>Number(x.toFixed(2))).join(','),
      layers:`all:${NATIONAL_SIHL_LAYER}`,tolerance:'0',
      returnGeometry:'true',geometryFormat:'geojson',sr:'2056',
      limit:String(limit),offset:String(offset)});
    const raw=await getText(`${NATIONAL_SIHL_SERVER}identify?${q}`,18000000);
    return swisstopoResultFeatures(JSON.parse(raw));
  }
  // Für den östlich fehlenden Sihl-Teil nur die swissTLM3D-Geometrien in
  // einem Korridor um die bereits bekannte Sihl untersuchen. Sind in einem
  // Teilrechteck >200 Objekte, wird es geteilt; kein stilles Abschneiden.
  async function nationwideSihlCorridor(bbox,knownSihl){
    const [west,south,east,north]=bbox;
    let anchor=null;
    for(const s of knownSihl||[]){
      if(s.name!=='Sihl')continue;
      const g=s.geometry,lines=g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
      for(const line of lines)for(const p of line){
        if(p?.length>=2&&(!anchor||p[0]>anchor[0]))anchor=[p[0],p[1]];
      }
    }
    // Kein Raten eines Ausgangspunkts: ohne bestätigte Sihl kein neuer Verlauf.
    if(!anchor) return [];
    const corridor=[Math.max(west,anchor[0]-1800),Math.max(south,anchor[1]-1600),
      east+30,Math.min(north,anchor[1]+1600)];
    if(corridor[0]>=corridor[2]||corridor[1]>=corridor[3])return [];
    const seen=new Map();let requests=0;
    async function tile(b,depth){
      if(++requests>40)throw Error('swissTLM3D-Sihl: maximale Teilabfragen überschritten.');
      const rows=await nationwideSihlIdentify(b);
      if(rows.length>=200){
        if(depth>=5)throw Error('swissTLM3D-Sihl: Abfrage liefert mehr als 200 Objekte pro kleinstem Ausschnitt.');
        const [x0,y0,x1,y1]=b;
        const parts=x1-x0>=y1-y0?[[x0,y0,(x0+x1)/2,y1],[(x0+x1)/2,y0,x1,y1]]:
          [[x0,y0,x1,(y0+y1)/2],[x0,(y0+y1)/2,x1,y1]];
        for(const part of parts)await tile(part,depth+1);
        return;
      }
      for(const f of rows){
        const id=f.id!=null?`id:${f.id}`:`geometry:${JSON.stringify(f.geometry.coordinates)}`;
        seen.set(id,f);
      }
    }
    await tile(corridor,0);
    return [...seen.values()];
  }
  // A genuine gap can be an unnamed/un-numbered TLM3D segment between two
  // already CONFIRMED Sihl parts. Accept only actual SwissTLM3D coordinates
  // that join BOTH parts. One-sided tributaries or other named streams stay out.
  // No fabricated connector, no change to any other water body.
  function fillSihlGaps(confirmed,rawFeatures,bbox){
    const joinTol=6, maxStraight=400, maxRoute=1000;
    const all=[],nodes=[],cells=new Map(),edges=[];
    const key=(ix,iy)=>`${ix}:${iy}`;
    function at(p){
      const ix=Math.floor(p[0]/joinTol),iy=Math.floor(p[1]/joinTol);
      for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++){
        for(const id of cells.get(key(ix+x,iy+y))||[]){
          const q=nodes[id].p;
          if(Math.hypot(p[0]-q[0],p[1]-q[1])<=joinTol)return id;
        }
      }
      const id=nodes.length;nodes.push({p:[p[0],p[1]],edges:[]});
      const k=key(ix,iy);if(!cells.has(k))cells.set(k,[]);cells.get(k).push(id);
      return id;
    }
    function add(line,kind,source=null){
      if(!Array.isArray(line)||line.length<2)return;
      const a=at(line[0]),b=at(line.at(-1));if(a===b)return;
      let length=0;
      for(let j=1;j<line.length;j++)length+=Math.hypot(line[j][0]-line[j-1][0],line[j][1]-line[j-1][1]);
      if(length<=0)return;
      const id=edges.length;edges.push({a,b,line,kind,source,length});
      nodes[a].edges.push(id);nodes[b].edges.push(id);
    }
    const split=g=>g?.type==='LineString'?[g.coordinates]:g?.type==='MultiLineString'?g.coordinates:[];
    for(const s of confirmed){
      if(s.name!=='Sihl')continue;
      for(const line of split(s.geometry))for(const part of clipPolylineToBox(line,bbox))add(part,'known');
    }
    const knownCount=edges.length;
    if(knownCount<2)return [];
    // Whole known lines are already trusted, regardless of name attributes.
    const parent=nodes.map((_,i)=>i);
    function root(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    function unite(a,b){parent[root(a)]=root(b);}
    for(let j=0;j<knownCount;j++)unite(edges[j].a,edges[j].b);
    const knownEnds=new Set();
    for(let j=0;j<knownCount;j++){knownEnds.add(edges[j].a);knownEnds.add(edges[j].b);}
    const rawSeen=new Set();
    for(const f of rawFeatures||[]){
      if(!validLV95(f.geometry))continue;
      const explicit=lookup(f.properties,['name']).filter(v=>String(v).trim());
      if(explicit.some(v=>clean(v)!=='sihl'))continue;
      for(const line of split(f.geometry)){
        for(const part of clipPolylineToBox(line,bbox)){
          const coordsKey=JSON.stringify(part);
          if(rawSeen.has(coordsKey))continue;rawSeen.add(coordsKey);
          add(part,'candidate',f);
        }
      }
    }
    if(edges.length===knownCount)return [];
    // Close only small gaps between two DISTINCT previously known components.
    const terminal=[...knownEnds];
    const groups=new Map();
    for(const id of terminal){const c=root(id);if(!groups.has(c))groups.set(c,[]);groups.get(c).push(id);}
    if(groups.size<2)return [];
    let best=null;
    for(const [component,starts] of groups){
      const targetIds=new Set(terminal.filter(id=>root(id)!==component));
      const goalNear=starts.some(a=>[...targetIds].some(b=>Math.hypot(nodes[a].p[0]-nodes[b].p[0],nodes[a].p[1]-nodes[b].p[1])<=maxStraight));
      if(!goalNear)continue;
      // Dijkstra on official candidate lines; every verified Sihl component is
      // free to traverse, but cannot turn an unverified branch into a new river.
      const dist=Array(nodes.length).fill(Infinity),prior=Array(nodes.length).fill(null),used=new Set();
      for(const n of starts)dist[n]=0;
      while(true){
        let u=-1,du=Infinity;
        for(let i=0;i<nodes.length;i++)if(!used.has(i)&&dist[i]<du){du=dist[i];u=i;}
        if(u<0||du>maxRoute)break;
        used.add(u);
        if(targetIds.has(u)){
          const path=[];let v=u;
          while(prior[v]){const {before,edgeId}=prior[v];if(edges[edgeId].kind==='candidate')path.push(edgeId);v=before;}
          if(path.length && (!best||du<best.cost))best={cost:du,ids:path.reverse()};
          break;
        }
        for(const eid of nodes[u].edges){
          const e=edges[eid],v=e.a===u?e.b:e.a;
          const cost=e.kind==='known'?0:e.length;
          if(dist[u]+cost<dist[v]){dist[v]=dist[u]+cost;prior[v]={before:u,edgeId:eid};}
        }
      }
    }
    if(!best)return [];
    const unique=new Set();
    for(const id of best.ids)unique.add(id);
    return [...unique].map(id=>({name:'Sihl',geometry:{type:'LineString',coordinates:edges[id].line},
      id:normalizedGwlNumber(edges[id].source),source:'swisstopo swissTLM3D · amtliches Lückenstück'}));
  }

  async function fetchSwissSihl(bbox,knownSihl=[]){
    // Name zuerst als ANKER, danach gwl_nr auf ALLE gleich nummerierten
    // TLM3D-Abschnitte im Kartenkorridor anwenden (auch name=null).
    const named=await nationwideSihlNames().catch(()=>[]);
    const relevantNamed=named.filter(f=>bboxOverlaps(geometryBbox(f.geometry),bbox));
    // Find kann schweizweit Treffer liefern, die nicht im Ausschnitt liegen.
    // Ihre Gewässernummer gilt trotzdem für die Sihl in unserem Ausschnitt.
    const ids=new Set(named.map(normalizedGwlNumber).filter(Boolean));
    const features=await nationwideSihlCorridor(bbox,knownSihl);
    // Bei vollen landesweiten Find-Ergebnissen können alle Sihl-Anker knapp
    // ausserhalb der Karte liegen: auch benannte Sihl in den lok. Treffern nutzen.
    for(const f of features)if(explicitlySihl(f)){
      const id=normalizedGwlNumber(f);if(id)ids.add(id);
    }
    // swisstopo nennt einzelne Sihl-Segmente gar nicht. Falls der Find-Aufruf
    // keine vollständige Nummer liefert, anhand des bereits sichtbaren, amtlich
    // benannten Sihl-Stücks das nationale Objekt eindeutig identifizieren.
    if(!ids.size){
      const anchor=knownSihl.filter(s=>s.name==='Sihl').flatMap(s=>{
        const g=s.geometry;return g?.type==='LineString'?g.coordinates:g?.type==='MultiLineString'?g.coordinates.flat():[];
      }).reduce((best,p)=>(!best||p[0]>best[0])?p:best,null);
      if(anchor){
        let best=null;
        for(const f of features){
          const id=normalizedGwlNumber(f);if(!id)continue;
          if(lookup(f.properties,['name']).some(n=>n && clean(n)!=='sihl'))continue;
          const lines=f.geometry.type==='LineString'?[f.geometry.coordinates]:f.geometry.coordinates;
          const distance=Math.min(...lines.map(line=>pointToLineDistance(anchor,line)));
          if(distance<=25 && (!best||distance<best.distance))best={distance,id};
        }
        if(best)ids.add(best.id);
      }
    }
    const selected=[];
    const seen=new Set();
    for(const f of [...relevantNamed,...features]){
      const nameMatch=explicitlySihl(f);
      const watercourseNumber=normalizedGwlNumber(f);
      if(!nameMatch && (!watercourseNumber || !ids.has(watercourseNumber)))continue;
      if(!bboxOverlaps(geometryBbox(f.geometry),bbox))continue;
      const key=JSON.stringify(f.geometry.coordinates);
      if(seen.has(key))continue;seen.add(key);
      selected.push({name:'Sihl',geometry:f.geometry,id:watercourseNumber,
        source:'swisstopo swissTLM3D · Sihl (gwl_nr)'});
    }
    // Only insert real, previously filtered-out TLM3D segment(s) when they
    // join two separate, established Sihl components across a small gap.
    const missing=fillSihlGaps([...knownSihl,...selected],features,bbox);
    return [...selected,...missing];
  }
  // Schwyzer Gewässernetz: nur Linien, die explizit der SIHL zugeordnet sind.
  // Die Sihl verläuft jenseits der Zürcher Kantonsgrenze. Der Zürcher WFS
  // liefert diesen Abschnitt naturgemäss nicht. KEINEN Schwyzer Nebenbach zeichnen.
  const SIHL_SZ_TYPENAME='ch.sz.a041b.gewaessernetz.mwert';
  const SIHL_SZ_WFS='https://wfs.geo.sz.ch/';
  const SIHL_SZ_NAME_KEYS=[...nameKeys,'bachnamen','bachname','gewaesser','gewaessername','gewässer','fliessgewaesser','flussname'];
  // Fachschluessel ist ein Klassifikationsattribut und KEINE Gewaesser-ID.
  const SIHL_SZ_ROUTE_KEYS=[...idKeys,'routenid','routen_id','routeid','routennummer'];
  function exactSihlFeature(feature){
    const props={...(feature?.attributes||{}),...(feature?.properties||{})};
    return lookup(props,SIHL_SZ_NAME_KEYS).some(value=>clean(value)==='sihl');
  }
  function routeIdentifiers(feature){
    const props={...(feature?.attributes||{}),...(feature?.properties||{})};
    return lookup(props,SIHL_SZ_ROUTE_KEYS).map(value=>String(value).trim()).filter(v=>v.length>0);
  }
  function onlySihlFromSchwyz(features,bbox){
    const named=features.filter(f=>validLV95(f.geometry)&&
      ['LineString','MultiLineString'].includes(f.geometry.type)&&
      bboxOverlaps(geometryBbox(f.geometry),bbox)&&exactSihlFeature(f));
    // Nur gleiche amtliche Gewässer-/Routen-ID wie ein NAMENTLICH
    // bestätigtes Sihl-Teilstück; keine räumliche Nachbarschaftssuche.
    const certifiedIds=new Set(named.flatMap(routeIdentifiers));
    const used=new Set(),accepted=[];
    for(const f of features){
      const geom=f?.geometry;
      if(!validLV95(geom)||!['LineString','MultiLineString'].includes(geom.type)||
         !bboxOverlaps(geometryBbox(geom),bbox))continue;
      const props={...(f?.attributes||{}),...(f?.properties||{})};
      const otherExplicitNames=lookup(props,SIHL_SZ_NAME_KEYS).filter(v=>String(v).trim());
      const namedSihl=exactSihlFeature(f);
      // Keine fremden Flussnamen ueber eine versehentlich geteilte ID einschleusen.
      if(!namedSihl && otherExplicitNames.length)continue;
      if(!namedSihl && !routeIdentifiers(f).some(id=>certifiedIds.has(id)))continue;
      const key=JSON.stringify(geom.coordinates);
      if(used.has(key))continue;
      used.add(key);accepted.push({name:'Sihl',geometry:geom,id:null,source:'Kanton Schwyz Sihl'});
    }
    return accepted;
  }
  // Nur die Sihl: das kantonale Referenznetz kann Abschnitte ohne Bachnamen
  // liefern. Suche darin einen tatsächlich verbundenen Hauptlauf von einer
  // bereits amtlich als SIHL bestätigten Linie bis zum OSTRAND. Bei einer
  // Verzweigung wird nur EIN zusammenhängender Pfad benutzt; keine fremden
  // namentlich bezeichneten Bäche und keine synthetischen Verbindungen.
  function sihlMainStemFromNetwork(knownSihl, rawFeatures, bbox){
    const tol=6, bucketWidth=6;
    const [west,south,east,north]=bbox;
    const nodes=[],buckets=new Map(),edges=[],MAX_EDGES=85000;
    const key=(i,j)=>`${i}:${j}`;
    function nodeFor(p){
      const ix=Math.floor(p[0]/bucketWidth),iy=Math.floor(p[1]/bucketWidth);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        for(const i of buckets.get(key(ix+dx,iy+dy))||[]){
          if(Math.hypot(nodes[i].p[0]-p[0],nodes[i].p[1]-p[1])<=tol)return i;
        }
      }
      const id=nodes.length;nodes.push({p:[p[0],p[1]],links:[],trusted:false});
      const k=key(ix,iy);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(id);
      return id;
    }
    function addGeometry(g,source,named,matchedRoute){
      if(!validLV95(g)||!['LineString','MultiLineString'].includes(g.type))return;
      const lines=g.type==='LineString'?[g.coordinates]:g.coordinates;
      for(const line of lines){
        if(!Array.isArray(line)||line.length<2)continue;
        for(const clipped of clipPolylineToBox(line,bbox)){
          for(let i=1;i<clipped.length;i++){
            if(edges.length>=MAX_EDGES)return;
            const a=clipped[i-1],b=clipped[i];
            const length=Math.hypot(b[0]-a[0],b[1]-a[1]);
            if(length<.001)continue;
            const u=nodeFor(a),v=nodeFor(b);if(u===v)continue;
            const id=edges.length;
            edges.push({u,v,a,b,length,source,named,matchedRoute});
            nodes[u].links.push(id);nodes[v].links.push(id);
            if(source==='known'){nodes[u].trusted=true;nodes[v].trusted=true;}
          }
        }
      }
    }
    for(const k of knownSihl||[]){if(k?.name==='Sihl')addGeometry(k.geometry,'known',true,true);}
    if(!nodes.some(n=>n.trusted))return {lines:[],reason:'keine amtliche Sihl-Ausgangsachse',connected:false};
    const namedFeatures=(rawFeatures||[]).filter(f=>exactSihlFeature(f));
    const sihlIds=new Set(namedFeatures.flatMap(routeIdentifiers));
    let extra=0;
    for(const f of rawFeatures||[]){
      const geom=f?.geometry;
      if(!validLV95(geom)||!['LineString','MultiLineString'].includes(geom.type)||!bboxOverlaps(geometryBbox(geom),bbox))continue;
      const props={...(f?.attributes||{}),...(f?.properties||{})};
      const explicit=lookup(props,SIHL_SZ_NAME_KEYS).filter(v=>String(v).trim());
      const named=exactSihlFeature(f);
      if(explicit.length && !named)continue;
      const matchedRoute=routeIdentifiers(f).some(id=>sihlIds.has(id));
      addGeometry(geom,'schwyz',named,matchedRoute);
      extra++;
    }
    if(!extra)return {lines:[],reason:'Schwyzer WFS lieferte keine zulässigen Gewässerachsen',connected:false};
    // Ein validierter (auch namenloser) Teilpfad muss eine bestehende SIHL-
    // Koordinate erreichen. Dijkstra verwendet ausschliesslich WFS-Vektoren.
    // Eine fehlende topologische Verbindung wird NICHT interpoliert.
    const start=nodes.map((n,i)=>n.trusted?i:-1).filter(i=>i>=0 && nodes[i].p[0]>west+(east-west)*.32);
    if(!start.length)return {lines:[],reason:'keine Sihl-Anschlussstelle nahe dem Schwyzer Abschnitt',connected:false};
    const dist=new Float64Array(nodes.length).fill(Infinity),prev=new Int32Array(nodes.length).fill(-1),prevEdge=new Int32Array(nodes.length).fill(-1);
    const heap=[];
    function put(id,d){heap.push([d,id]);let i=heap.length-1;while(i){const par=(i-1)>>1;if(heap[par][0]<=d)break;heap[i]=heap[par];i=par;}heap[i]=[d,id];}
    function pop(){if(!heap.length)return null;const first=heap[0],tail=heap.pop();if(!heap.length)return first;let i=0;while(2*i+1<heap.length){let j=i*2+1;if(j+1<heap.length&&heap[j+1][0]<heap[j][0])j++;if(heap[j][0]>=tail[0])break;heap[i]=heap[j];i=j;}heap[i]=tail;return first;}
    for(const i of start){dist[i]=0;put(i,0);}
    let finish=-1;
    while(heap.length){
      const [d,u]=pop();if(d!==dist[u])continue;
      const pt=nodes[u].p;
      if(Math.abs(pt[0]-east)<.06){finish=u;break;}
      for(const ei of nodes[u].links){
        const edge=edges[ei],v=edge.u===u?edge.v:edge.u;
        // Der Zielpfad darf aus echten Sihl-Segmenten und unbeschrifteten
        // Anschlussteilen bestehen. Fremdbezeichnete Gewässer sind ausgeschlossen.
        // Benannte bzw. über Gewässerkennung bestätigte Sihl erhält Vorrang.
        const confidence=edge.source==='known'?1:edge.named?1.02:edge.matchedRoute?1.12:2.8;
        const backwardPenalty=nodes[v].p[0]<pt[0]-12?1.6:1;
        const candidate=d+edge.length*confidence*backwardPenalty;
        if(candidate<dist[v]){dist[v]=candidate;prev[v]=u;prevEdge[v]=ei;put(v,candidate);}
      }
    }
    if(finish<0)return {lines:[],reason:'Schwyzer Netz reicht geometrisch nicht verbunden bis an den Ostrand',connected:false};
    const trail=[];let cur=finish;
    for(let safety=0;prev[cur]>=0&&safety<edges.length;safety++){
      const edge=edges[prevEdge[cur]],parent=prev[cur];
      if(edge.source==='schwyz')trail.push(edge.u===parent?[edge.a,edge.b]:[edge.b,edge.a]);
      cur=parent;
    }
    trail.reverse();
    if(!trail.length)return {lines:[],reason:'keine zusätzlichen Schwyzer Sihl-Stücke benötigt',connected:true};
    // Kontinuierliche Segmente zusammensetzen, ohne zwischen entfernten
    // Punkten künstliche Linie zu zeichnen.
    const lines=[];let segment=[];
    for(const pair of trail){
      if(!segment.length)segment=[pair[0],pair[1]];
      else if(Math.hypot(segment.at(-1)[0]-pair[0][0],segment.at(-1)[1]-pair[0][1])<.02)segment.push(pair[1]);
      else{lines.push(segment);segment=[pair[0],pair[1]];}
    }
    if(segment.length>1)lines.push(segment);
    return {lines,reason:`Sihl-Anschluss bis zum Ostrand: ${trail.length} amtliche Schwyzer Liniensegmente`,connected:true};
  }
  async function fetchSchwyzSihl(bbox,knownSihl=[],mapBbox=bbox){
    const pageSize=1200,maxPages=12;
    const requests=[
      {VERSION:'2.0.0',TYPENAMES:SIHL_SZ_TYPENAME,OUTPUTFORMAT:'application/json',COUNT:String(pageSize)},
      {VERSION:'2.0.0',TYPENAMES:SIHL_SZ_TYPENAME,OUTPUTFORMAT:'geojson',COUNT:String(pageSize)},
      {VERSION:'1.0.0',TYPENAME:SIHL_SZ_TYPENAME,OUTPUTFORMAT:'application/json',MAXFEATURES:String(pageSize)}
    ];
    let lastError=null;
    for(const config of requests){
      try{
        const features=[];let previousSignature=null;
        for(let page=0;page<maxPages;page++){
          const query=new URLSearchParams({SERVICE:'WFS',REQUEST:'GetFeature',SRSNAME:'EPSG:2056',BBOX:bboxQuery(bbox),...config});
          if(config.VERSION==='2.0.0')query.set('STARTINDEX',String(page*pageSize));
          const body=await getText(`${SIHL_SZ_WFS}?${query.toString()}`);
          const json=JSON.parse(body);
          if(json?.type!=='FeatureCollection'||!Array.isArray(json.features))throw Error('Schwyzer WFS: kein gültiges GeoJSON.');
          const signature=JSON.stringify([json.features.length,json.features[0]?.id,json.features[0]?.geometry?.coordinates?.[0],json.features.at(-1)?.id]);
          if(signature===previousSignature)break;
          previousSignature=signature;features.push(...json.features);
          const numberMatched=Number(json.numberMatched);
          if(config.VERSION==='1.0.0'||json.features.length<pageSize||
             (Number.isFinite(numberMatched)&&(page+1)*pageSize>=numberMatched))break;
          if(page===maxPages-1)throw Error('Schwyzer WFS: zu viele Gewässerobjekte im Kartenausschnitt.');
        }
        const strictlyNamed=onlySihlFromSchwyz(features,bbox);
        // Der Schwyzer WFS hat oft nicht auf jedem Routenstück ein Namensfeld.
        // Zuerst echte Verbindung aus diesem Netz prüfen. Ausschliesslich die
        // im geprüften EINEN Hauptpfad liegenden Schwyzer Geometrien übernehmen.
        const reconstructed=sihlMainStemFromNetwork(knownSihl,features,mapBbox);
        if(reconstructed.connected&&reconstructed.lines.length){
          return [{name:'Sihl',geometry:{type:'MultiLineString',coordinates:reconstructed.lines},id:null,
                   source:'Kanton Schwyz · geprüfter Hauptlauf'}];
        }
        return strictlyNamed;
      }catch(error){lastError=error;}
    }
    throw Error('Schwyzer Sihl-WFS: '+(lastError?.message||'nicht erreichbar'));
  }
  // Krebsbach wird nur dargestellt, wenn ein amtlich belegter, geometrisch
  // zusammenhaengender Linienpfad die Grenze des Huettensees mit dem Zuerichsee
  // oder der tatsächlichen CSV-Kartengrenze verbindet. Niemals Luecken zeichnen.
  // Die uebrigen Gewaesser sind von diesem Filter AUSGENOMMEN.
  function pointToLineDistance(p,coords){
    let best=Infinity;
    for(let i=1;i<coords.length;i++){
      const a=coords[i-1],b=coords[i],dx=b[0]-a[0],dy=b[1]-a[1],den=dx*dx+dy*dy;
      const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/den)):0;
      best=Math.min(best,Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy));
    }
    return best;
  }
  function shoreDistance(p,items){
    let best=Infinity;
    for(const item of items){
      const g=item.geometry||item;
      if(!g)continue;
      const polys=g.type==='Polygon'?[g.coordinates]:g.type==='MultiPolygon'?g.coordinates:[];
      for(const poly of polys)for(const ring of poly)best=Math.min(best,pointToLineDistance(p,ring));
    }
    return best;
  }
  // Liang–Barsky clips REAL official segments, never adds a synthetic section.
  function clipSegmentToBox(a,b,box){
    const dx=b[0]-a[0],dy=b[1]-a[1],p=[-dx,dx,-dy,dy];
    const q=[a[0]-box[0],box[2]-a[0],a[1]-box[1],box[3]-a[1]];
    let lo=0,hi=1;
    for(let i=0;i<4;i++){
      if(Math.abs(p[i])<1e-12){if(q[i]<0)return null;continue;}
      const t=q[i]/p[i];
      if(p[i]<0)lo=Math.max(lo,t);else hi=Math.min(hi,t);
      if(lo>hi)return null;
    }
    const at=t=>[a[0]+dx*t,a[1]+dy*t];
    return [at(lo),at(hi)];
  }
  function clipPolylineToBox(coords,box){
    const parts=[];let current=[];
    const flush=()=>{if(current.length>=2)parts.push(current);current=[];};
    for(let i=1;i<coords.length;i++){
      const seg=clipSegmentToBox(coords[i-1],coords[i],box);
      if(!seg||equalPoint(seg[0],seg[1])){flush();continue;}
      if(current.length && Math.hypot(current.at(-1)[0]-seg[0][0],current.at(-1)[1]-seg[0][1])>1e-5)flush();
      if(!current.length)current.push(seg[0]);
      current.push(seg[1]);
    }
    flush();return parts;
  }
  function boxDistance(p,b){return Math.min(Math.abs(p[0]-b[0]),Math.abs(p[0]-b[2]),Math.abs(p[1]-b[1]),Math.abs(p[1]-b[3]));}
  function certifyKrebsbachRoute(data,mapBbox){
    const candidates=data.streams.filter(s=>s.name==='Krebsbach');
    const without=data.streams.filter(s=>s.name!=='Krebsbach');
    const sourceLakes=data.lakes.filter(s=>s.name==='Hüttenersee');
    const targetLakes=data.lakes.filter(s=>s.name==='Zürichsee');
    // Endpunkte muessen wirklich an der amtlichen Uferlinie liegen.
    // Der 2-m-Toleranzbereich erfasst nur Vermessungsrundungen, keine fehlenden Bachstuecke.
    const shoreTolerance=2, junctionTolerance=2;
    const edges=[];
    for(const s of candidates){
      const lines=s.geometry.type==='LineString'?[s.geometry.coordinates]:s.geometry.type==='MultiLineString'?s.geometry.coordinates:[];
      for(const line of lines)for(const part of clipPolylineToBox(line,mapBbox)){
        if(part.length>=2)edges.push({source:s,coords:part,ends:[-1,-1]});
      }
    }
    const vertices=[];
    function node(pt){
      for(let i=0;i<vertices.length;i++){
        const p=vertices[i].point;
        if(Math.hypot(p[0]-pt[0],p[1]-pt[1])<=junctionTolerance)return i;
      }
      vertices.push({point:pt,edges:[]});return vertices.length-1;
    }
    for(let k=0;k<edges.length;k++){
      const edge=edges[k];edge.ends=[node(edge.coords[0]),node(edge.coords.at(-1))];
      for(const id of edge.ends)vertices[id].edges.push(k);
    }
    const start=vertices.map((v,i)=>i).filter(i=>shoreDistance(vertices[i].point,sourceLakes)<=shoreTolerance);
    const byLake=vertices.map((v,i)=>i).filter(i=>shoreDistance(vertices[i].point,targetLakes)<=shoreTolerance);
    const byBorder=vertices.map((v,i)=>i).filter(i=>boxDistance(vertices[i].point,mapBbox)<1e-4);
    const distances=new Map(),prev=new Map();let queue=[];
    for(const id of start){distances.set(id,0);queue.push(id);}
    // BFS over proven, *named Krebsbach* segments ONLY. No invented connectors,
    // no spatial routing via Chrebsbach, other streams or empty areas.
    while(queue.length){
      const v=queue.shift();
      for(const edgeIdx of vertices[v].edges){
        const edge=edges[edgeIdx],u=edge.ends[0]===v?edge.ends[1]:edge.ends[0];
        if(distances.has(u))continue;
        distances.set(u,distances.get(v)+1);prev.set(u,{from:v,edgeIdx});queue.push(u);
      }
    }
    // Priority: actual Zurichsee shoreline first, map boundary otherwise.
    const reachable=ids=>ids.filter(i=>distances.has(i) && !start.includes(i)).sort((a,b)=>distances.get(a)-distances.get(b));
    const shoreEnd=reachable(byLake)[0], borderEnd=reachable(byBorder)[0];
    const end=shoreEnd===undefined?borderEnd:shoreEnd;
    const chosen=[];
    if(end!==undefined){let at=end;while(prev.has(at)){
      const item=prev.get(at);chosen.push(edges[item.edgeIdx]);at=item.from;
    }}
    const kept=chosen.map(edge=>({name:'Krebsbach',id:edge.source.id,source:edge.source.source,geometry:{type:'LineString',coordinates:edge.coords}}));
    data.streams=without.concat(kept);
    data.krebsbachRoute={
      state:!sourceLakes.length?'Hüttenersee-Geometrie fehlt':
        !edges.length?'Keine amtlichen Krebsbach-Linien':!start.length?'Krebsbach-Anschluss am Hüttenersee nicht nachgewiesen':
        end===undefined?'Unvollständiger Krebsbach: weder Zürichsee noch Kartengrenze erreicht':
        shoreEnd!==undefined?'Bis Zürichsee belegt':'Bis Kartengrenze belegt',
      complete:end!==undefined,
      destination:shoreEnd!==undefined?'Zürichsee':borderEnd!==undefined?'Kartengrenze':null,
      pieces:kept.length,excluded:candidates.length-kept.length
    };
    data.found=STREAM_CATALOG.filter(item=>data.streams.some(s=>s.name===item.name)).map(item=>item.name);
    data.unresolvedStreams=STREAM_CATALOG.filter(item=>!data.found.includes(item.name)).map(item=>item.name);
    data.fullRoutes=STREAM_CATALOG.filter(item=>data.streams.some(s=>s.name===item.name&&s.source==='full-route')).map(item=>item.name);
    return data;
  }
  // Sihl-only path certification. Every edge comes from an official segment
  // whose name is exactly Sihl. Neither other streams nor interpolated edges
  // are allowed. Clip the surveyed geometry to the original layout boundaries.
  function certifySihlAcrossMap(data,bbox){
    const rivers=(data.streams||[]).filter(s=>s.name==='Sihl');
    const result={complete:false,state:'Sihl: nicht beide Kartenränder nachgewiesen',
      officialPieces:rivers.length,edges:0,sides:[],routeEdges:0};
    if(!rivers.length){result.state='Sihl: keine amtliche Liniengeometrie geliefert';data.sihlCoverage=result;return result;}
    const [west,south,east,north]=bbox;
    const tol=6.0,bin=6.0,nodes=[],buckets=new Map(),edges=[];
    function bucketKey(ix,iy){return `${ix}:${iy}`;}
    function nodeFor(p){
      const ix=Math.floor(p[0]/bin),iy=Math.floor(p[1]/bin);
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
        for(const index of buckets.get(bucketKey(ix+dx,iy+dy))||[]){
          const q=nodes[index].point;
          if(Math.hypot(q[0]-p[0],q[1]-p[1])<=tol)return index;
        }
      }
      const id=nodes.length;nodes.push({point:p,links:[]});
      const key=bucketKey(ix,iy);
      if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(id);
      return id;
    }
    for(const stream of rivers){
      const geom=stream.geometry;
      if(!geom||!['LineString','MultiLineString'].includes(geom.type))continue;
      const lines=geom.type==='LineString'?[geom.coordinates]:geom.coordinates;
      for(const line of lines){
        if(!Array.isArray(line)||line.length<2)continue;
        for(const piece of clipPolylineToBox(line,bbox)){
          for(let i=1;i<piece.length;i++){
            const a=piece[i-1],b=piece[i];
            if(Math.hypot(b[0]-a[0],b[1]-a[1])<.001)continue;
            const from=nodeFor(a),to=nodeFor(b);
            if(from===to)continue;
            const id=edges.length;
            edges.push({from,to,a,b});
            nodes[from].links.push(id);nodes[to].links.push(id);
          }
        }
      }
    }
    result.edges=edges.length;
    if(!edges.length){data.sihlCoverage=result;return result;}
    const sides=p=>{
      const found=[];
      if(Math.abs(p[0]-west)<.02)found.push('West');
      if(Math.abs(p[0]-east)<.02)found.push('Ost');
      if(Math.abs(p[1]-south)<.02)found.push('Süd');
      if(Math.abs(p[1]-north)<.02)found.push('Nord');
      return found;
    };
    // Find connected components first; a complete Sihl must reach TWO
    // distinct map edges in ONE actual hydrological line network.
    const visited=new Set();let winner=null;
    for(let first=0;first<nodes.length;first++){
      if(visited.has(first)||!nodes[first].links.length)continue;
      const queue=[first],component=[];visited.add(first);
      for(let cursor=0;cursor<queue.length;cursor++){
        const v=queue[cursor];component.push(v);
        for(const ei of nodes[v].links){
          const e=edges[ei],other=e.from===v?e.to:e.from;
          if(!visited.has(other)){visited.add(other);queue.push(other);}
        }
      }
      const boundary=component.flatMap(index=>sides(nodes[index].point).map(side=>({index,side})));
      if(boundary.length<2)continue;
      // Most separated pair, on distinct edges; corner-only contacts do not count.
      let best=null;
      for(let i=0;i<boundary.length;i++)for(let j=i+1;j<boundary.length;j++){
        const a=boundary[i],b=boundary[j];
        if(a.side===b.side||a.index===b.index||!([a.side,b.side].includes('Ost')))continue;
        const p=nodes[a.index].point,q=nodes[b.index].point;
        const dist=Math.hypot(p[0]-q[0],p[1]-q[1]);
        if(dist<tol*3)continue;
        if(!best||dist>best.dist)best={a,b,dist};
      }
      if(best && (!winner||best.dist>winner.dist))winner=best;
    }
    if(!winner){
      const allSides=[...new Set(nodes.flatMap(n=>sides(n.point)))];
      result.sides=allSides;
      result.state=`Sihl: ${allSides.length?allSides.join('/'):'kein Kartenrand'} erreicht; durchgehende Linie bis zum östlichen Kartenrand noch nicht belegt`;
      data.sihlCoverage=result;
      return result;
    }
    // Reconstruct a connected path from actually existing segments only.
    const from=winner.a.index,to=winner.b.index;
    const pending=[from],seen=new Set([from]),prev=new Map();
    for(let index=0;index<pending.length && !seen.has(to);index++){
      const v=pending[index];
      for(const ei of nodes[v].links){
        const edge=edges[ei],next=edge.from===v?edge.to:edge.from;
        if(seen.has(next))continue;
        seen.add(next);prev.set(next,{parent:v,ei});pending.push(next);
      }
    }
    if(!seen.has(to)){data.sihlCoverage=result;return result;}
    const pieces=[];let n=to;
    while(n!==from){
      const step=prev.get(n);if(!step)break;
      const e=edges[step.ei];
      pieces.push(e.from===step.parent?[e.a,e.b]:[e.b,e.a]);
      n=step.parent;
    }
    pieces.reverse();
    result.complete=true;result.routeEdges=pieces.length;
    result.sides=[winner.a.side,winner.b.side];
    result.state=`Sihl vollständig: ${result.sides.join('–')} (amtliche Linien bis an beide Kartenränder)`;
    // Only the Sihl illustration is consolidated. All OTHER water bodies are untouched.
    // Keep each real surveyed segment instead of fabricating bridge geometry.
    const refined={name:'Sihl',source:'kartengrenzen-geprüfte Sihl',id:null,
      geometry:{type:'MultiLineString',coordinates:pieces}};
    data.streams=[...data.streams.filter(s=>s.name!=='Sihl'),refined];
    data.sihlCoverage=result;
    data.sihlSegments=1;
    return result;
  }
  // Symbol width scaled to the render resolution. For 1400px preview it is
  // ~4.3px, visibly stronger than a 1.7px creek; export scales proportionally.
  function sihlStrokeWidth(w,h){return Math.max(3.6,Math.min(12,Math.max(w,h)*.0031));}
  function geomOf(item){return item?.geometry||item;}
  function allCoords(geom){
    if(geom.type==='Polygon')return [geom.coordinates];
    if(geom.type==='MultiPolygon')return geom.coordinates;
    if(geom.type==='LineString')return [[geom.coordinates]];
    if(geom.type==='MultiLineString')return geom.coordinates.map(v=>[v]);
    return [];
  }
  function path(geom,bbox,w,h){
    const [west,south,east,north]=bbox;let d='';
    for(const poly of allCoords(geom))for(const ring of poly){
      if(!Array.isArray(ring)||ring.length<2)continue;
      for(let i=0;i<ring.length;i++){
        const point=ring[i];if(!Number.isFinite(point?.[0])||!Number.isFinite(point?.[1]))continue;
        const x=(point[0]-west)/(east-west)*w,y=(north-point[1])/(north-south)*h;
        d+=`${i?'L':'M'}${x.toFixed(2)} ${y.toFixed(2)} `;
      }
      if(/Polygon/.test(geom.type))d+='Z ';
    }
    return d;
  }
  // Genau eine Zeichenkorrektur im bestehenden Reliefausschnitt.
  // Die zwei auf dem vom Nutzer gelieferten Kartenbild sichtbaren Sihl-Enden
  // werden unmittelbar miteinander verbunden. Keine Daten-/Namenssuche,
  // keine Erweiterung anderer Gewässer, keine Kantonslogik.
  const SIHL_PICTURE_BBOX=[2688195.741,1223420.776,2696260.006,1235210.135];
  const SIHL_GAP_WEST=[2695413.86,1225970.92];
  const SIHL_GAP_EAST=[2695540.50,1225919.11];
  function sihlGapBridge(data,bbox){
    if(!Array.isArray(bbox)||bbox.length!==4 ||
      !bbox.every((n,i)=>Math.abs(n-SIHL_PICTURE_BBOX[i])<3))return null;
    const endpoints=[];
    const rivers=(data?.streams||[]).filter(s=>s.name==='Sihl');
    for(const river of rivers){
      const geom=river.geometry;
      if(!geom||!['LineString','MultiLineString'].includes(geom.type))continue;
      const lines=geom.type==='LineString'?[geom.coordinates]:geom.coordinates;
      for(const line of lines){
        if(!Array.isArray(line)||line.length<2)continue;
        endpoints.push({at:line[0],inside:line[1]});
        endpoints.push({at:line.at(-1),inside:line.at(-2)});
      }
    }
    const dist=(a,b)=>Math.hypot(a[0]-b[0],a[1]-b[1]);
    const best=target=>endpoints.map(v=>({...v,d:dist(v.at,target)}))
       .filter(v=>v.d<85).sort((a,b)=>a.d-b.d)[0];
    const left=best(SIHL_GAP_WEST),right=best(SIHL_GAP_EAST);
    if(!left||!right||left===right)return null;
    const L=left.at,R=right.at,d=dist(L,R);
    // Nur die gezeigte 120-m-Unterbrechung, keine globalen Bach-Verknüpfungen.
    if(d<25||d>250||R[0]<=L[0])return null;
    // Bei bereits geschlossenem Verlauf nichts überzeichnen.
    const center=[(L[0]+R[0])/2,(L[1]+R[1])/2];
    const pointSeg=(p,a,b)=>{
      const vx=b[0]-a[0],vy=b[1]-a[1],den=vx*vx+vy*vy;
      const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/den)):0;
      return Math.hypot(p[0]-(a[0]+t*vx),p[1]-(a[1]+t*vy));
    };
    for(const stream of rivers){
      const g=stream.geometry,lines=g.type==='LineString'?[g.coordinates]:g.type==='MultiLineString'?g.coordinates:[];
      for(const line of lines){
        for(let i=1;i<line.length;i++) if(pointSeg(center,line[i-1],line[i])<12)return null;
      }
    }
    const tangent=(outer,inside)=>{
      const a=[outer[0]-inside[0],outer[1]-inside[1]],len=Math.hypot(...a);
      return len>1?[a[0]/len,a[1]/len]:[(R[0]-L[0])/d,(R[1]-L[1])/d];
    };
    const t0=tangent(L,left.inside),t1=tangent(R,right.inside);
    const c1=[L[0]+t0[0]*d*.30,L[1]+t0[1]*d*.30];
    const c2=[R[0]+t1[0]*d*.30,R[1]+t1[1]*d*.30];
    const coords=[];
    for(let i=0;i<=12;i++){
      const t=i/12,u=1-t;
      coords.push([
        u*u*u*L[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*R[0],
        u*u*u*L[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*R[1]
      ]);
    }
    return {type:'LineString',coordinates:coords};
  }

  function renderSVG(data,bbox,w,h){
    const lines=[];
    for(const lake of (data.lakes||[]).filter(v=>ALLOWED_WATERBODIES.has(v.name)))lines.push(`<path class="waterLake" fill-rule="evenodd" d="${path(geomOf(lake),bbox,w,h)}"/>`);
    for(const shore of data.shores)lines.push(`<path class="waterShore" d="${path(geomOf(shore),bbox,w,h)}"/>`);
    // Only requested small pond shorelines, not all ponds and reservoirs.
    for(const shore of (data.pondShore||[]).filter(v=>ALLOWED_PONDS.has(v.name)))lines.push(`<path class="waterShore" d="${path(shore.geometry,bbox,w,h)}"/>`);
    for(const s of (data.streams||[]).filter(v=>ALLOWED_STREAMS.has(v.name)&&v.name!=='Sihl'))lines.push(`<path class="waterStream" d="${path(s.geometry,bbox,w,h)}"/>`);
    for(const s of (data.streams||[]).filter(v=>v.name==='Sihl'))lines.push(`<path class="waterSihl" stroke-width="${sihlStrokeWidth(w,h).toFixed(2)}" d="${path(s.geometry,bbox,w,h)}"/>`);
    const bridge=sihlGapBridge(data,bbox);
    if(bridge)lines.push(`<path class="waterSihl" stroke-width="${sihlStrokeWidth(w,h).toFixed(2)}" d="${path(bridge,bbox,w,h)}"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${lines.join('')}</svg>`;
  }
  function paintCanvas(ctx,data,bbox,w,h){
    ctx.save();ctx.lineJoin='round';ctx.lineCap='round';
    for(const lake of (data.lakes||[]).filter(v=>ALLOWED_WATERBODIES.has(v.name))){const p=new Path2D(path(geomOf(lake),bbox,w,h));ctx.fillStyle='#92c6e3';ctx.fill(p,'evenodd');ctx.lineWidth=1.4;ctx.strokeStyle='#397da3';ctx.stroke(p);}
    for(const shore of data.shores){const p=new Path2D(path(geomOf(shore),bbox,w,h));ctx.lineWidth=1.6;ctx.strokeStyle='#397da3';ctx.stroke(p);}
    for(const shore of (data.pondShore||[]).filter(v=>ALLOWED_PONDS.has(v.name))){const p=new Path2D(path(shore.geometry,bbox,w,h));ctx.lineWidth=1.6;ctx.strokeStyle='#397da3';ctx.stroke(p);}
    for(const s of (data.streams||[]).filter(v=>ALLOWED_STREAMS.has(v.name)&&v.name!=='Sihl')){const p=new Path2D(path(s.geometry,bbox,w,h));ctx.lineWidth=1.7;ctx.strokeStyle='#367fb2';ctx.stroke(p);}
    for(const s of (data.streams||[]).filter(v=>v.name==='Sihl')){const p=new Path2D(path(s.geometry,bbox,w,h));ctx.lineWidth=sihlStrokeWidth(w,h);ctx.strokeStyle='#367fb2';ctx.stroke(p);}
    const bridge=sihlGapBridge(data,bbox);
    if(bridge){const p=new Path2D(path(bridge,bbox,w,h));ctx.lineWidth=sihlStrokeWidth(w,h);ctx.strokeStyle='#367fb2';ctx.stroke(p);}
    ctx.restore();
  }
  const api={VERSION,SOURCE,STREAM_CATALOG,POND_CATALOG,ALLOWED_STREAMS,ALLOWED_PONDS,ALLOWED_WATERBODIES,DESIRED,OTHER,clean,names,nameFor,pondNameFor,canonicalId,layerTypes,fromGeojson,combine,assessMuelibachMouth,fetchOfficial,fetchKrebsbachTranscantonal,namedKrebsbachFeatures,fetchSupplemental,fetchSwissSihl,fillSihlGaps,swisstopoResultFeatures,normalizedGwlNumber,fetchSchwyzSihl,onlySihlFromSchwyz,sihlMainStemFromNetwork,certifyKrebsbachRoute,clipPolylineToBox,renderSVG,paintCanvas,trimStreamsAtWater,trimStreamGeometry,waterPolygons,pointInWater,certifySihlAcrossMap,sihlStrokeWidth,sihlGapBridge};
  root.GrossreliefHydro=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);

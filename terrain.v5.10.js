'use strict';
/* Relief terrain projection. Local STL data only; no remote services.
   Assumes projector lens centred above relief and vertically aligned.
   Existing four-corner homography continues to define the base plane. */
(function(root){
  const VERSION='5.10';
  function readSTL(arrayBuffer){
    if(!(arrayBuffer instanceof ArrayBuffer)||arrayBuffer.byteLength<84)throw Error('STL-Datei ist leer oder beschädigt.');
    const view=new DataView(arrayBuffer),count=view.getUint32(80,true);
    if(count && count<=2500000 && 84+count*50===arrayBuffer.byteLength){
      return {count,triangle(i){const p=84+i*50+12;return [view.getFloat32(p,true),view.getFloat32(p+4,true),view.getFloat32(p+8,true),view.getFloat32(p+12,true),view.getFloat32(p+16,true),view.getFloat32(p+20,true),view.getFloat32(p+24,true),view.getFloat32(p+28,true),view.getFloat32(p+32,true)];}};
    }
    const text=new TextDecoder('utf-8').decode(arrayBuffer);
    if(!/^\s*solid\b/i.test(text))throw Error('Unbekanntes STL-Format.');
    const values=[];const re=/\bvertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/gi;
    let match;
    while((match=re.exec(text))!==null){values.push(Number(match[1]),Number(match[2]),Number(match[3]));if(values.length>7500000)throw Error('STL zu gross.');}
    if(values.length<9||values.length%9)throw Error('ASCII-STL enthält keine vollständigen Dreiecke.');
    return {count:values.length/9,triangle(i){return values.slice(i*9,i*9+9);}};
  }
  function bounds(stl){
    const b={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity,minZ:Infinity,maxZ:-Infinity};
    for(let i=0;i<stl.count;i++){
      const a=stl.triangle(i);
      for(let j=0;j<9;j+=3){const x=a[j],y=a[j+1],z=a[j+2];
        if(![x,y,z].every(Number.isFinite))throw Error('STL enthält ungültige Koordinaten.');
        b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);
        b.minY=Math.min(b.minY,y);b.maxY=Math.max(b.maxY,y);
        b.minZ=Math.min(b.minZ,z);b.maxZ=Math.max(b.maxZ,z);
      }
    }
    if(b.maxX-b.minX<1||b.maxY-b.minY<1)throw Error('STL besitzt keine nutzbare Reliefoberfläche.');
    return b;
  }
  function segmentsFromCsv(csv,layout){
    const lines=csv.trim().replace(/^\uFEFF/,'').split(/\r?\n/);
    const delimiter=(lines[0].match(/;/g)||[]).length>=(lines[0].match(/,/g)||[]).length?';':',';
    const headers=lines.shift().split(delimiter).map(v=>v.trim());
    const rows=lines.filter(Boolean).map(line=>Object.fromEntries(line.split(delimiter).map((v,i)=>[headers[i],v.trim()])));
    if(rows.length!==layout.segments)throw Error('STL-Zuordnung: CSV-Segmentzahl stimmt nicht.');
    const colWidths=new Map(),rowDepths=new Map();
    for(const row of rows){colWidths.set(+row.col,+row.width_mm);rowDepths.set(+row.row,+row.depth_mm);}
    const cells=[];
    for(const row of rows){
      let offX=0,offY=0;for(let i=1;i<+row.col;i++)offX+=colWidths.get(i)||0;
      for(let i=1;i<+row.row;i++)offY+=rowDepths.get(i)||0;
      cells.push({name:row.filename,width:+row.width_mm,depth:+row.depth_mm,offX,offY});
    }
    return cells;
  }
  function closeSize(b,width,depth){
    const x=b.maxX-b.minX,y=b.maxY-b.minY;
    return Math.abs(x/width-1)<.06&&Math.abs(y/depth-1)<.06;
  }
  function rasterize(parsed,layout){
    const W=layout.model_width_mm,D=layout.model_depth_mm;
    const cols=54,rows=Math.round(cols*D/W);
    const nx=cols+1, ny=rows+1,values=new Float32Array(nx*ny);
    values.fill(-Infinity);let minZ=Infinity,maxZ=-Infinity;
    for(const {mesh,bounds:b,cell} of parsed){
      minZ=Math.min(minZ,b.minZ);maxZ=Math.max(maxZ,b.maxZ);
      for(let i=0;i<mesh.count;i++){
        const tri=mesh.triangle(i),p=[];
        for(let k=0;k<9;k+=3){
          const x=cell.offX+(tri[k]-b.minX)/(b.maxX-b.minX)*cell.width;
          const y=cell.offY+(b.maxY-tri[k+1])/(b.maxY-b.minY)*cell.depth;
          p.push([x/W*cols,y/D*rows,tri[k+2]]);
        }
        const [a,c,d]=p;
        const det=(c[1]-d[1])*(a[0]-d[0])+(d[0]-c[0])*(a[1]-d[1]);
        if(Math.abs(det)<1e-9)continue;
        const left=Math.max(0,Math.ceil(Math.min(...p.map(v=>v[0]))-1e-6));
        const right=Math.min(cols,Math.floor(Math.max(...p.map(v=>v[0]))+1e-6));
        const top=Math.max(0,Math.ceil(Math.min(...p.map(v=>v[1]))-1e-6));
        const bottom=Math.min(rows,Math.floor(Math.max(...p.map(v=>v[1]))+1e-6));
        for(let iy=top;iy<=bottom;iy++)for(let ix=left;ix<=right;ix++){
          const u=((c[1]-d[1])*(ix-d[0])+(d[0]-c[0])*(iy-d[1]))/det;
          const v=((d[1]-a[1])*(ix-d[0])+(a[0]-d[0])*(iy-d[1]))/det;
          if(u<-.00001||v<-.00001||u+v>1.00001)continue;
          const z=u*a[2]+v*c[2]+(1-u-v)*d[2];
          const index=iy*nx+ix;values[index]=Math.max(values[index],z);
        }
      }
    }
    let missing=0;for(const z of values)if(!Number.isFinite(z))missing++;
    if(missing>values.length*.035)throw Error(`STL deckt nur ${Math.round((1-missing/values.length)*100)} % der Reliefoberfläche ab. Bitte alle passenden Segment-STLs wählen.`);
    // At most a few isolated seam/border nodes. Never fill large missing regions.
    for(let pass=0;pass<3;pass++){
      let updates=0;
      for(let iy=0;iy<=rows;iy++)for(let ix=0;ix<=cols;ix++){
        const ind=iy*nx+ix;if(Number.isFinite(values[ind]))continue;
        const near=[];
        for(const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]){
          const xx=ix+dx,yy=iy+dy;
          if(xx<0||xx>cols||yy<0||yy>rows)continue;
          const h=values[yy*nx+xx];if(Number.isFinite(h))near.push(h);
        }
        if(near.length>=2){values[ind]=near.reduce((s,v)=>s+v,0)/near.length;updates++;}
      }
      if(!updates)break;
    }
    if(values.some(z=>!Number.isFinite(z)))throw Error('Höhenraster besitzt Lücken. Bitte vollständiges Relief-STL laden.');
    for(let i=0;i<values.length;i++)values[i]=Math.max(0,values[i]-minZ);
    return {cols,rows,values,minZ,maxHeightMm:maxZ-minZ,widthMm:W,depthMm:D,partCount:parsed.length};
  }
  async function load(files,csv,layout){
    if(!layout||!csv)throw Error('Für 3D zuerst layout.csv laden.');
    const input=[...files];if(!input.length)throw Error('Bitte STL-Dateien auswählen.');
    if(input.some(f=>f.size>160*1024*1024))throw Error('Einzelne STL-Datei überschreitet 160 MB.');
    const cells=segmentsFromCsv(csv,layout);
    let specs=[];
    if(input.length===1){
      const mesh=readSTL(await input[0].arrayBuffer()),b=bounds(mesh);
      if(layout.segments===1){
        if(!closeSize(b,cells[0].width,cells[0].depth))throw Error('STL-Abmessungen passen nicht zum CSV-Segment.');
        specs=[{mesh,bounds:b,cell:cells[0]}];
      }else{
        if(!closeSize(b,layout.model_width_mm,layout.model_depth_mm))throw Error('Für dieses mehrteilige Relief bitte sämtliche Segment-STLs gemeinsam hochladen (oder ein STL des kompletten Reliefs).');
        specs=[{mesh,bounds:b,cell:{offX:0,offY:0,width:layout.model_width_mm,depth:layout.model_depth_mm}}];
      }
    }else{
      if(input.length!==cells.length)throw Error(`Bitte alle ${cells.length} STL-Segmente gemeinsam auswählen.`);
      for(const cell of cells){
        const file=input.find(f=>f.name.toLowerCase()===cell.name.toLowerCase());
        if(!file)throw Error(`STL-Segment fehlt: ${cell.name}`);
        const mesh=readSTL(await file.arrayBuffer()),b=bounds(mesh);
        if(!closeSize(b,cell.width,cell.depth))throw Error(`STL-Grösse passt nicht zu ${cell.name}.`);
        specs.push({mesh,bounds:b,cell});
      }
    }
    return rasterize(specs,layout);
  }
  // Compact terrain representation: precisely the Float32 height grid that
  // this version uses for projection. STL triangles do not belong on Pages.
  function serializeHeightmap(model,layout){
    if(!model||!layout||!(model.values instanceof Float32Array))throw Error('Zuerst die STL des Reliefs laden.');
    if(model.values.length!==(model.cols+1)*(model.rows+1))throw Error('Ungültiges Höhenraster.');
    if(Math.abs(model.widthMm-layout.model_width_mm)>.05||Math.abs(model.depthMm-layout.model_depth_mm)>.05)throw Error('Das Höhenmodell passt nicht zur layout.csv.');
    const file={schema:'grossrelief-heightmap-v1',
      bbox_lv95:layout.bbox_lv95,
      model_width_mm:model.widthMm,model_depth_mm:model.depthMm,
      cols:model.cols,rows:model.rows,
      max_height_mm:model.maxHeightMm,part_count:model.partCount,
      projection_reference_mm:referencePlaneMm(model),
      values_mm:Array.from(model.values,v=>Math.round(v*10000)/10000)};
    return JSON.stringify(file);
  }
  function parseHeightmap(text,layout){
    if(!layout)throw Error('Zuerst layout.csv laden.');
    if(typeof text!=='string'||text.length>2000000)throw Error('Ungültige oder zu grosse Höhenrasterdatei.');
    let obj;try{obj=JSON.parse(text);}catch(e){throw Error('Höhenraster ist kein gültiges JSON.');}
    if(obj?.schema!=='grossrelief-heightmap-v1')throw Error('Höhenraster hat ein unbekanntes Dateiformat.');
    if(!Array.isArray(obj.bbox_lv95)||obj.bbox_lv95.length!==4||obj.bbox_lv95.some((v,i)=>!Number.isFinite(v)||Math.abs(v-layout.bbox_lv95[i])>.03))throw Error('Höhenraster passt nicht zu den LV95-Kartengrenzen dieser layout.csv.');
    if(Math.abs(Number(obj.model_width_mm)-layout.model_width_mm)>.05||Math.abs(Number(obj.model_depth_mm)-layout.model_depth_mm)>.05)throw Error('Höhenraster passt nicht zu den gedruckten Reliefmassen.');
    const cols=obj.cols,rows=obj.rows;
    if(!Number.isInteger(cols)||!Number.isInteger(rows)||cols<4||rows<4||cols>4096||rows>4096||(cols+1)*(rows+1)>120000)throw Error('Ungültige Höhenrasterauflösung.');
    if(!Array.isArray(obj.values_mm)||obj.values_mm.length!==(cols+1)*(rows+1))throw Error('Höhenraster enthält nicht genügend Höhenpunkte.');
    if(!Number.isFinite(obj.max_height_mm)||obj.max_height_mm<0||obj.max_height_mm>1000)throw Error('Ungültige maximale Reliefhöhe.');
    if(obj.values_mm.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<-.0001||v>obj.max_height_mm+1))throw Error('Höhenraster enthält ungültige Werte.');
    return {cols,rows,values:Float32Array.from(obj.values_mm),minZ:0,maxHeightMm:obj.max_height_mm,
      widthMm:Number(obj.model_width_mm),depthMm:Number(obj.model_depth_mm),partCount:obj.part_count||layout.segments,
      projectionReferenceMm:Number.isFinite(obj.projection_reference_mm)?obj.projection_reference_mm:undefined};
  }
  // The reference plane for our optical calibration is the visible lowest
  // broad, flat relief surface (Zürichsee), not the hidden underside of the STL.
  // A 2%-quantile of terrain TOP vertices robustly selects this plane without
  // depending on the exact nominal thickness of the printed base plate.
  function referencePlaneMm(model){
    if(Number.isFinite(model.projectionReferenceMm))return model.projectionReferenceMm;
    const sorted=Array.from(model.values).sort((a,b)=>a-b);
    return sorted[Math.floor((sorted.length-1)*.02)]||0;
  }
  function sourceToLandscape(u,v){return [1-v,u];}
  function warpPoint(u,v,zMm,Hmm,homography){
    if(Hmm<=zMm+30)throw Error('Die Projektorlinse muss höher als der höchste Geländepunkt liegen.');
    const ratio=Hmm/(Hmm-zMm);
    const x=.5+(u-.5)*ratio,y=.5+(v-.5)*ratio;
    const [a,b,c,d,e,f,g,h]=homography;
    const den=g*x+h*y+1;
    return [(a*x+b*y+c)/den,(d*x+e*y+f)/den];
  }

  // GPU texturing uses one continuous surface with shared triangle vertices.
  // No triangle strokes or individually antialiased clip masks = no visible mesh grid.
  const gpuCache=new WeakMap();
  function shader(gl,type,code){
    const obj=gl.createShader(type);gl.shaderSource(obj,code);gl.compileShader(obj);
    if(!gl.getShaderParameter(obj,gl.COMPILE_STATUS))throw Error('3D-Shader: '+gl.getShaderInfoLog(obj));
    return obj;
  }
  function gpuFor(ctx,w,h){
    let gpu=gpuCache.get(ctx);
    if(gpu && !gpu.lost){if(gpu.canvas.width!==w||gpu.canvas.height!==h){gpu.canvas.width=w;gpu.canvas.height=h;}return gpu;}
    if(typeof document==='undefined')return null;
    const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
    const gl=canvas.getContext('webgl',{alpha:true,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true,premultipliedAlpha:false});
    if(!gl)return null;
    try{
      const vs=shader(gl,gl.VERTEX_SHADER,`attribute vec2 position; attribute vec2 uv; varying vec2 texcoord; void main(){gl_Position=vec4(position.x*2.0-1.0,1.0-position.y*2.0,0.0,1.0);texcoord=uv;}`);
      const fs=shader(gl,gl.FRAGMENT_SHADER,`precision mediump float; varying vec2 texcoord; uniform sampler2D image; void main(){gl_FragColor=texture2D(image,texcoord);}`);
      const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('3D-Programm konnte nicht verknüpft werden.');
      const buffer=gl.createBuffer(),texture=gl.createTexture();
      gpu={canvas,gl,program,buffer,texture,pos:gl.getAttribLocation(program,'position'),uv:gl.getAttribLocation(program,'uv'),lost:false};
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();gpu.lost=true;});
      gpuCache.set(ctx,gpu);return gpu;
    }catch(error){return null;}
  }
  function renderGpu(ctx,source,terrain,positions,outW,outH){
    const gpu=gpuFor(ctx,outW,outH);
    if(!gpu)return false;
    const {gl,program,buffer,texture,pos,uv}=gpu;
    const {cols,rows}=terrain,nx=cols+1;
    const vertices=new Float32Array(cols*rows*6*4);let j=0;
    function point(id,s,t){vertices[j++]=positions[id*2]/outW;vertices[j++]=positions[id*2+1]/outH;vertices[j++]=s;vertices[j++]=t;}
    for(let iy=0;iy<rows;iy++)for(let ix=0;ix<cols;ix++){
      const a=iy*nx+ix,b=a+1,d=a+nx,c=d+1,x0=ix/cols,x1=(ix+1)/cols,y0=iy/rows,y1=(iy+1)/rows;
      point(a,x0,y0);point(b,x1,y0);point(c,x1,y1);
      point(a,x0,y0);point(c,x1,y1);point(d,x0,y1);
    }
    gl.viewport(0,0,outW,outH);
    gl.disable(gl.BLEND);gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,vertices,gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,16,0);
    gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,16,8);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    // Falls ein externer Kartenserver keine CORS-Freigabe liefert, kann WebGL
    // keine Textur hochladen. Dann weiterhin die Canvas-Projektion verwenden.
    try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,source);}
    catch(_){return false;}
    gl.uniform1i(gl.getUniformLocation(program,'image'),0);
    gl.drawArrays(gl.TRIANGLES,0,vertices.length/4);
    if(gl.isContextLost())return false;
    ctx.clearRect(0,0,outW,outH);ctx.drawImage(gpu.canvas,0,0);
    return true;
  }

  function affineTriangle(ctx,source,src,dst){
    const [[x0,y0],[x1,y1],[x2,y2]]=src;
    const [[u0,v0],[u1,v1],[u2,v2]]=dst;
    const det=(x1-x0)*(y2-y0)-(x2-x0)*(y1-y0);
    if(Math.abs(det)<1e-8)return;
    const a=((u1-u0)*(y2-y0)-(u2-u0)*(y1-y0))/det;
    const c=((u2-u0)*(x1-x0)-(u1-u0)*(x2-x0))/det;
    const b=((v1-v0)*(y2-y0)-(v2-v0)*(y1-y0))/det;
    const d=((v2-v0)*(x1-x0)-(v1-v0)*(x2-x0))/det;
    const e=u0-a*x0-c*y0,f=v0-b*x0-d*y0;
    // Canvas-2D-Fallback: Clip by an overlapping triangle, preventing seams
    // where two independently antialiased triangles meet. No grid is drawn.
    const cx=(u0+u1+u2)/3,cy=(v0+v1+v2)/3;
    const overscan=1.0;
    const grow=([x,y])=>{const vx=x-cx,vy=y-cy,len=Math.hypot(vx,vy)||1;return [x+overscan*vx/len,y+overscan*vy/len];};
    const [p0,p1,p2]=[[u0,v0],[u1,v1],[u2,v2]].map(grow);
    ctx.save();ctx.beginPath();ctx.moveTo(...p0);ctx.lineTo(...p1);ctx.lineTo(...p2);ctx.closePath();ctx.clip();
    ctx.transform(a,b,c,d,e,f);ctx.drawImage(source,0,0);ctx.restore();
  }
  function render(ctx,source,terrain,heightCm,corners,core,outW,outH){
    const H=heightCm*10;
    if(!Number.isFinite(H)||H<200||H>5000)throw Error('Projektorhöhe muss zwischen 20 und 500 cm liegen.');
    if(terrain.maxHeightMm>H-30)throw Error('Projektorhöhe zu klein für die maximale Reliefhöhe.');
    const h=core.homography(corners),{cols,rows,values}=terrain,nx=cols+1;
    const reference=referencePlaneMm(terrain);
    const projectorAboveReference=H-reference;
    const positions=new Float32Array((cols+1)*(rows+1)*2);
    for(let iy=0;iy<=rows;iy++)for(let ix=0;ix<=cols;ix++){
      const [landscapeX,landscapeY]=sourceToLandscape(ix/cols,iy/rows);
      const heightAboveReference=Math.max(0,values[iy*nx+ix]-reference);
      const p=warpPoint(landscapeX,landscapeY,heightAboveReference,projectorAboveReference,h);
      const index=(iy*nx+ix)*2;positions[index]=p[0]*outW;positions[index+1]=p[1]*outH;
    }
    if(renderGpu(ctx,source,terrain,positions,outW,outH))return;
    ctx.clearRect(0,0,outW,outH);
    const srcW=source.width,srcH=source.height;
    for(let iy=0;iy<rows;iy++)for(let ix=0;ix<cols;ix++){
      const a=iy*nx+ix,b=a+1,d=a+nx,c=d+1;
      const point=id=>[positions[id*2],positions[id*2+1]];
      const x0=ix/cols*srcW,x1=(ix+1)/cols*srcW,y0=iy/rows*srcH,y1=(iy+1)/rows*srcH;
      affineTriangle(ctx,source,[[x0,y0],[x1,y0],[x1,y1]],[point(a),point(b),point(c)]);
      affineTriangle(ctx,source,[[x0,y0],[x1,y1],[x0,y1]],[point(a),point(c),point(d)]);
    }
  }
  const exported={VERSION,readSTL,bounds,segmentsFromCsv,rasterize,load,serializeHeightmap,parseHeightmap,referencePlaneMm,sourceToLandscape,warpPoint,render};
  root.GrossreliefTerrain=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof globalThis!=='undefined'?globalThis:this);

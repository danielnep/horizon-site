import {readdir,lstat,statfs} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';

// Read-only volume inventory. Never exposes unknown filenames or reads file content.
const MAX_ENTRIES=30000;
const MAX_DEPTH=9;
const MB=1024*1024;
const safePath=(p)=>{
  const parts=p.split(sep).filter(Boolean);
  if(parts[0]==='horizon-agents-postgres' && parts.length<=8 &&
      parts.every(x=>/^[A-Za-z0-9_.-]{1,96}$/.test(x)))return parts.join('/');
  if(parts.length===1&&parts[0]==='maestro-supervisor-handoffs.json')
    return parts[0];
  return '[other-redacted]';
};
const roundMB=n=>Math.round(n/MB*100)/100;

export async function inspectVolume({root='/data',maxEntries=MAX_ENTRIES}={}){
  const free=await statfs(root);
  const totalBytes=Number(free.blocks)*Number(free.bsize);
  const availableBytes=Number(free.bavail)*Number(free.bsize);
  let examined=0,fileCount=0,dirCount=0,symlinksSkipped=0,totalLogical=0,totalAllocated=0;
  const groups=new Map();
  const folders=new Map();
  const largest=[];
  const work=[{path:root,depth:0}];
  while(work.length&&examined<maxEntries){
    const {path,depth}=work.pop();
    if(depth>MAX_DEPTH)continue;
    const entries=await readdir(path,{withFileTypes:true});
    for(const entry of entries){
      if(examined>=maxEntries)break;
      ++examined;
      const full=join(path,entry.name);
      const rel=relative(root,full);
      const stat=await lstat(full);
      if(stat.isSymbolicLink()){symlinksSkipped++;continue;}
      if(stat.isDirectory()){
        dirCount++;
        if(depth<MAX_DEPTH)work.push({path:full,depth:depth+1});
        continue;
      }
      if(!stat.isFile())continue;
      fileCount++;
      totalLogical+=stat.size;
      const allocated=typeof stat.blocks==='number'?stat.blocks*512:stat.size;
      totalAllocated+=allocated;
      const parts=rel.split(sep);
      const top=parts[0]==='horizon-agents-postgres'?'horizon-agents-postgres':
        parts.length===1&&parts[0]==='maestro-supervisor-handoffs.json'?'maestro-supervisor-handoffs.json':'[other-redacted]';
      const group=groups.get(top)||{count:0,logical:0,allocated:0};
      group.count++;group.logical+=stat.size;group.allocated+=allocated;groups.set(top,group);
      const folder=parts[0]==='horizon-agents-postgres'
        ?safePath(parts.slice(0,Math.min(parts.length-1,3)).join(sep))
        :top;
      const current=folders.get(folder)||{count:0,logical:0,allocated:0};
      current.count++;current.logical+=stat.size;current.allocated+=allocated;folders.set(folder,current);
      largest.push({path:safePath(rel),logical:stat.size,allocated,modified:stat.mtime.toISOString()});
      largest.sort((a,b)=>b.allocated-a.allocated);
      if(largest.length>20)largest.pop();
    }
  }
  const sorted=(map)=>[...map.entries()].map(([name,x])=>({
    name,count:x.count,logicalMB:roundMB(x.logical),allocatedMB:roundMB(x.allocated)
  })).sort((a,b)=>b.allocatedMB-a.allocatedMB);
  return {
    root:'/data',capacityMB:roundMB(totalBytes),availableMB:roundMB(availableBytes),
    usedMB:roundMB(totalBytes-availableBytes),
    estimatedFilesMB:roundMB(totalAllocated),logicalFilesMB:roundMB(totalLogical),
    fileCount,dirCount,symlinksSkipped,examined,truncated:work.length>0||examined>=maxEntries,
    groups:sorted(groups),folders:sorted(folders).slice(0,35),
    largest:largest.map(x=>({path:x.path,allocatedMB:roundMB(x.allocated),
      logicalMB:roundMB(x.logical),modified:x.modified}))
  };
}

"""Restyle legacy plan images without substituting another project revision.

Maintenance utility, not a free image generator. Requires numpy, opencv-python-
headless, Pillow and Tesseract with rus/eng data. Originals are never overwritten.
"""
import argparse, csv, hashlib, io, json, re, subprocess
from pathlib import Path
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops

cv2.setNumThreads(1)

INK=(40,58,70); LINE=(123,135,145); BLUE=(40,119,201); PALE=(226,239,249)

def ocr(image, tessdata):
    words=[]
    for turn in [0,90,270]:
        vertical=turn!=0
        im=image.transpose(Image.Transpose.ROTATE_90 if turn==90 else Image.Transpose.ROTATE_270) if vertical else image
        scale=2000/max(im.size); scaled=im.resize(tuple(round(n*scale) for n in im.size))
        stream=io.BytesIO();scaled.save(stream,format='PNG')
        run=subprocess.run(['tesseract','stdin','stdout','--tessdata-dir',str(tessdata),'-l','rus+eng','--psm','11','-c','tessedit_create_tsv=1','-c','tessedit_create_txt=0'],input=stream.getvalue(),capture_output=True,check=True)
        groups={}
        for r in csv.DictReader(io.StringIO(run.stdout.decode()),delimiter='\t'):
            text=(r.get('text') or '').strip()
            if not text or float(r['conf'])<28 or not re.search(r'[a-zа-яё0-9]',text,re.I):continue
            x,y,w,h=[float(r[k])/scale for k in ['left','top','width','height']]
            if h>max(im.size)*.07 or w>max(im.size)*.4:continue
            box=[x,y,x+w,y+h]
            if turn==90:box=[image.width-y-h,x,image.width-y,x+w]
            elif turn==270:box=[y,image.height-x-w,y+h,image.height-x]
            word={'text':text,'box':box,'vertical':vertical,'font':h}
            words.append(word);groups.setdefault(tuple(r[k] for k in ['page_num','block_num','par_num','line_num']),[]).append(word)
        for group in groups.values():
            if len(group)<2:continue
            text=' '.join(w['text'] for w in group)
            if not re.fullmatch(r'[≈~\s\d.,]+',text):continue
            words.append({'text':text,'box':[min(w['box'][0] for w in group),min(w['box'][1] for w in group),max(w['box'][2] for w in group),max(w['box'][3] for w in group)],'vertical':vertical,'font':max(w['font'] for w in group)})
    return words

def components(mask):
    n,labels,stats,_=cv2.connectedComponentsWithStats(mask)
    return labels,stats[1:]

def wall_mask(binary,override=None):
    diagonal=cv2.morphologyEx(binary,cv2.MORPH_OPEN,np.eye(3,dtype=np.uint8))|cv2.morphologyEx(binary,cv2.MORPH_OPEN,np.fliplr(np.eye(3,dtype=np.uint8)))
    segments=cv2.HoughLinesP(binary,1,np.pi/180,8,minLineLength=5,maxLineGap=1)
    sizes=[]
    for segment in ([] if segments is None else segments.reshape(-1,4)):
        dx=abs(int(segment[2])-int(segment[0]));dy=abs(int(segment[3])-int(segment[1]))
        if min(dx,dy)>=4 and .85<dx/max(1,dy)<1.15 and max(dx,dy)<max(binary.shape)*.07:sizes.append(min(dx,dy))
    kernel=max(7,min(31,int(np.percentile(sizes,85)*.8)//2*2+1)) if len(sizes)>=25 else 9
    kernel=override or kernel
    hatches=cv2.morphologyEx(diagonal,cv2.MORPH_CLOSE,np.ones((kernel,kernel),np.uint8))
    hatches=cv2.morphologyEx(hatches,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    solid=cv2.morphologyEx(binary,cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    labels,stats=components(hatches|solid);out=np.zeros_like(binary)
    for i,(x,y,w,h,area) in enumerate(stats,1):
        if area>=70 and (max(w,h)>=25 or area>=180):out[labels==i]=255
    return out

def bounding(mask):
    ys,xs=np.where(mask>0)
    if not len(xs):raise ValueError('No reliable wall regions')
    return [int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]

def clean_text(rgb,words):
    gray=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    binary=(gray<225).astype(np.uint8)*255
    horizontal=cv2.morphologyEx(binary,cv2.MORPH_OPEN,np.ones((1,15),np.uint8))
    vertical=cv2.morphologyEx(binary,cv2.MORPH_OPEN,np.ones((15,1),np.uint8))
    initial=wall_mask(binary);regions,stats0=components(initial);physical=np.zeros_like(initial)
    for ii,(_,_,ww,hh,area0) in enumerate(stats0,1):
        if area0>200 and max(ww,hh)>max(binary.shape)*.08 and ww*hh>binary.size*.005:physical[regions==ii]=255
    protected=horizontal|vertical|physical
    clean=rgb.copy();labels,stats=components(binary)
    # A small, isolated, rectangular room schedule is an annotation, not furniture.
    erased=[]
    for i,(x,y,w,h,area) in enumerate(stats,1):
        if not (9<w<rgb.shape[1]*.16 and 6<h<rgb.shape[0]*.10 and area>12):continue
        has_text=any(a['box'][0]>=x-1 and a['box'][1]>=y-1 and a['box'][2]<=x+w+1 and a['box'][3]<=y+h+1 for a in words)
        region=(labels[y:y+h,x:x+w]==i)
        perimeter=np.r_[region[0,:],region[-1,:],region[:,0],region[:,-1]].mean()
        rows=np.where(region.sum(axis=1)>=w*.7)[0]
        row_centres=[]
        for row in rows:
            if not row_centres or row-row_centres[-1][-1]>1:row_centres.append([row])
            else:row_centres[-1].append(row)
        positions=[sum(v)/len(v) for v in row_centres];gaps=np.diff(positions)
        grid=len(positions)>=3 and len(gaps)>0 and min(gaps)>1 and max(gaps)/min(gaps)<1.7 and 1.2<w/h<8
        if perimeter<.55 or not (has_text or grid):continue
        clean[max(0,y-1):y+h+1,max(0,x-1):x+w+1]=255;erased.append([int(x),int(y),int(w),int(h)])
    # Raster exports may split a frame across antialiased components. Inspect
    # its full contour so three-row schedules are removed as one rectangle.
    closed=cv2.morphologyEx(binary,cv2.MORPH_CLOSE,np.ones((2,2),np.uint8))
    for contour in cv2.findContours(closed,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)[0]:
        x,y,w,h=cv2.boundingRect(contour)
        if not (12<w<rgb.shape[1]*.16 and 9<h<rgb.shape[0]*.10 and 1.15<w/h<8):continue
        region=binary[max(0,y-2):min(binary.shape[0],y+h+2),max(0,x-2):min(binary.shape[1],x+w+2)]>0
        rows=np.where(region.sum(axis=1)>=w*.65)[0];groups=[]
        for r in rows:
            if not groups or r-groups[-1][-1]>2:groups.append([r])
            else:groups[-1].append(r)
        positions=[np.mean(g) for g in groups];gaps=np.diff(positions)
        if 4<=len(positions)<=5 and len(gaps) and min(gaps)>2 and max(gaps)/min(gaps)<1.5:
            clean[max(0,y-2):y+h+2,max(0,x-2):x+w+2]=255;erased.append([int(x),int(y),int(w),int(h)])
    for word in words:
        x0,y0,x1,y1=word['box'];pad=max(1,word['font']*.12)
        x0=max(0,int(x0-pad));y0=max(0,int(y0-pad));x1=min(rgb.shape[1],int(x1+pad+1));y1=min(rgb.shape[0],int(y1+pad+1))
        region=clean[y0:y1,x0:x1];region[protected[y0:y1,x0:x1]==0]=255
    # CAD selection handles are red/yellow; retain orange door swing geometry.
    a=clean.astype(np.int16);red=(a[:,:,0]>160)&(a[:,:,1]<85)&(a[:,:,2]<85)
    yellow=(a[:,:,0]>190)&(a[:,:,1]>180)&(a[:,:,2]<80)
    clean[red|yellow]=255
    return clean,erased

def dimensions(words,b):
    candidates=[]
    for w in words:
        text=re.sub(r'[≈~\s.,]','',w['text'])
        if not text.isdigit() or not 2000<=int(text)<=100000:continue
        x0,y0,x1,y1=w['box'];cx=(x0+x1)/2;cy=(y0+y1)/2
        if w['vertical'] and (cx<b[0] or cx>b[2]) and b[1]<cy<b[3]:candidates.append({**w,'axis':'height','value':int(text)})
        if not w['vertical'] and (cy<b[1] or cy>b[3]) and b[0]<cx<b[2]:candidates.append({**w,'axis':'width','value':int(text)})
    return {axis:max([w for w in candidates if w['axis']==axis],key=lambda w:w['value'],default=None) for axis in ['width','height']}

def remove_dimensions(clean,dims,b):
    gray=cv2.cvtColor(clean,cv2.COLOR_RGB2GRAY);binary=(gray<210).astype(np.uint8)
    for axis,d in dims.items():
        if not d:continue
        x0,y0,x1,y1=d['box'];font=d['font']
        if axis=='width':
            low=max(0,int(y0-font*2));high=min(clean.shape[0],int(y1+font*2))
            choices=[y for y in range(low,high) if y<b[1]-3 or y>b[3]+3]
            if not choices:continue
            y=max(choices,key=lambda y:binary[y,:].sum())
            if binary[y,:].sum()<(b[2]-b[0])*.4:continue
            d['span']=[int(np.where(binary[y,:]>0)[0].min()),int(np.where(binary[y,:]>0)[0].max())]
            for ex in d['span']:
                ya,yb=(y,b[1]) if y<b[1] else (b[3],y)
                clean[max(0,ya):min(clean.shape[0],yb),max(0,ex-2):min(clean.shape[1],ex+3)]=255
            clean[max(0,y-5):min(clean.shape[0],y+6),:]=255
            if y<b[1]:clean[:max(0,y-4),:]=255
            else:clean[min(clean.shape[0],y+5):,:]=255
        else:
            low=max(0,int(x0-font*2));high=min(clean.shape[1],int(x1+font*2))
            choices=[x for x in range(low,high) if x<b[0]-3 or x>b[2]+3]
            if not choices:continue
            x=max(choices,key=lambda x:binary[:,x].sum())
            if binary[:,x].sum()<(b[3]-b[1])*.4:continue
            d['span']=[int(np.where(binary[:,x]>0)[0].min()),int(np.where(binary[:,x]>0)[0].max())]
            for ey in d['span']:
                xa,xb=(x,b[0]) if x<b[0] else (b[2],x)
                clean[max(0,ey-2):min(clean.shape[0],ey+3),max(0,xa):min(clean.shape[1],xb)]=255
            clean[:,max(0,x-5):min(clean.shape[1],x+6)]=255
            if x<b[0]:clean[:,:max(0,x-4)]=255
            else:clean[:,min(clean.shape[1],x+5):]=255
    return clean

def render(source,destination,tessdata,declared=None):
    original=Image.open(source).convert('RGB')
    factor=min(1,1400/max(original.size));im=original.resize(tuple(round(n*factor) for n in original.size),Image.Resampling.LANCZOS)
    destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
    cache=destination.with_name(destination.stem+'-ocr.json');digest=hashlib.sha256(Path(source).read_bytes()).hexdigest()
    previous=json.loads(cache.read_text()) if cache.exists() else {}
    words=previous.get('words') if previous.get('sha256')==digest and previous.get('version')==1 else None
    if words is None:
        words=ocr(im,tessdata);cache.write_text(json.dumps({'version':1,'sha256':digest,'words':words},ensure_ascii=False))
    rgb=np.asarray(im);clean,erased=clean_text(rgb,words)
    for rect in (declared or {}).get('eraseRegions',[]):
        rx0,ry0,rx1,ry1=[round(n*factor) for n in rect];clean[ry0:ry1,rx0:rx1]=255
    for points in (declared or {}).get('eraseLines',[]):
        pts=np.array([[round(v*factor) for v in pt] for pt in points],dtype=np.int32)
        cv2.polylines(clean,[pts],False,(255,255,255),max(2,round(3*factor)))
    gray=cv2.cvtColor(clean,cv2.COLOR_RGB2GRAY);walls=wall_mask((gray<200).astype(np.uint8)*255,(declared or {}).get("wallKernel"))
    for rect in (declared or {}).get('protectedRegions',[]):
        rx0,ry0,rx1,ry1=[round(n*factor) for n in rect];walls[ry0:ry1,rx0:rx1]=0
    labels0,regions0=components(walls)
    structural=[(xx,yy,ww,hh) for xx,yy,ww,hh,aa in regions0 if max(ww,hh)>max(walls.shape)*.08 and ww*hh>walls.size*.005]
    b=([min(x for x,y,w,h in structural),min(y for x,y,w,h in structural),max(x+w for x,y,w,h in structural),max(y+h for x,y,w,h in structural)] if structural else bounding(walls))
    b=list(map(int,b))
    walls[:b[1],:]=0;walls[b[3]:,:]=0;walls[:,:b[0]]=0;walls[:,b[2]:]=0
    wall_bounds=b.copy();floor_contours=[]
    gray_source=cv2.cvtColor(rgb,cv2.COLOR_RGB2GRAY)
    neutral=(np.max(rgb,axis=2).astype(int)-np.min(rgb,axis=2).astype(int)<4)
    surfaces=((gray_source>=225)&(gray_source<=242)&neutral).astype('uint8')*255
    for contour in cv2.findContours(surfaces,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)[0]:
        xx,yy,ww,hh=cv2.boundingRect(contour)
        if cv2.contourArea(contour)<surfaces.size*.004:continue
        enclosed=np.zeros_like(surfaces);cv2.drawContours(enclosed,[contour],-1,255,cv2.FILLED)
        if np.count_nonzero(surfaces&enclosed)/max(1,np.count_nonzero(enclosed))<.6:continue
        if xx<b[0]-3 or yy<b[1]-3 or xx+ww>b[2]+3 or yy+hh>b[3]+3:
            floor_contours.append(contour);b=[min(b[0],xx),min(b[1],yy),max(b[2],xx+ww),max(b[3],yy+hh)]
    if (declared or {}).get('eraseAboveWalls'):clean[:max(0,wall_bounds[1]-3),:]=255
    dims=dimensions(words,b);clean=remove_dimensions(clean,dims,b)
    if declared:
        for axis in ['width','height']:
            if declared.get(axis) and (not dims[axis] or declared.get('forceDimensions')):dims[axis]={**(dims[axis] or {}),'value':declared[axis],'basis':'reviewed-source'}
            if dims[axis] and axis in declared.get('derived',[]):dims[axis]['approximate']=True
    span=max(b[2]-b[0],b[3]-b[1]);_,graphics=components((cv2.cvtColor(clean,cv2.COLOR_RGB2GRAY)<205).astype('uint8')*255)
    nearby=[(xx,yy,ww,hh) for xx,yy,ww,hh,aa in graphics if aa>=10 and max(ww,hh)>=12 and xx>=b[0]-span*.18 and yy>=b[1]-span*.18 and xx+ww<=b[2]+span*.18 and yy+hh<=b[3]+span*.18]
    if nearby:b=[min(b[0],min(x for x,y,w,h in nearby)),min(b[1],min(y for x,y,w,h in nearby)),max(b[2],max(x+w for x,y,w,h in nearby)),max(b[3],max(y+h for x,y,w,h in nearby))]
    b=list(map(int,b));pad=max(12,round(max(b[2]-b[0],b[3]-b[1])*.035))
    crop=[max(0,b[0]-pad),max(0,b[1]-pad),min(im.width,b[2]+pad),min(im.height,b[3]+pad)]
    x0,y0,x1,y1=crop;gray=cv2.cvtColor(clean,cv2.COLOR_RGB2GRAY)[y0:y1,x0:x1]
    alpha=np.clip((215-gray.astype(float))/145,0,1)*255
    line=Image.new('RGB',gray.shape[::-1],LINE).convert('RGBA');line.putalpha(Image.fromarray(alpha.astype('uint8')))
    # Recolour only substantial blue furniture fills; thin glass remains neutral.
    a=clean[y0:y1,x0:x1].astype(np.int16);blue=((a[:,:,2]-a[:,:,0]>25)&(a[:,:,0]<220)&(a[:,:,1]>a[:,:,0])).astype('uint8')*255
    labels,stats=components(blue);furniture=np.zeros_like(blue)
    for i,(xx,yy,w,h,area) in enumerate(stats,1):
        if area>100 and min(w,h)>10 and max(w,h)/min(w,h)<7:furniture[labels==i]=255
    width=x1-x0;height=y1-y0;scale=min(2840/width,2580/height)
    size=(round(width*scale),round(height*scale));left=(3600-size[0])//2+50;top=130+(2580-size[1])//2
    out=Image.new('RGB',(3600,3200),'white');out.paste(line.resize(size,Image.Resampling.LANCZOS),(left,top),line.resize(size,Image.Resampling.LANCZOS))
    floor_draw=ImageDraw.Draw(out)
    for contour in floor_contours:
        pts=[(left+(float(q[0][0])-x0)*scale,top+(float(q[0][1])-y0)*scale) for q in contour]
        if pts:floor_draw.line(pts+[pts[0]],fill=LINE,width=2)
    fm=Image.fromarray(furniture).resize(size,Image.Resampling.LANCZOS);out.paste(PALE,(left,top),fm)
    wm=Image.fromarray(walls[y0:y1,x0:x1]).resize(size,Image.Resampling.LANCZOS)
    fullmask=Image.new('L',out.size);fullmask.paste(wm,(left,top))
    shifted=ImageChops.offset(fullmask,5,8).filter(ImageFilter.GaussianBlur(9));shadow=ImageChops.subtract(shifted,fullmask).point(lambda v:round(v*.24))
    out.paste((20,35,49),(0,0),shadow);out.paste(INK,(0,0),fullmask)
    draw=ImageDraw.Draw(out);font=ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',52)
    bx=left+(b[0]-x0)*scale;by=top+(b[1]-y0)*scale;br=left+(b[2]-x0)*scale;bt=top+(b[3]-y0)*scale
    if dims['width']:
        if dims['width'].get('span'):bx=left+(dims['width']['span'][0]-x0)*scale;br=left+(dims['width']['span'][1]-x0)*scale
        y=bt+160;draw.line([(bx,y),(br,y)],fill=BLUE,width=4)
        for x in [bx,br]:draw.line([(x,bt+28),(x,y+30)],fill=(182,197,213),width=3);draw.line([(x-16,y+16),(x+16,y-16)],fill=BLUE,width=4)
        text=('≈ ' if dims['width'].get('approximate') else '')+f"{dims['width']['value']:,}".replace(',',' ');bb=draw.textbbox((0,0),text,font=font);tw=bb[2]-bb[0]
        draw.rectangle(((bx+br)/2-tw/2-24,y-50,(bx+br)/2+tw/2+24,y+35),fill='white');draw.text(((bx+br)/2,y),text,font=font,fill=BLUE,anchor='mm')
    if dims['height']:
        if dims['height'].get('span'):by=top+(dims['height']['span'][0]-y0)*scale;bt=top+(dims['height']['span'][1]-y0)*scale
        x=bx-140;draw.line([(x,by),(x,bt)],fill=BLUE,width=4)
        for y in [by,bt]:draw.line([(x-30,y),(bx-28,y)],fill=(182,197,213),width=3);draw.line([(x-16,y+16),(x+16,y-16)],fill=BLUE,width=4)
        text=('≈ ' if dims['height'].get('approximate') else '')+f"{dims['height']['value']:,}".replace(',',' ');label=Image.new('RGB',(440,90),'white');ImageDraw.Draw(label).text((220,45),text,font=font,fill=BLUE,anchor='mm');label=label.rotate(90,expand=True);out.paste(label,(round(x-label.width/2),round((by+bt)/2-label.height/2)))
    if (declared or {}).get('houseDimensions'):
        hw,hh=declared['houseDimensions'];caption='Габариты дома: '+f'{hw:,} × {hh:,}'.replace(',',' ')+' мм'
        draw.text((1800,2960),caption,font=font,fill=BLUE,anchor='mm')
    destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True);out.save(destination)
    out.resize((270,240),Image.Resampling.LANCZOS).save(destination.with_name(destination.stem+'-thumb.jpg'),quality=90)
    result={'template':'3.1','renderer':'source-raster-relief','sourceGeometryMode':'existing-card-image','sourceSize':list(original.size),'processingScale':factor,'crop':crop,'wallBounds':wall_bounds,'drawingBounds':b,'dimensionApproximateAxes':(declared or {}).get('derived',[]),'sourceSha256':digest,'dimensionScope':'whole-house-caption' if (declared or {}).get('houseDimensions') else 'source-overall-lines','houseDimensions':(declared or {}).get('houseDimensions'),'protectedRegions':(declared or {}).get('protectedRegions',[]),'removedLabelBoxes':erased,'widthMm':dims['width']['value'] if dims['width'] else None,'heightMm':dims['height']['value'] if dims['height'] else None,'windows':'neutral','shadows':'soft','ocrWords':len(words)}
    destination.with_suffix('.json').write_text(json.dumps(result,ensure_ascii=False,indent=2));return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('destination');p.add_argument('--tessdata',required=True);p.add_argument('--dimensions',type=json.loads)
    args=p.parse_args();print(json.dumps(render(args.source,args.destination,args.tessdata,args.dimensions),ensure_ascii=False))

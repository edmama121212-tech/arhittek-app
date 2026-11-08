"""Geometry regression for the one-time legacy image migration utility."""
import hashlib, importlib.util, json, tempfile, unittest
from pathlib import Path
from PIL import Image, ImageDraw

spec=importlib.util.spec_from_file_location('style',Path(__file__).resolve().parents[1]/'scripts/catalog-raster-style.py')
style=importlib.util.module_from_spec(spec);spec.loader.exec_module(style)

class LegacyPlan(unittest.TestCase):
    def test_openings_stairs_annotations_and_dimensions(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);source=root/'source.png';target=root/'styled.png'
            im=Image.new('RGB',(500,500),'white');d=ImageDraw.Draw(im)
            for box in [(100,100,220,114),(280,100,400,114),(100,386,400,400),(100,100,114,400),(386,100,400,220),(386,280,400,400)]:d.rectangle(box,fill='black')
            d.line([(220,106),(280,106)],fill='#75a9dc',width=1)
            for y in range(300,371,10):d.line([(150,y),(240,y)],fill='black',width=1)
            for x in range(320,361,8):d.line([(320,340),(x,300)],fill='black',width=1)
            d.rectangle((200,150,260,183),outline='black');d.line([(200,161),(260,161)],fill='black');d.line([(200,172),(260,172)],fill='black');d.text((210,151),'Room',fill='black')
            d.rectangle((450,300,455,305),outline='red');im.save(source)
            words=[{'text':'Room','box':[210,151,240,160],'vertical':False,'font':9}]
            target.with_name('styled-ocr.json').write_text(json.dumps({'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'version':1,'words':words}))
            report=style.render(source,target,root,{'width':12000,'height':12000,'protectedRegions':[[149,299,241,372],[319,299,362,342]]})
            out=Image.open(target);x0,y0,x1,y1=report['crop'];scale=min(2840/(x1-x0),2580/(y1-y0));w=round((x1-x0)*scale);h=round((y1-y0)*scale);left=(3600-w)//2+50;top=130+(2580-h)//2
            def pixel(x,y):return out.getpixel((round(left+(x-x0)*scale),round(top+(y-y0)*scale)))
            self.assertEqual(pixel(107,200),style.INK)
            self.assertEqual(pixel(393,250),(255,255,255),'door opening must remain empty')
            self.assertGreater(min(pixel(250,107)),220,'window must not become a solid wall')
            self.assertLess(max(pixel(250,106))-min(pixel(250,106)),40,'glass must remain neutral')
            self.assertEqual(pixel(220,161),(255,255,255),'room schedule frame must be removed')
            self.assertLess(min(pixel(200,330)),240,'straight stair tread must survive')
            self.assertNotEqual(pixel(336,320),style.INK,'winding stairs must not become a wall')
            self.assertLess(min(pixel(116,200)),255,'soft wall contact shadow must be visible')
            self.assertEqual((report['widthMm'],report['heightMm']),(12000,12000))
            self.assertEqual(out.size,(3600,3200))
            with Image.open(root/'styled-thumb.jpg') as thumb:self.assertEqual(thumb.size,(270,240))
            out.close()

if __name__=='__main__':unittest.main()

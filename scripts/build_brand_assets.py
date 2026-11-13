"""Generate PhoneDirect brand OG and favicon assets."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parent.parent
ASSETS=ROOT/'assets'
ASSETS.mkdir(parents=True,exist_ok=True)
NAVY='#102844'
BLUE='#1769F5'

def icon(size):
    mult=4
    n=size*mult
    im=Image.new('RGBA',(n,n),(0,0,0,0))
    d=ImageDraw.Draw(im)
    d.rounded_rectangle((0,0,n-1,n-1),radius=int(n*.24),fill=BLUE)
    d.rounded_rectangle((int(n*.34),int(n*.17),int(n*.66),int(n*.83)),
                        radius=int(n*.065),outline='#ffffff',width=max(2,int(n*.058)))
    d.rounded_rectangle((int(n*.465),int(n*.225),int(n*.535),int(n*.242)),
                        radius=int(n*.01),fill='#ffffff')
    d.arc((int(n*.18),int(n*.44),int(n*.83),int(n*.76)),
          start=15,end=169,fill='#ffffff',width=max(2,int(n*.06)))
    return im.resize((size,size),Image.Resampling.LANCZOS)

large=icon(512)
large.save(ROOT/'favicon-512.png',optimize=True)
large.resize((192,192),Image.Resampling.LANCZOS).save(ROOT/'favicon-192.png',optimize=True)
large.resize((180,180),Image.Resampling.LANCZOS).save(ROOT/'apple-touch-icon.png',optimize=True)
large.resize((48,48),Image.Resampling.LANCZOS).save(ROOT/'favicon-48.png',optimize=True)
large.save(ROOT/'favicon.ico',format='ICO',sizes=[(16,16),(32,32),(48,48),(64,64)])

w,h=1200,630
im=Image.new('RGB',(w,h),'#F7FAFF')
d=ImageDraw.Draw(im)
fonts=[
 '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
 '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
 '/usr/share/fonts/truetype/nanum/NanumSquareB.ttf',
]
font_path=next((p for p in fonts if Path(p).exists()),None)
if not font_path:
    raise SystemExit('Korean font missing: install fonts-noto-cjk')
font=ImageFont.truetype(font_path,105)
brand='폰다이렉트'
bbox=d.textbbox((0,0),brand,font=font)
text_w=bbox[2]-bbox[0]
icon_s=128
gap=31
x=(w-(icon_s+gap+text_w))//2
center_y=h//2
brand_icon=icon(icon_s)
im.paste(brand_icon,(x,center_y-icon_s//2),brand_icon)
d.text((x+icon_s+gap,center_y-(bbox[3]-bbox[1])//2-bbox[1]-5),brand,font=font,fill=NAVY)
d.rounded_rectangle((w//2-35,h//2+102,w//2+35,h//2+108),radius=3,fill=BLUE)
im.save(ASSETS/'phonedirect-og.jpg',quality=92,subsampling=0,optimize=True,progressive=True)
print('Generated OG 1200x630 and favicon variants')

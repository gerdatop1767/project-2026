"""crop.py R out.png page:top:bottom[:left:right] ...  (PDF page numbers; fractions of height/width)"""
import sys
from PIL import Image
R, out = sys.argv[1], sys.argv[2]; parts = []
for spec in sys.argv[3:]:
    f = spec.split(':'); p, a, b = int(f[0]), float(f[1]), float(f[2]); l, r = (float(f[3]), float(f[4])) if len(f) > 3 else (0, 1)
    im = Image.open(f'{R}/pages/p{p:03d}.ppm')
    if p in (172, 188): im = im.rotate(180)
    w, h = im.size; parts.append(im.crop((int(w*l), int(h*a), int(w*r), int(h*b))))
W2 = max(x.width for x in parts); o = Image.new('RGB', (W2, sum(x.height for x in parts)), 'white'); y = 0
for x in parts: o.paste(x, (0, y)); y += x.height
o.save(out)

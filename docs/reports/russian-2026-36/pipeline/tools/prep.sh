#!/bin/bash
# prep.sh R N — dump key, repeats, paragraphs, essay crop and page crops for variant N
R=$1; N=$2; NN=$(printf %02d $N)
python3 -I -c "
import json;k=json.load(open('$R/answers/key_final.json'))['$N']
for n in sorted(k,key=int): print('KEY',n,k[n]['raw'],k[n].get('note',''))"
echo REPEATS; python3 -I $R/tools/repeats.py $R $N
echo PARAS; python3 -I $R/tools/paras.py $R $N | tail -1
python3 -I $R/tools/essayinfo.py $R $N
for p in $(grep -o '<<PAGE [0-9]*>>' $R/seg/v$NN.txt | grep -o '[0-9]*'); do
python3 -I -c "
import sys;sys.argv=['','$R','$R/view/p$p.png','$p:0.03:0.97'];exec(open('$R/tools/crop.py').read())
from PIL import Image;im=Image.open('$R/view/p$p.png');im.resize((1000,int(im.height*1000/im.width))).save('$R/view/p$p.png')"; done
grep -o '<<PAGE [0-9]*>>' $R/seg/v$NN.txt | tr '\n' ' '; echo

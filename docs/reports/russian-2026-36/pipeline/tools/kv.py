"""Record visual verification: kv.py R VARIANT PAGE 'n=value' ... ['n#note text'] """
import json,sys
R,v,p=sys.argv[1],sys.argv[2],sys.argv[3]
f=f'{R}/answers/verify.json';d=json.load(open(f))
e=d.setdefault(v,{'fixes':{},'notes':{}});e['verified']=f'visual, PDF {p}'
for a in sys.argv[4:]:
    if '#' in a.split('=')[0]: n,t=a.split('#',1);e['notes'][n]=t
    else: n,t=a.split('=',1);e['fixes'][n]=t
json.dump(d,open(f,'w'),ensure_ascii=False,indent=1)

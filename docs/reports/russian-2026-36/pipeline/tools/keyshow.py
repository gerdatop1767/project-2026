import json,sys
R,p=sys.argv[1],int(sys.argv[2]);k=json.load(open(f'{R}/answers/key_cols.json'))
for v in ((p-315)*2+1,(p-315)*2+2):
    e=k[str(v)]['entries'];print(f'В{v} ({len(e)}):'); [print(f' {i+1:2d} {x}') for i,x in enumerate(e)]

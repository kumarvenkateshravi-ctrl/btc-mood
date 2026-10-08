"""Behavioral model for filtered signals; does not compile or execute Pine."""
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from collections import Counter

IST = timezone(timedelta(hours=5, minutes=30))
CUTOFF = int(datetime(2026, 10, 2, 13, tzinfo=timezone.utc).timestamp()*1000)-1

def model(rows, filtered=True):
    h, l, c = [[float(r[k]) for r in rows] for k in (2,3,4)]
    atr=[]
    trs=[]
    for i in range(len(rows)):
        tr=h[i]-l[i] if i==0 else max(h[i]-l[i],abs(h[i]-c[i-1]),abs(l[i]-c[i-1]))
        trs.append(tr)
        atr.append(None if i<13 else sum(trs[:14])/14 if i==13 else (atr[-1]*13+tr)/14)
    pending={1:None,-1:None}
    last_bar=None
    last_side=0
    last_close=None
    out=[]
    for i in range(3,len(rows)):
        p=i-1
        low=l[p]<=min(l[p-2:p]) and l[p]<l[i]
        high=h[p]>=max(h[p-2:p]) and h[p]>h[i]
        if not filtered:
            if low != high: out.append((i,1 if low else -1,p))
            continue
        if atr[p] is None or p<6: continue
        for side in (1,-1):
            q=pending[side]
            if q and (i-q['armed']>6 or (l[i]<q['extreme'] if side==1 else h[i]>q['extreme'])):
                pending[side]=None
        for side,found in ((1,low and not high),(-1,high and not low)):
            extreme=l[p] if side==1 else h[p]
            approach=max(h[p-6:p])-extreme if side==1 else extreme-min(l[p-6:p])
            q=pending[side]
            if found and approach>=1.5*atr[p] and (q is None or side*extreme<=side*q['extreme']):
                pending[side]=dict(extreme=extreme,trigger=h[p] if side==1 else l[p],atr=atr[p],armed=i,p=p)
        ready={}
        for side in (1,-1):
            q=pending[side]
            ready[side]=bool(q and side*(c[i]-q['trigger'])>0 and side*(c[i]-q['extreme'])>=.75*q['atr'])
        if ready[1] != ready[-1]:
            side=1 if ready[1] else -1
            q=pending[side]
            fresh=last_side!=side or side*(last_close-q['extreme'])>=q['atr']
            if (last_bar is None or i-last_bar>=6) and fresh:
                out.append((i,side,q['p']))
                last_bar,last_side,last_close=i,side,c[i]
                pending={1:None,-1:None}
        # A completed trigger is consumed even if spacing prevented a label.
        for side in (1,-1):
            if ready[side]: pending[side]=None
    return out

if __name__=='__main__':
    report=[]
    for tf,start in [('30m','2026-09-30T20:00:00+05:30'),('4h','2026-09-18T00:00:00+05:30')]:
        rows=json.loads(Path(f'money-flow-filter-{tf}.json').read_text(encoding='utf-8-sig'))
        rows=[r for r in rows if r[6]<=CUTOFF]
        start_ms=int(datetime.fromisoformat(start).timestamp()*1000)
        full=model(rows)
        for end in range(20,len(rows)+1):
            assert model(rows[:end])==[e for e in full if e[0]<end]
        assert all(b[0]-a[0]>=6 for a,b in zip(full,full[1:]))
        # Every emitted event must have a genuine closing break and must not
        # survive a breach of its extreme before confirmation.
        for i,side,p in full:
            close=float(rows[i][4])
            trigger=float(rows[p][2 if side==1 else 3])
            extreme=float(rows[p][3 if side==1 else 2])
            assert side*(close-trigger)>0
            assert 1<=i-p<=7
            assert all(side*(float(rows[j][3 if side==1 else 2])-extreme)>=0 for j in range(p+1,i+1))
        # Price mirroring must swap BUY and SELL without changing their timing.
        mirrored=[]
        for row in rows:
            r=list(row)
            r[1],r[2],r[3],r[4]=-float(row[1]),-float(row[3]),-float(row[2]),-float(row[4])
            mirrored.append(r)
        assert model(mirrored)==[(i,-side,p) for i,side,p in full]
        raw=[e for e in model(rows,False) if rows[e[0]][0]>=start_ms]
        filtered=[e for e in full if rows[e[0]][0]>=start_ms]
        counts=lambda es:dict(Counter('BUY' if e[1]==1 else 'SELL' for e in es))
        report.append(dict(timeframe=tf,closed_bars=len(rows),start=start,raw=counts(raw),filtered=counts(filtered),events=[dict(time=datetime.fromtimestamp(rows[i][0]/1000,IST).isoformat(),side='BUY' if s==1 else 'SELL') for i,s,p in filtered]))
        print(tf,'raw',counts(raw),'filtered',counts(filtered))
    Path('money-flow-filter-results.json').write_text(json.dumps(report,indent=2))
    print('PASS: prefix stability, six-bar spacing, closing breaks, pending lifetime, invalidation, and BUY/SELL symmetry.')

"""Local behavioral checks for FVG cross markers; not a Pine compiler."""
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path

def qualifies(value, previous, bottom, top, op, cl, mode='Either condition', formation=False, direction=1):
    if direction==1:
        entry=previous is not None and ((previous<bottom<=value) or (previous==bottom and value>bottom))
        matching_body=cl>op and op<=value<=cl
    else:
        entry=previous is not None and ((previous>top>=value) or (previous==top and value<top))
        matching_body=cl<op and cl<=value<=op
    body=matching_body and (formation or bottom<=value<=top)
    return entry or body if mode=='Either condition' else entry if mode in ('Line enters FVG in its direction','Line enters bullish FVG from below') else body

def simulate(rows, include_sell=True):
    upper=lower=None
    pv=vol=0
    prev_vwap=prev_g=None
    prev_day=None
    zones=[]
    events=[]
    removed=set()
    source_side={'VWAP':0,'G-Trend':0}
    for i,r in enumerate(rows):
        op,hi,lo,cl,volume=map(float,r[1:6])
        day=r[0]//86400000
        new_session=day!=prev_day
        if new_session: pv=vol=0
        pv+=(hi+lo+cl)/3*volume
        vol+=volume
        vwap=pv/vol if vol else None
        if upper is None: upper=lower=cl
        else:
            spread=(upper-lower)/100
            upper,lower=max(cl,upper)-spread,min(cl,lower)+spread
        g=(upper+lower)/2
        active=[]
        raw={('VWAP',1):None,('VWAP',-1):None,('G-Trend',1):None,('G-Trend',-1):None}
        for z in zones:
            if i-z['id']>200 or (cl<z['bottom'] if z['direction']==1 else cl>z['top']):
                removed.add(z['id'])
            else: active.append(z)
        zones=active
        if i>=2:
            bullish=lo>float(rows[i-2][2]) and float(rows[i-1][4])>float(rows[i-2][2])
            bearish=hi<float(rows[i-2][3]) and float(rows[i-1][4])<float(rows[i-2][3])
            if bullish or bearish:
                if len(zones)>=30: removed.add(zones.pop(0)['id'])
                zones.append(dict(id=i,top=lo if bullish else float(rows[i-2][3]),bottom=float(rows[i-2][2]) if bullish else hi,direction=1 if bullish else -1,seen=set()))
        for z in zones:
            if z['direction']!=1 and not include_sell: continue
            for name,value,previous in [('VWAP',vwap,None if new_session else prev_vwap),('G-Trend',g,prev_g)]:
                if value is not None and name not in z['seen'] and qualifies(value,previous,z['bottom'],z['top'],op,cl,formation=i==z['id'],direction=z['direction']):
                    z['seen'].add(name)
                    if raw[(name,z['direction'])] is None:
                        raw[(name,z['direction'])]=z['id']
        for name in ('VWAP','G-Trend'):
            buy_zone=raw[(name,1)]
            sell_zone=raw[(name,-1)]
            if (buy_zone is None)==(sell_zone is None):
                continue
            side=1 if buy_zone is not None else -1
            zone=buy_zone if side==1 else sell_zone
            if source_side[name]!=side:
                events.append((i,name,zone,side))
                source_side[name]=side
        prev_g,prev_vwap,prev_day=g,vwap,day
    return events,removed

if __name__=='__main__':
    # Entry, gap over the entire zone, body-only touch, and rejected wick-only touch.
    assert qualifies(101,99,100,105,110,111)
    assert qualifies(107,99,100,105,110,111)
    assert qualifies(102,102,100,105,101,103)
    assert not qualifies(102,102,100,105,103,104)
    assert not qualifies(101,None,100,105,110,111) # session reset isn't a cross
    assert qualifies(102,None,100,105,101,103) # genuine body touch still counts
    assert qualifies(110,110,100,105,108,112,formation=True)
    assert not qualifies(110,110,100,105,108,112,formation=False)
    # Mirrored bearish entry, complete-zone jump, body touch, and reset cases.
    assert qualifies(104,106,100,105,99,98,direction=-1)
    assert qualifies(98,106,100,105,99,98,direction=-1)
    assert qualifies(102,102,100,105,103,101,direction=-1)
    assert not qualifies(102,102,100,105,101,100,direction=-1)
    assert not qualifies(104,None,100,105,99,98,direction=-1)
    assert qualifies(102,None,100,105,103,101,direction=-1)
    assert qualifies(98,98,100,105,99,97,formation=True,direction=-1)
    assert not qualifies(98,98,100,105,99,97,formation=False,direction=-1)
    rows=json.loads(Path('fvg-cross-check-candles.json').read_text(encoding='utf-8-sig'))
    events,removed=simulate(rows)
    for n in range(100,len(rows)+1,29):
        assert simulate(rows[:n])[0]==[e for e in events if e[0]<n]
    # Reflecting price swaps the bullish and bearish rules while preserving timing.
    mirrored=[]
    for row in rows:
        r=list(row)
        r[1],r[2],r[3],r[4]=-float(row[1]),-float(row[3]),-float(row[2]),-float(row[4])
        mirrored.append(r)
    reflected,_=simulate(mirrored)
    assert reflected==[(i,source,zone,-side) for i,source,zone,side in events]
    # Each source must alternate direction; overlapping/new FVGs cannot print
    # repeated same-side markers during one continuous move.
    for source in ('VWAP','G-Trend'):
        sides=[side for i,name,zone,side in events if name==source]
        assert all(a!=b for a,b in zip(sides,sides[1:]))
    retained=[e for e in events if e[2] in removed]
    assert retained
    assert any(e[3]==1 for e in retained) and any(e[3]==-1 for e in retained)
    print(f'PASS: BUY/SELL symmetry, alternating source state, crossing/body-touch rules, reset handling and prefix stability; {len(retained)} signals retained for subsequently removed zones.')
    ist=timezone(timedelta(hours=5,minutes=30))
    print('Oct 2 morning events (candle opening times IST; known at their close):')
    selected=[]
    for i,source,zone,side in events:
        dt=datetime.fromtimestamp(rows[i][0]/1000,ist)
        if dt.day==2 and 7<=dt.hour<8:
            record=dict(candle=dt.isoformat(),side='BUY' if side==1 else 'SELL',source=source,fvg_created=datetime.fromtimestamp(rows[zone][0]/1000,ist).isoformat())
            selected.append(record)
            print(record)
    assert any(r['candle'].endswith('07:20:00+05:30') and r['side']=='BUY' and r['source']=='VWAP' for r in selected)
    Path('fvg-cross-check-results.json').write_text(json.dumps(dict(candles=len(rows),retained_after_zone_removal=len(retained),morning_events=selected),indent=2))

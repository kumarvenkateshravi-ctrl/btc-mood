"""Explore fixed swing rules against visually read reference labels.

Times below are approximate screenshot readings, not exported indicator data.
This does not verify the protected indicator or compile Pine Script.
"""
import json
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))
with open('money-flow-signal-candles.json', encoding='utf-8-sig') as f:
    bars = json.load(f)
o, h, l, c = [[float(row[k]) for row in bars] for k in (1, 2, 3, 4)]
times = [datetime.fromtimestamp(row[0]/1000, IST).strftime('%m-%d %H:%M') for row in bars]

def ema(xs, n):
    out = [xs[0]]
    for x in xs[1:]:
        out.append(out[-1] + 2/(n+1)*(x-out[-1]))
    return out

def rma(xs, n):
    out = [None]*(n-1)
    out.append(sum(xs[:n])/n)
    for x in xs[n:]:
        out.append((out[-1]*(n-1)+x)/n)
    return out

def rsi(n):
    up = [0]+[max(c[i]-c[i-1], 0) for i in range(1,len(c))]
    dn = [0]+[max(c[i-1]-c[i], 0) for i in range(1,len(c))]
    u,d = rma(up,n), rma(dn,n)
    return [None if a is None else 100 if b==0 else 100-100/(1+a/b) for a,b in zip(u,d)]

reference = {
    ('09-30 05:00', 'SELL'), ('09-30 09:00', 'BUY'),
    ('09-30 13:00', 'BUY'), ('09-30 14:30', 'BUY'),
    ('09-30 19:00', 'SELL'), ('09-30 22:00', 'SELL'),
    ('10-01 06:00', 'BUY'), ('10-01 08:30', 'BUY'),
    ('10-01 12:00', 'SELL'),
}

def events(left, right=1, rows=None):
    rows = bars if rows is None else rows
    h = [float(row[2]) for row in rows]
    l = [float(row[3]) for row in rows]
    result=[]
    for i in range(left+right,len(rows)):
        p=i-right
        if l[p] <= min(l[p-left:p]) and l[p] < min(l[p+1:i+1]):
            result.append((i,p,'BUY'))
        if h[p] >= max(h[p-left:p]) and h[p] > max(h[p+1:i+1]):
            result.append((i,p,'SELL'))
    return result

def window(i):
    return '09-30 04:00' <= times[i] <= '10-01 12:30'

rs=rsi(14)
baseline=ema(c,20)
if __name__ == '__main__':
    # Adding later candles must not change an event already confirmed on a prefix.
    for left in (2,3,5):
        for right in (1,2,3):
            full=events(left,right)
            for end in range(left+right+1,len(bars)+1):
                assert events(left,right,bars[:end]) == [e for e in full if e[0]<end]
    print('PASS: confirmed swing chronology is stable when future candles are appended.')
    from pathlib import Path
    def executable_lines(s):
        return [line.strip() for line in s.splitlines() if line.strip() and not line.strip().startswith(('//','indicator('))]
    original=Path('money-flow-dots-diagnostic.pine').read_text(encoding='utf-8-sig')
    combined=Path('money-flow-dots-with-signals.pine').read_text(encoding='utf-8-sig')
    dot_block=combined.split('// -----------------------------------------------------------------------------',1)[0]
    assert executable_lines(original) == executable_lines(dot_block)
    print('PASS: dot calculations are preserved in the combined indicator.')
    for left in (2,3,5):
        ev=[(i,p,s) for i,p,s in events(left) if window(i)]
        predicted={(times[i],s) for i,p,s in ev}
        print(f'Left={left}, right=1: {len(reference & predicted)}/{len(reference)} screenshot labels; {len(predicted-reference)} additional signals')
    print('\nTwo-left / one-right pivots:')
    for i,p,s in events(2):
        if window(i):
            print(times[i],s,'pivot',times[p], 'RSI14',round(rs[p],1),'EMA20 gap',round(c[p]-baseline[p],1),'reference', (times[i],s) in reference)

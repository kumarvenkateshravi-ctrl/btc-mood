import { useEffect } from 'react';
import type { ChartRefs } from './refs';
import type { ChartPalette } from '@/lib/chartTheme';
import { getTfMinutes } from './types';

export function useCountdownTimer(
  refs: ChartRefs,
  tf: string | undefined,
  palette: ChartPalette,
  enabled: boolean = true,
) {
  useEffect(() => {
    if (!enabled) {
      // Kill the card instantly when disabled.
      const cardEl = refs.priceCardRef.current;
      if (cardEl) {
        // eslint-disable-next-line react-hooks/immutability
        cardEl.style.display = 'none';
      }
      return;
    }
    let countdownRaf = 0;
    const updateCountdown = () => {
      countdownRaf = requestAnimationFrame(updateCountdown);
      const cardEl = refs.priceCardRef.current;
      const priceEl = refs.priceTextRef.current;
      const cdEl = refs.countdownTextRef.current;
      const series = refs.candleSeriesRef.current;
      if (!cardEl || !priceEl || !cdEl || !series) return;

      const isRenkoMode = refs.hoverInputsRef.current.isRenko;
      const closeTime = refs.lastCandleTimeRef.current;
      const priceVal = refs.prevCloseRef.current;
      const y = priceVal != null ? series.priceToCoordinate(priceVal) : null;
      const axisW = refs.chartRef.current?.priceScale('right').width() || 60;
      
      if (isRenkoMode || !tf || !closeTime || y == null || priceVal == null) {
        cardEl.style.display = 'none';
        return;
      }

      const diff = (closeTime + getTfMinutes(tf) * 60) * 1000 - Date.now();
      if (diff <= 0) {
        cdEl.textContent = '00:00';
      } else {
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        if (h > 0) {
          cdEl.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        } else {
          cdEl.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        }
      }
      
      const isGreen = refs.prevOpenRef.current != null ? priceVal >= refs.prevOpenRef.current : true;
      const P = refs.paletteRef.current;
      cardEl.style.backgroundColor =
        P.priceCardBg === 'direction'
          ? isGreen
            ? P.bullFace
            : P.bearFace
          : P.priceCardBg;
      cardEl.style.color = P.priceCardInk;
      cdEl.style.color = P.priceCardSubInk;
      priceEl.textContent = priceVal.toFixed(1);
      
      cardEl.style.display = 'flex';
      cardEl.style.top = `${y}px`;
      cardEl.style.width = `${axisW}px`;
    };
    
    countdownRaf = requestAnimationFrame(updateCountdown);

    return () => {
      if (countdownRaf) cancelAnimationFrame(countdownRaf);
    };
  }, [refs, tf, palette, enabled]);
}

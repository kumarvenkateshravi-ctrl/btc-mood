import { describe, expect, it } from 'vitest';
import { feedbackForTradingCommand, shouldDismissTradingControl } from './tradeCommandFeedback';

describe('trading command feedback', () => {
  it('labels accepted commands with the active execution owner', () => {
    expect(feedbackForTradingCommand({ status: 'accepted', mode: 'live' })).toMatchObject({
      tone: 'success', title: 'Live paper command accepted',
    });
    expect(feedbackForTradingCommand({ status: 'accepted', mode: 'replay' })).toMatchObject({
      tone: 'success', title: 'Replay command accepted',
    });
  });

  it('preserves clear rejected and unsupported reasons for controls to display', () => {
    expect(feedbackForTradingCommand({ status: 'rejected', mode: 'live', reason: 'Market data is not trusted/live' })).toEqual({
      tone: 'error', title: 'Command rejected', message: 'Market data is not trusted/live',
    });
    expect(feedbackForTradingCommand({ status: 'unsupported', mode: 'replay', reason: 'Replay command unsupported' })).toEqual({
      tone: 'info', title: 'Command unavailable', message: 'Replay command unsupported',
    });
  });

  it('keeps a context menu or ticket open after rejection and closes only after acceptance', () => {
    expect(shouldDismissTradingControl({ status: 'accepted', mode: 'live' })).toBe(true);
    expect(shouldDismissTradingControl({ status: 'rejected', mode: 'live', reason: 'Insufficient margin' })).toBe(false);
    expect(shouldDismissTradingControl({ status: 'unsupported', mode: 'replay', reason: 'Replay command unsupported' })).toBe(false);
  });
});

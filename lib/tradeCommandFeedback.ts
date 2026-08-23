import type { TradingCommandResult } from './chartTradingCommands';

export interface TradeCommandFeedback {
  tone: 'success' | 'error' | 'info';
  title: string;
  message: string;
}

/** Converts the mode-aware command result into concise, user-visible feedback. */
export function feedbackForTradingCommand(result: TradingCommandResult): TradeCommandFeedback {
  if (result.status === 'accepted') {
    return {
      tone: 'success',
      title: result.mode === 'replay' ? 'Replay command accepted' : 'Live paper command accepted',
      message: 'The command was sent to the active execution account.',
    };
  }
  if (result.status === 'unsupported') {
    return { tone: 'info', title: 'Command unavailable', message: result.reason };
  }
  return { tone: 'error', title: 'Command rejected', message: result.reason };
}

/** Menus/tickets dismiss only after the command boundary has accepted execution. */
export function shouldDismissTradingControl(result: TradingCommandResult): boolean {
  return result.status === 'accepted';
}
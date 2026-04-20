import { create } from 'zustand'
import { PivotCluster, LevelWithDistance } from '../algo/PivotClustering'
import { SMCResult } from '../algo/SMCEngine'

export interface SOPDecision {
  signal: 'LONG' | 'SHORT' | 'NEUTRAL'
  strength: number // 0-100 indicating resonance strength
  reasons: string[]
}

export interface SymbolQuantState {
  symbol: string
  levels: PivotCluster[]
  nearestLevels: {
    resistances: LevelWithDistance[]
    supports: LevelWithDistance[]
  } | null
  smc: SMCResult | null
  decision: SOPDecision | null
  lastUpdated: number
}

interface QuantEngineState {
  isEnabled: boolean
  toggleEnabled: () => void
  symbolStates: Record<string, SymbolQuantState>
  updateSymbolState: (symbol: string, state: Partial<SymbolQuantState>) => void
  getSymbolState: (symbol: string) => SymbolQuantState | undefined
  clearSymbolState: (symbol: string) => void
}

export const useQuantEngineStore = create<QuantEngineState>((set, get) => ({
  isEnabled: false,
  toggleEnabled: () => set((state) => ({ isEnabled: !state.isEnabled })),
  
  symbolStates: {},
  
  updateSymbolState: (symbol, newState) =>
    set((state) => ({
      symbolStates: {
        ...state.symbolStates,
        [symbol]: {
          ...(state.symbolStates[symbol] || {
            symbol,
            levels: [],
            nearestLevels: null,
            smc: null,
            decision: null,
            lastUpdated: 0,
          }),
          ...newState,
          lastUpdated: Date.now(),
        },
      },
    })),
    
  getSymbolState: (symbol) => get().symbolStates[symbol],
  
  clearSymbolState: (symbol) =>
    set((state) => {
      const newStates = { ...state.symbolStates }
      delete newStates[symbol]
      return { symbolStates: newStates }
    }),
}))

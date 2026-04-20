import { useQuantEngineStore } from '../../stores/quantEngineStore'
import { Activity, Zap, TrendingUp, Target } from 'lucide-react'

export function QuantResonancePanel({ symbol, className = '' }: { symbol: string, className?: string }) {
  const store = useQuantEngineStore()
  const isEnabled = store.isEnabled
  const state = store.symbolStates[symbol]

  // 當引擎未啟動時顯示佔位符
  if (!isEnabled) {
    return (
      <div className={`nofx-glass p-4 rounded-lg border border-white/5 flex items-center justify-center opacity-50 ${className}`}>
        <div className="text-center text-xs text-nofx-text-muted">
          <Zap className="w-6 h-6 mx-auto mb-2 opacity-30" />
          Quant Engine v4.0 is Disabled
        </div>
      </div>
    )
  }

  // 資料尚未準備好
  if (!state || !state.decision) {
    return (
      <div className={`nofx-glass p-4 rounded-lg border border-white/5 flex items-center justify-center animate-pulse ${className}`}>
        <div className="text-center text-xs text-nofx-text-muted">
          <Activity className="w-5 h-5 mx-auto mb-2 text-nofx-gold animate-spin-slow" />
          Analyzing Matrix for {symbol}...
        </div>
      </div>
    )
  }

  const { decision, nearestLevels } = state
  const isLong = decision.signal === 'LONG'
  const isShort = decision.signal === 'SHORT'
  
  // 動態配色系統
  const color = isLong ? '#0ECB81' : isShort ? '#F6465D' : '#848E9C'
  const bgColor = isLong ? 'rgba(14, 203, 129, 0.1)' : isShort ? 'rgba(246, 70, 93, 0.1)' : 'rgba(132, 142, 156, 0.1)'

  return (
    <div className={`nofx-glass p-4 rounded-lg border flex flex-col gap-4 relative overflow-hidden transition-colors duration-500 hover:-translate-y-1 ${className}`} style={{ borderColor: `${color}30` }}>
      {/* 背景光暈點綴 */}
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full blur-[40px] opacity-20 pointer-events-none transition-colors duration-700" style={{ background: color, transform: 'translate(30%, -30%)' }} />

      {/* 標題與訊號燈 */}
      <div className="flex items-center justify-between z-10">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded flex items-center justify-center border shadow-lg" style={{ background: bgColor, borderColor: `${color}40`, boxShadow: `0 0 15px ${bgColor}` }}>
            <Zap className="w-4 h-4" style={{ color }} />
          </div>
          <div>
             <div className="text-xs font-bold text-nofx-text-main tracking-wider uppercase">SOP Resonance</div>
             <div className="text-[10px] text-nofx-text-muted font-mono">{symbol}</div>
          </div>
        </div>
        
        {/* Signal Badge */}
        <div className="px-3 py-1 rounded border font-bold text-sm tracking-wider shadow-sm transition-all" style={{ background: bgColor, borderColor: `${color}50`, color, textShadow: `0 0 15px ${color}` }}>
          {decision.signal}
        </div>
      </div>

      {/* 共振分數條 Gauge */}
      <div className="space-y-1 mt-2 z-10">
        <div className="flex justify-between items-end">
           <span className="text-[10px] text-nofx-text-muted font-mono uppercase tracking-wider">Confidence Matrix</span>
           <span className="text-xl font-black font-mono transition-colors" style={{ color }}>{decision.strength}</span>
        </div>
        <div className="h-2 w-full bg-black/40 rounded-full overflow-hidden border border-white/5 relative">
           <div 
             className="h-full rounded-full transition-all duration-1000 ease-out"
             style={{ 
               width: `${decision.strength}%`, 
               background: `linear-gradient(90deg, ${color}40, ${color})`,
               boxShadow: `0 0 10px ${color}`
             }}
           />
           {/* Marker lines for thresholds */}
           <div className="absolute top-0 bottom-0 left-[60%] w-px bg-white/20" />
           <div className="absolute top-0 bottom-0 left-[80%] w-px bg-white/20" />
        </div>
      </div>

      {/* 決策理由推演 (Confluence Factors) */}
      {decision.reasons && decision.reasons.length > 0 && (
        <div className="mt-2 space-y-2 z-10 overflow-y-auto max-h-[140px] custom-scrollbar pr-1">
           <div className="text-[10px] text-nofx-text-muted font-mono uppercase tracking-wider flex items-center gap-1">
             <Target className="w-3 h-3" /> Active Factors
           </div>
           <div className="flex flex-col gap-1.5">
             {decision.reasons.map((reason, idx) => (
               <div key={idx} className="flex items-start gap-2 bg-black/20 p-2 rounded border border-white/5 hover:bg-black/40 transition-colors">
                 <div className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 5px ${color}` }} />
                 <span className="text-xs text-nofx-text-main leading-tight font-mono opacity-90">{reason}</span>
               </div>
             ))}
           </div>
        </div>
      )}

      {/* Mini Environment Matrix (Nearest Levels) */}
      <div className="grid grid-cols-2 gap-3 mt-2 pt-3 border-t border-white/5 z-10">
         <div className="flex flex-col gap-1 p-2 rounded bg-nofx-red/5 border border-nofx-red/10">
            <span className="text-[9px] text-nofx-red font-mono uppercase flex items-center gap-1 opacity-80">
              <TrendingUp className="w-2.5 h-2.5" /> Nearest Res
            </span>
            <span className="text-sm font-mono text-nofx-red font-bold">
              {nearestLevels?.resistances[0] ? nearestLevels.resistances[0].price.toFixed(2) : '--'}
            </span>
         </div>
         <div className="flex flex-col gap-1 p-2 rounded bg-nofx-green/5 border border-nofx-green/10">
            <span className="text-[9px] text-nofx-green font-mono uppercase flex items-center gap-1 opacity-80">
              <TrendingUp className="w-2.5 h-2.5 transform scale-y-[-1]" /> Nearest Sup
            </span>
            <span className="text-sm font-mono text-nofx-green font-bold">
              {nearestLevels?.supports[0] ? nearestLevels.supports[0].price.toFixed(2) : '--'}
            </span>
         </div>
      </div>
      
    </div>
  )
}
